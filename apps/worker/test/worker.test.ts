import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { apiErrorResponseSchema } from "@draftbox/contracts";

import { handleRequest } from "../src/index";
import { d1FreeTierApiError, R2_FREE_STORAGE_BYTES } from "../src/quota";
import type { Authenticate, AuthenticatedUser, Env } from "../src/types";

const OWNER: AuthenticatedUser = { id: "user_owner", email: "owner@example.com" };
const OTHER_USER: AuthenticatedUser = { id: "user_other", email: "other@example.com" };
const SOURCE_HASH = "a".repeat(64);

interface ArtifactResult {
    artifact: {
        id: string;
        currentVersion: number;
        url: string;
    };
    version: {
        version: number;
        url: string;
    };
}

function authenticateAs(user: AuthenticatedUser): Authenticate {
    return async () => user;
}

function apiRequest(path: string, init: RequestInit = {}): Request {
    return new Request(`https://draftbox.example${path}`, init);
}

async function requestAs(
    user: AuthenticatedUser,
    path: string,
    init: RequestInit = {},
): Promise<Response> {
    return handleRequest(apiRequest(path, init), env as Env, authenticateAs(user));
}

async function createArtifact(
    contents = "<h1>one</h1>",
    sourceHash = SOURCE_HASH,
    user = OWNER,
): Promise<ArtifactResult> {
    const response = await requestAs(user, "/api/artifacts", {
        method: "POST",
        headers: {
            "X-Draftbox-Filename": encodeURIComponent("page.html"),
            "X-Draftbox-Description": encodeURIComponent("Example page"),
            "X-Draftbox-Source-Hash": sourceHash,
        },
        body: contents,
    });
    expect(response.status).toBe(201);
    return response.json<ArtifactResult>();
}

beforeEach(async () => {
    const objects = await env.ARTIFACTS.list();
    if (objects.objects.length > 0) {
        await env.ARTIFACTS.delete(objects.objects.map((object) => object.key));
    }
    await env.DB.prepare("DELETE FROM artifacts").run();
});

