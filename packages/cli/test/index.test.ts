import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

import packageJson from "../package.json" with { type: "json" };

const execFileAsync = promisify(execFile);
const entrypoint = new URL("../dist/index.js", import.meta.url);

test("prints the package version", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
        entrypoint.pathname,
        "--version",
    ]);

    assert.equal(stdout.trim(), packageJson.version);
});

test("passes delete --version to the delete command", async () => {
    const configDirectory = await mkdtemp(join(tmpdir(), "draftbox-index-test-"));
    try {
        await assert.rejects(
            execFileAsync(process.execPath, [
                entrypoint.pathname,
                "delete",
                "artifact-id",
                "--version",
                "2",
                "--yes",
            ], {
                env: { ...process.env, DRAFTBOX_CONFIG_DIR: configDirectory },
            }),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /You are not signed in/);
                assert.doesNotMatch(error.message, /0\.0\.0/);
                return true;
            },
        );
    } finally {
        await rm(configDirectory, { recursive: true, force: true });
    }
});
