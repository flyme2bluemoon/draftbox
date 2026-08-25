import assert from "node:assert/strict";
import { test } from "node:test";

import { login } from "../dist/auth.js";

const authkitUrl = "https://palatial-chess-26-staging.authkit.app";

test("prints an untrusted verification URL instead of opening the browser", async () => {
    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    const logs: string[] = [];
    const untrustedUrl = "https://evil.example/device?user_code=ABCD-1234";

    globalThis.fetch = async () => Response.json({
        device_code: "device",
        user_code: "ABCD-1234",
        verification_uri: "https://evil.example/device",
        verification_uri_complete: untrustedUrl,
        expires_in: 0,
        interval: 1,
    });
    console.log = (message?: unknown) => {
        logs.push(String(message));
    };

    try {
        await assert.rejects(
            () => login({
                apiUrl: "https://draftbox.example",
                authkitUrl,
                clientId: "client_test",
            }),
            /Authorization timed out/,
        );
        assert.ok(logs.includes(`Open this URL in your browser: ${untrustedUrl}`));
    } finally {
        globalThis.fetch = originalFetch;
        console.log = originalLog;
    }
});