describe("artifact lifecycle", () => {
    it("returns the API error contract for unknown routes", async () => {
        const response = await requestAs(OWNER, "/api/unknown");

        expect(response.status).toBe(404);
        expect(apiErrorResponseSchema.parse(await response.json())).toEqual({
            error: {
                code: "not_found",
                message: "Endpoint not found.",
            },
        });
    });

    it("does not add implicit HEAD support to API routes", async () => {
        const response = await requestAs(OWNER, "/api/whoami", { method: "HEAD" });

        expect(response.status).toBe(404);
    });

    it("returns a contract-valid error for invalid metadata", async () => {
        const created = await createArtifact();
        const response = await requestAs(
            OWNER,
            `/api/artifacts/${created.artifact.id}`,
            {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename: 42 }),
            },
        );

        expect(response.status).toBe(400);
        expect(apiErrorResponseSchema.parse(await response.json())).toMatchObject({
            error: { code: "invalid_metadata" },
        });
    });

    it("serves unchanged bytes with the required isolation headers", async () => {
        const contents = "<!doctype html><script>document.body.textContent='ok'</script>";
        const created = await createArtifact(contents);
        const response = await handleRequest(new Request(created.artifact.url), env as Env);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(contents);
        expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(response.headers.get("Content-Security-Policy"))
            .toBe("sandbox allow-scripts; frame-ancestors 'none'");
        expect(response.headers.get("Content-Security-Policy")).not.toContain("allow-same-origin");
        expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
    });

    it("makes the highest surviving version current without reusing version numbers", async () => {
        const created = await createArtifact("one");
        const secondResponse = await requestAs(
            OWNER,
            `/api/artifacts/${created.artifact.id}/versions`,
            {
                method: "POST",
                headers: { "X-Draftbox-Source-Hash": SOURCE_HASH },
                body: "two",
            },
        );
        const second = await secondResponse.json<ArtifactResult>();
        expect(second.version.version).toBe(2);

        const deletion = await requestAs(
            OWNER,
            `/api/artifacts/${created.artifact.id}/versions/2`,
            { method: "DELETE" },
        );
        expect(deletion.status).toBe(204);
        expect(await (await handleRequest(new Request(created.artifact.url), env as Env)).text())
            .toBe("one");
        expect((await handleRequest(new Request(second.version.url), env as Env)).status).toBe(404);

        const thirdResponse = await requestAs(
            OWNER,
            `/api/artifacts/${created.artifact.id}/versions`,
            {
                method: "POST",
                headers: { "X-Draftbox-Source-Hash": SOURCE_HASH },
                body: "three",
            },
        );
        const third = await thirdResponse.json<ArtifactResult>();
        expect(third.version.version).toBe(3);
    });

    it("adds an upload from the same source as a new version", async () => {
        const first = await createArtifact("one");
        const second = await createArtifact("two");

        expect(second.artifact.id).toBe(first.artifact.id);
        expect(second.version.version).toBe(2);
        expect(await (await handleRequest(new Request(first.artifact.url), env as Env)).text())
            .toBe("two");

        const row = await env.DB.prepare(
            "SELECT source_hash FROM versions WHERE artifact_id = ? AND version_number = 2",
        )
            .bind(first.artifact.id)
            .first<{ source_hash: string }>();
        expect(row?.source_hash).toBe(SOURCE_HASH);
    });

    it("scopes automatic source matching to the owner", async () => {
        const ownerArtifact = await createArtifact("owner");
        const otherArtifact = await createArtifact("other", SOURCE_HASH, OTHER_USER);

        expect(otherArtifact.artifact.id).not.toBe(ownerArtifact.artifact.id);
        expect(otherArtifact.version.version).toBe(1);
    });

    it("collapses concurrent first uploads from the same source into one artifact", async () => {
        const [first, second] = await Promise.all([
            createArtifact("one", SOURCE_HASH),
            createArtifact("two", SOURCE_HASH),
        ]);

        expect(second.artifact.id).toBe(first.artifact.id);
        expect(new Set([first.version.version, second.version.version])).toEqual(new Set([1, 2]));

        const listed = await requestAs(OWNER, `/api/artifacts/${first.artifact.id}/versions`);
        const { versions } = await listed.json<{ versions: { version: number }[] }>();
        expect(versions.map((version) => version.version).sort()).toEqual([1, 2]);
        expect(await env.DB.prepare(
            "SELECT COUNT(*) AS count FROM artifacts WHERE owner_id = ?",
        ).bind(OWNER.id).first<{ count: number }>()).toEqual({ count: 1 });
        expect(await env.DB.prepare(
            "SELECT COUNT(*) AS count FROM upload_sources WHERE owner_id = ? AND source_hash = ?",
        ).bind(OWNER.id, SOURCE_HASH).first<{ count: number }>()).toEqual({ count: 1 });
    });

    it("does not rebind a source when a file is uploaded onto a different artifact", async () => {
        const original = await createArtifact("original", SOURCE_HASH);
        const otherHash = "b".repeat(64);
        const other = await createArtifact("other", otherHash);

        const attached = await requestAs(
            OWNER,
            `/api/artifacts/${original.artifact.id}/versions`,
            {
                method: "POST",
                headers: { "X-Draftbox-Source-Hash": otherHash },
                body: "attached",
            },
        );
        expect(attached.status).toBe(201);

        const implicit = await createArtifact("from-other", otherHash);
        expect(implicit.artifact.id).toBe(other.artifact.id);
        expect(implicit.version.version).toBe(2);

        const unbound = await createArtifact("fresh", "c".repeat(64));
        const stolen = await requestAs(
            OWNER,
            `/api/artifacts/${original.artifact.id}/versions`,
            {
                method: "POST",
                headers: { "X-Draftbox-Source-Hash": "d".repeat(64) },
                body: "onto-original",
            },
        );
        expect(stolen.status).toBe(201);
        const createdFromStolenHash = await createArtifact("new-source", "d".repeat(64));
        expect(createdFromStolenHash.artifact.id).not.toBe(original.artifact.id);
        expect(createdFromStolenHash.artifact.id).not.toBe(unbound.artifact.id);
        expect(createdFromStolenHash.version.version).toBe(1);
    });

    it("allows a source to create a new artifact after its bound artifact is deleted", async () => {
        const created = await createArtifact();
        const deletion = await requestAs(
            OWNER,
            `/api/artifacts/${created.artifact.id}/versions/1`,
            { method: "DELETE" },
        );
        expect(deletion.status).toBe(204);

        const recreated = await createArtifact("again");
        expect(recreated.artifact.id).not.toBe(created.artifact.id);
        expect(recreated.version.version).toBe(1);
    });

    it("hides artifacts from other authenticated users", async () => {
        const created = await createArtifact();
        const list = await requestAs(OTHER_USER, "/api/artifacts");
        const listed = await list.json<{ artifacts: unknown[] }>();
        expect(listed.artifacts).toEqual([]);

        const deletion = await requestAs(
            OTHER_USER,
            `/api/artifacts/${created.artifact.id}`,
            { method: "DELETE" },
        );
        expect(deletion.status).toBe(404);
        expect((await handleRequest(new Request(created.artifact.url), env as Env)).status).toBe(200);
    });

    it("rotates every public link and returns indistinguishable public 404s", async () => {
        const created = await createArtifact();
        const rotation = await requestAs(
            OWNER,
            `/api/artifacts/${created.artifact.id}/rotate-link`,
            { method: "POST" },
        );
        const rotated = await rotation.json<{ artifact: ArtifactResult["artifact"] }>();

        const oldArtifact = await handleRequest(new Request(created.artifact.url), env as Env);
        const oldVersion = await handleRequest(new Request(created.version.url), env as Env);
        const missing = await handleRequest(
            new Request("https://draftbox.example/p/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
            env as Env,
        );
        expect(await oldArtifact.text()).toBe(await missing.clone().text());
        expect(oldArtifact.status).toBe(404);
        expect(oldVersion.status).toBe(404);
        expect((await handleRequest(new Request(rotated.artifact.url), env as Env)).status).toBe(200);
    });

    it("deletes the artifact when its final version is deleted", async () => {
        const created = await createArtifact();
        const response = await requestAs(
            OWNER,
            `/api/artifacts/${created.artifact.id}/versions/1`,
            { method: "DELETE" },
        );
        expect(response.status).toBe(204);
        expect((await handleRequest(new Request(created.artifact.url), env as Env)).status).toBe(404);
        expect(await env.ARTIFACTS.get(`${created.artifact.id}/v1`)).toBeNull();
    });
    it("updates only the metadata supplied with a version upload", async () => {
        const created = await createArtifact();
        const unchanged = await requestAs(
            OWNER,
            `/api/artifacts/${created.artifact.id}/versions`,
            {
                method: "POST",
                headers: { "X-Draftbox-Source-Hash": SOURCE_HASH },
                body: "two",
            },
        );
        const second = await unchanged.json<ArtifactResult>();
        expect(second.artifact.filename).toBe("page.html");
        expect(second.artifact.description).toBe("Example page");

        const patched = await requestAs(
            OWNER,
            `/api/artifacts/${created.artifact.id}/versions`,
            {
                method: "POST",
                headers: {
                    "X-Draftbox-Source-Hash": SOURCE_HASH,
                    "X-Draftbox-Description": encodeURIComponent("Rewritten"),
                },
                body: "three",
            },
        );
        const third = await patched.json<ArtifactResult>();
        expect(third.artifact.filename).toBe("page.html");
        expect(third.artifact.description).toBe("Rewritten");

        const list = await requestAs(OWNER, "/api/artifacts");
        const { artifacts } = await list.json<{ artifacts: ArtifactResult["artifact"][] }>();
        expect(artifacts[0]).toMatchObject({
            filename: "page.html",
            description: "Rewritten",
            currentVersion: 3,
        });
    });

    it("applies supplied metadata when an upload source matches an existing artifact", async () => {
        const created = await createArtifact();
        const response = await requestAs(OWNER, "/api/artifacts", {
            method: "POST",
            headers: {
                "X-Draftbox-Filename": encodeURIComponent("renamed.html"),
                "X-Draftbox-Source-Hash": SOURCE_HASH,
            },
            body: "<h1>two</h1>",
        });

        expect(response.status).toBe(201);
        const result = await response.json<ArtifactResult>();
        expect(result.artifact.id).toBe(created.artifact.id);
        expect(result.artifact.filename).toBe("renamed.html");
        expect(result.artifact.description).toBe("Example page");
    });

    it("keeps a renamed artifact when a re-upload only carries the source filename", async () => {
        const created = await createArtifact();
        await requestAs(OWNER, `/api/artifacts/${created.artifact.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: "renamed.html" }),
        });

        const response = await requestAs(OWNER, "/api/artifacts", {
            method: "POST",
            headers: {
                "X-Draftbox-Source-Filename": encodeURIComponent("page.html"),
                "X-Draftbox-Source-Hash": SOURCE_HASH,
            },
            body: "<h1>two</h1>",
        });

        expect(response.status).toBe(201);
        const result = await response.json<ArtifactResult>();
        expect(result.artifact.id).toBe(created.artifact.id);
        expect(result.artifact.filename).toBe("renamed.html");
        expect(result.artifact.description).toBe("Example page");
    });

    it("rejects an undecodable metadata header on a version upload", async () => {
        const created = await createArtifact();
        const response = await requestAs(
            OWNER,
            `/api/artifacts/${created.artifact.id}/versions`,
            {
                method: "POST",
                headers: {
                    "X-Draftbox-Source-Hash": SOURCE_HASH,
                    "X-Draftbox-Filename": "%zz",
                },
                body: "two",
            },
        );

        expect(response.status).toBe(400);
        expect(apiErrorResponseSchema.parse(await response.json())).toMatchObject({
            error: { code: "invalid_metadata" },
        });

        const versions = await requestAs(
            OWNER,
            `/api/artifacts/${created.artifact.id}/versions`,
        );
        const listed = await versions.json<{ versions: { version: number }[] }>();
        expect(listed.versions.map((version) => version.version)).toEqual([1]);
    });
});

describe("free-tier quota", () => {
    async function seedStoredBytes(byteSize: number): Promise<string> {
        const now = new Date().toISOString();
        const artifactId = crypto.randomUUID();
        const shareSecret = crypto.randomUUID();
        await env.DB.batch([
            env.DB.prepare(
                `INSERT INTO artifacts (
                    id, owner_id, filename, description, share_secret,
                    current_version, next_version, created_at, updated_at
                ) VALUES (?, ?, 'seed.html', '', ?, 1, 2, ?, ?)`,
            ).bind(artifactId, OWNER.id, shareSecret, now, now),
            env.DB.prepare(
                `INSERT INTO versions (
                    artifact_id, version_number, r2_key, content_hash, source_hash,
                    byte_size, created_at
                ) VALUES (?, 1, ?, ?, ?, ?, ?)`,
            ).bind(
                artifactId,
                `${artifactId}/v1`,
                "b".repeat(64),
                "c".repeat(64),
                byteSize,
                now,
            ),
        ]);
        return artifactId;
    }

    it("rejects an upload that would exceed R2 free-tier storage", async () => {
        await seedStoredBytes(R2_FREE_STORAGE_BYTES - 5);
        const response = await requestAs(OWNER, "/api/artifacts", {
            method: "POST",
            headers: {
                "X-Draftbox-Filename": encodeURIComponent("page.html"),
                "X-Draftbox-Source-Hash": SOURCE_HASH,
            },
            body: "<h1>too big</h1>",
        });

        expect(response.status).toBe(507);
        expect(apiErrorResponseSchema.parse(await response.json())).toEqual({
            error: {
                code: "quota_exceeded",
                message: "R2 storage would exceed the 9 GB free-tier cap.",
            },
        });
        expect(await env.ARTIFACTS.list()).toMatchObject({ objects: [] });
    });

    it("allows an upload that fits in remaining R2 storage", async () => {
        await seedStoredBytes(R2_FREE_STORAGE_BYTES - 1_000);
        const created = await createArtifact("fits");
        expect(created.version.version).toBe(1);
    });

    it("frees R2 storage when a version is deleted", async () => {
        const seededId = await seedStoredBytes(R2_FREE_STORAGE_BYTES - 5);
        const blocked = await requestAs(OWNER, "/api/artifacts", {
            method: "POST",
            headers: {
                "X-Draftbox-Filename": encodeURIComponent("page.html"),
                "X-Draftbox-Source-Hash": SOURCE_HASH,
            },
            body: "<h1>too big</h1>",
        });
        expect(blocked.status).toBe(507);

        const deletion = await requestAs(OWNER, `/api/artifacts/${seededId}`, {
            method: "DELETE",
        });
        expect(deletion.status).toBe(204);

        const created = await createArtifact();
        expect(created.version.version).toBe(1);
    });

    it("maps D1 free-tier platform errors onto the API contract", () => {
        expect(d1FreeTierApiError(
            new Error("Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue."),
        )).toMatchObject({
            status: 429,
            code: "quota_exceeded",
        });
        expect(d1FreeTierApiError(
            new Error("Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue."),
        )).toMatchObject({
            status: 429,
            code: "quota_exceeded",
        });
        expect(d1FreeTierApiError(new Error("Exceeded maximum DB size."))).toMatchObject({
            status: 507,
            code: "quota_exceeded",
        });
        expect(d1FreeTierApiError(new Error("D1 DB is overloaded. Too many requests queued.")))
            .toBeUndefined();

        const wrapped = new Error("D1_ERROR");
        wrapped.cause = new Error(
            "Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.",
        );
        expect(d1FreeTierApiError(wrapped)).toMatchObject({
            status: 429,
            code: "quota_exceeded",
        });
    });
});

