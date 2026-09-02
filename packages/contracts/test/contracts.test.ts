import assert from "node:assert/strict";
import { test } from "node:test";

import {
    apiErrorResponseSchema,
    artifactMetadataPatchSchema,
    artifactVersionResponseSchema,
    updateArtifactRequestSchema,
} from "../src/index.ts";

test("accepts a complete artifact upload response", () => {
    const response = {
        artifact: {
            id: "c848101a-3fe0-4d7e-b89a-0e19550d6549",
            filename: "page.html",
            description: "Example page",
            currentVersion: 1,
            url: "https://draftbox.example/p/secret",
            createdAt: "2026-08-23T10:00:00.000Z",
            updatedAt: "2026-08-23T10:00:00.000Z",
        },
        version: {
            version: 1,
            url: "https://draftbox.example/p/secret/v1",
            size: 42,
            contentHash: "a".repeat(64),
            createdAt: "2026-08-23T10:00:00.000Z",
        },
    };

    assert.deepEqual(artifactVersionResponseSchema.parse(response), response);
});

test("rejects empty and unknown metadata patches", () => {
    assert.equal(updateArtifactRequestSchema.safeParse({}).success, false);
    assert.equal(updateArtifactRequestSchema.safeParse({ filename: "page.html", extra: true }).success, false);
    assert.deepEqual(artifactMetadataPatchSchema.parse({}), {});
    assert.equal(artifactMetadataPatchSchema.safeParse({ extra: true }).success, false);
});

test("rejects malformed API errors", () => {
    assert.equal(apiErrorResponseSchema.safeParse({ error: { message: "Nope" } }).success, false);
});

test("accepts quota_exceeded API errors", () => {
    const response = {
        error: {
            code: "quota_exceeded",
            message: "R2 storage would exceed the 9.5 GB free-tier cap.",
        },
    };
    assert.deepEqual(apiErrorResponseSchema.parse(response), response);
});
