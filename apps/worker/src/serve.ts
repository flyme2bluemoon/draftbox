import { publicNotFound } from "./http";
import { isD1FreeTierError } from "./quota";
import type { Env } from "./types";

const PUBLIC_PATH = /^\/p\/([A-Za-z0-9_-]{43})(?:\/v([1-9]\d*))?\/?$/;

interface PublicObjectRow {
    r2_key: string;
}

export async function servePublic(request: Request, env: Env): Promise<Response> {
    try {
        if (request.method !== "GET" && request.method !== "HEAD") {
            return publicNotFound();
        }

        const url = new URL(request.url);
        const match = url.pathname.match(PUBLIC_PATH);
        const shareSecret = match?.[1];
        if (shareSecret === undefined) {
            return publicNotFound();
        }

        const requestedVersion = match?.[2];
        const row = requestedVersion === undefined
            ? await env.DB.prepare(
                `SELECT versions.r2_key
                 FROM artifacts
                 JOIN versions
                   ON versions.artifact_id = artifacts.id
                  AND versions.version_number = artifacts.current_version
                 WHERE artifacts.share_secret = ?`,
            ).bind(shareSecret).first<PublicObjectRow>()
            : await env.DB.prepare(
                `SELECT versions.r2_key
                 FROM artifacts
                 JOIN versions ON versions.artifact_id = artifacts.id
                 WHERE artifacts.share_secret = ? AND versions.version_number = ?`,
            ).bind(shareSecret, Number(requestedVersion)).first<PublicObjectRow>();

        if (row === null) {
            return publicNotFound();
        }

        const object = await env.ARTIFACTS.get(row.r2_key);
        if (object === null) {
            return publicNotFound();
        }

        const headers = new Headers({
            "Cache-Control": "no-store",
            "Content-Security-Policy": "sandbox allow-scripts; frame-ancestors 'none'",
            "Content-Type": "text/html; charset=utf-8",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Robots-Tag": "noindex, nofollow, noarchive",
        });

        return new Response(request.method === "HEAD" ? null : object.body, { headers });
    } catch (error) {
        if (isD1FreeTierError(error)) {
            return new Response("Service Unavailable", {
                status: 503,
                headers: {
                    "Cache-Control": "no-store",
                    "Content-Type": "text/plain; charset=utf-8",
                },
            });
        }
        throw error;
    }
}
