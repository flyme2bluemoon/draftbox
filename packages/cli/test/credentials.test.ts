import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
    clearCredentials,
    credentialsPath,
    loadCredentials,
    saveCredentials,
} from "../src/credentials.ts";

const directory = await mkdtemp(join(tmpdir(), "draftbox-credentials-"));
const environment = { DRAFTBOX_CONFIG_DIR: directory };

after(async () => {
    await rm(directory, { recursive: true, force: true });
});

test("saves, loads, and clears credentials with owner-only permissions", async () => {
    const credentials = { accessToken: "access", refreshToken: "refresh" };
    assert.equal(await loadCredentials(environment), null);

    await saveCredentials(credentials, environment);
    assert.deepEqual(await loadCredentials(environment), credentials);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(credentialsPath(environment))).mode & 0o777, 0o600);
    assert.match(await readFile(credentialsPath(environment), "utf8"), /"refreshToken"/);

    assert.equal(await clearCredentials(environment), true);
    assert.equal(await clearCredentials(environment), false);
});
