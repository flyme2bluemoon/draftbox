import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";

import { DraftboxApi, DraftboxApiError } from "../dist/api.js";
import { saveCredentials } from "../dist/credentials.js";

const config = {
    apiUrl: "https://draftbox.example",
    authkitUrl: "https://authkit.example",
    clientId: "client_test",
};

function unexpiredAccessToken(): string {
    const payload = Buffer.from(JSON.stringify({
        exp: Math.floor(Date.now() / 1_000) + 3_600,
    })).toString("base64url");
    return `header.${payload}.signature`;
}

test("validates outgoing requests and incoming success and error responses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draftbox-api-test-"));
    const originalConfigDirectory = process.env.DRAFTBOX_CONFIG_DIR;
    const originalFetch = globalThis.fetch;
    process.env.DRAFTBOX_CONFIG_DIR = directory;

    try {
        await saveCredentials({
            accessToken: unexpiredAccessToken(),
            refreshToken: "refresh-token",
        });

        let fetchCount = 0;
        globalThis.fetch = async () => {
            fetchCount += 1;
            return Response.json({ artifacts: [{ id: "not-a-complete-artifact" }] });
        };

        const api = new DraftboxApi(config);
        await assert.rejects(
            () => api.edit("artifact-id", {}),
            /Provide filename or description/,
        );
        assert.equal(fetchCount, 0);

        await assert.rejects(
            api.listArtifacts(),
            /invalid response with status 200/,
        );

        globalThis.fetch = async () => Response.json(
            {
                error: {
                    code: "artifact_not_found",
                    message: "Artifact not found.",
                },
            },
            { status: 404 },
        );

        await assert.rejects(
            api.listArtifacts(),
            (error: unknown) => {
                assert.ok(error instanceof DraftboxApiError);
                assert.equal(error.status, 404);
                assert.equal(error.code, "artifact_not_found");
                return true;
            },
        );

        let readNoContentBody = false;
        globalThis.fetch = async () => ({
            status: 204,
            ok: true,
            json: async () => {
                readNoContentBody = true;
                return { artifacts: [] };
            },
        }) as Response;

        await assert.rejects(
            api.listArtifacts(),
            /invalid response with status 204/,
        );
        assert.equal(readNoContentBody, false);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalConfigDirectory === undefined) {
            delete process.env.DRAFTBOX_CONFIG_DIR;
        } else {
            process.env.DRAFTBOX_CONFIG_DIR = originalConfigDirectory;
        }
        await rm(directory, { recursive: true, force: true });
    }
});

test("sends metadata headers only for the fields the caller supplied", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draftbox-api-test-"));
    const originalConfigDirectory = process.env.DRAFTBOX_CONFIG_DIR;
    const originalFetch = globalThis.fetch;
    process.env.DRAFTBOX_CONFIG_DIR = directory;

    try {
        await saveCredentials({
            accessToken: unexpiredAccessToken(),
            refreshToken: "refresh-token",
        });
        const filePath = join(directory, "page.html");
        await writeFile(filePath, "<h1>Updated</h1>");

        const artifact = {
            id: "00000000-0000-4000-8000-000000000001",
            filename: "page.html",
            description: "Original description",
            currentVersion: 2,
            url: "https://draftbox.example/p/share-secret",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
        };
        const version = {
            version: 2,
            url: "https://draftbox.example/p/share-secret/v2",
            size: 16,
            contentHash: "a".repeat(64),
            createdAt: "2026-01-02T00:00:00.000Z",
        };
        const requests: Array<{
            method: string;
            path: string;
            filename: string | null;
            sourceFilename: string | null;
            description: string | null;
        }> = [];
        const sourceHashes: string[] = [];

        globalThis.fetch = async (input, init) => {
            const url = new URL(String(input));
            const method = init?.method ?? "GET";
            const headers = new Headers(init?.headers);
            requests.push({
                method,
                path: url.pathname,
                filename: headers.get("X-Draftbox-Filename"),
                sourceFilename: headers.get("X-Draftbox-Source-Filename"),
                description: headers.get("X-Draftbox-Description"),
            });
            if (method === "POST") {
                sourceHashes.push(headers.get("X-Draftbox-Source-Hash") ?? "");
            }

            return Response.json(
                { artifact: { ...artifact, description: "Updated description" }, version },
                { status: 201 },
            );
        };

        const api = new DraftboxApi(config);
        await api.upload(filePath, { artifactId: artifact.id });
        assert.deepEqual(requests, [{
            method: "POST",
            path: `/api/artifacts/${artifact.id}/versions`,
            filename: null,
            sourceFilename: null,
            description: null,
        }]);
        const expectedSourceHash = createHash("sha256")
            .update(`${hostname()}:${await realpath(filePath)}`)
            .digest("hex");
        assert.deepEqual(sourceHashes, [expectedSourceHash]);

        const result = await api.upload(filePath, {
            artifactId: artifact.id,
            description: "Updated description",
        });
        assert.deepEqual(requests.slice(1), [{
            method: "POST",
            path: `/api/artifacts/${artifact.id}/versions`,
            filename: null,
            sourceFilename: null,
            description: encodeURIComponent("Updated description"),
        }]);
        assert.equal(result.artifact.description, "Updated description");
        assert.deepEqual(sourceHashes, [expectedSourceHash, expectedSourceHash]);

        await api.upload(filePath, {});
        assert.deepEqual(requests.slice(2), [{
            method: "POST",
            path: "/api/artifacts",
            filename: null,
            sourceFilename: encodeURIComponent(basename(filePath)),
            description: null,
        }]);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalConfigDirectory === undefined) {
            delete process.env.DRAFTBOX_CONFIG_DIR;
        } else {
            process.env.DRAFTBOX_CONFIG_DIR = originalConfigDirectory;
        }
        await rm(directory, { recursive: true, force: true });
    }
});
