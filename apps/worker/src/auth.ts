import { createRemoteJWKSet, jwtVerify } from "jose";

import { ApiError } from "./http";
import type { Authenticate, AuthenticatedUser, Env } from "./types";

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
    const existing = jwksByUrl.get(url);
    if (existing !== undefined) {
        return existing;
    }

    const created = createRemoteJWKSet(new URL(url));
    jwksByUrl.set(url, created);
    return created;
}

function readBearerToken(request: Request): string {
    const authorization = request.headers.get("Authorization");
    const match = authorization?.match(/^Bearer ([^\s]+)$/);
    if (match?.[1] === undefined) {
        throw new ApiError(401, "unauthenticated", "Authentication is required.");
    }

    return match[1];
}

export const authenticateRequest: Authenticate = async (
    request: Request,
    env: Env,
): Promise<AuthenticatedUser> => {
    const token = readBearerToken(request);

    try {
        const { payload } = await jwtVerify(token, getJwks(env.WORKOS_JWKS_URL), {
            algorithms: ["RS256"],
            issuer: env.WORKOS_ISSUER,
            audience: env.WORKOS_AUDIENCE,
        });

        if (typeof payload.sub !== "string" || payload.sub.length === 0) {
            throw new Error("The access token has no subject.");
        }
        if (payload.client_id !== env.WORKOS_CLIENT_ID) {
            throw new Error("The access token was issued to a different OAuth client.");
        }

        return {
            id: payload.sub,
            email: typeof payload.email === "string" ? payload.email : null,
        };
    } catch {
        throw new ApiError(401, "invalid_token", "The access token is invalid or expired.");
    }
};
