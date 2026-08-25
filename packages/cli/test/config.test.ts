import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "../src/config.ts";

test("loads deployment configuration from environment overrides", () => {
    const config = loadConfig({
        DRAFTBOX_API_URL: "https://draftbox.example/",
        DRAFTBOX_WORKOS_AUTHKIT_URL: "https://login.example/",
        DRAFTBOX_WORKOS_CLIENT_ID: "client_example",
    });

    assert.deepEqual(config, {
        apiUrl: "https://draftbox.example",
        authkitUrl: "https://login.example",
        clientId: "client_example",
    });
});

test("uses the source defaults when no overrides are provided", () => {
    assert.deepEqual(loadConfig({}), {
        apiUrl: "https://draftbox.flyme2bluemoon.workers.dev",
        authkitUrl: "https://palatial-chess-26-staging.authkit.app",
        clientId: "client_01M0PNAJFAWP8RH8SXQY2Q7TS5",
    });
});
