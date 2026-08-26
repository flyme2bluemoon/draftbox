import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiErrorResponseSchema, userResponseSchema } from "@draftbox/contracts";

import { handleRequest } from "../src/index";
import type { Env } from "../src/types";

const KEY_ID = "draftbox-test-key";
const originalFetch = globalThis.fetch;

let privateKey: CryptoKey;
let publicJwk: JWK;

function requestUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") {
        return input;
    }
    if (input instanceof URL) {
        return input.href;
    }
    return input.url;
}

async function signAccessToken(payload: JWTPayload = {}): Promise<string> {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
        .setIssuer(env.WORKOS_ISSUER)
        .setAudience(env.WORKOS_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
}

async function whoami(token?: string): Promise<Response> {
    const headers = new Headers();
    if (token !== undefined) {
        headers.set("Authorization", `Bearer ${token}`);
    }
    return handleRequest(
        new Request("https://draftbox.example/api/whoami", { headers }),
        env as Env,
    );
}

beforeAll(async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
    publicJwk.kid = KEY_ID;
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";

    globalThis.fetch = async (input, init) => {
        if (requestUrl(input) === env.WORKOS_JWKS_URL) {
            return Response.json({ keys: [publicJwk] });
        }
        return originalFetch(input, init);
    };
});

afterAll(() => {
    globalThis.fetch = originalFetch;
});

describe("authenticateRequest", () => {
    it("rejects a missing bearer token", async () => {
        const response = await whoami();

        expect(response.status).toBe(401);
        expect(apiErrorResponseSchema.parse(await response.json())).toEqual({
            error: {
                code: "unauthenticated",
                message: "Authentication is required.",
            },
        });
    });

    it("rejects a malformed bearer token", async () => {
        const response = await whoami("not-a-jwt");

        expect(response.status).toBe(401);
        expect(apiErrorResponseSchema.parse(await response.json())).toMatchObject({
            error: { code: "invalid_token" },
        });
    });

    it("accepts a Connect access token that has sub and aud but no client_id", async () => {
        const response = await whoami(await signAccessToken({ sub: "user_owner" }));

        expect(response.status).toBe(200);
        expect(userResponseSchema.parse(await response.json())).toEqual({
            user: { id: "user_owner", email: null },
        });
    });

    it("rejects a token with no subject", async () => {
        const response = await whoami(await signAccessToken({}));

        expect(response.status).toBe(401);
        expect(apiErrorResponseSchema.parse(await response.json())).toMatchObject({
            error: { code: "invalid_token" },
        });
    });
});
