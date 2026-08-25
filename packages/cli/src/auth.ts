import { spawn } from "node:child_process";

import type { CliConfig } from "./config.js";
import {
    clearCredentials,
    loadCredentials,
    saveCredentials,
    type Credentials,
} from "./credentials.js";

const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

interface DeviceAuthorization {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
}

interface TokenResponse {
    access_token: string;
    refresh_token: string;
}

interface OAuthError {
    error: string;
    error_description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDeviceAuthorization(value: unknown): DeviceAuthorization {
    if (
        !isRecord(value)
        || typeof value.device_code !== "string"
        || typeof value.user_code !== "string"
        || typeof value.verification_uri !== "string"
        || typeof value.verification_uri_complete !== "string"
        || typeof value.expires_in !== "number"
        || typeof value.interval !== "number"
    ) {
        throw new Error("WorkOS returned an invalid device authorization response");
    }

    return {
        device_code: value.device_code,
        user_code: value.user_code,
        verification_uri: value.verification_uri,
        verification_uri_complete: value.verification_uri_complete,
        expires_in: value.expires_in,
        interval: value.interval,
    };
}

function parseTokenResponse(value: unknown): TokenResponse {
    if (
        !isRecord(value)
        || typeof value.access_token !== "string"
        || typeof value.refresh_token !== "string"
    ) {
        throw new Error("WorkOS returned an invalid token response");
    }

    return {
        access_token: value.access_token,
        refresh_token: value.refresh_token,
    };
}

function parseOAuthError(value: unknown): OAuthError {
    if (!isRecord(value) || typeof value.error !== "string") {
        return { error: "unknown_error" };
    }

    return {
        error: value.error,
        ...(typeof value.error_description === "string"
            ? { error_description: value.error_description }
            : {}),
    };
}

async function postForm(url: string, values: Record<string, string>): Promise<Response> {
    return fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(values),
    });
}

function tryOpenBrowser(url: string, authkitUrl: string): void {
    let trusted = false;
    try {
        trusted = new URL(url).origin === new URL(authkitUrl).origin;
    } catch {
        trusted = false;
    }
    if (!trusted) {
        console.log(`Open this URL in your browser: ${url}`);
        return;
    }

    const command = process.platform === "darwin"
        ? { executable: "open", args: [url] }
        : process.platform === "win32"
            ? { executable: "cmd", args: ["/c", "start", "", url] }
            : { executable: "xdg-open", args: [url] };

    const child = spawn(command.executable, command.args, {
        detached: true,
        stdio: "ignore",
    });
    child.on("error", () => undefined);
    child.unref();
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestDeviceAuthorization(config: CliConfig): Promise<DeviceAuthorization> {
    const response = await postForm(`${config.authkitUrl}/oauth2/device_authorization`, {
        client_id: config.clientId,
        scope: "openid profile email offline_access",
    });
    const body: unknown = await response.json();
    if (!response.ok) {
        const error = parseOAuthError(body);
        throw new Error(error.error_description ?? `WorkOS authorization failed: ${error.error}`);
    }

    return parseDeviceAuthorization(body);
}

async function pollForTokens(
    config: CliConfig,
    authorization: DeviceAuthorization,
): Promise<TokenResponse> {
    const deadline = Date.now() + authorization.expires_in * 1_000;
    let interval = Math.max(authorization.interval, 1);

    while (Date.now() < deadline) {
        await sleep(interval * 1_000);
        if (Date.now() >= deadline) {
            break;
        }
        const response = await postForm(`${config.authkitUrl}/oauth2/token`, {
            client_id: config.clientId,
            device_code: authorization.device_code,
            grant_type: DEVICE_GRANT,
        });
        const body: unknown = await response.json();
        if (response.ok) {
            return parseTokenResponse(body);
        }

        const error = parseOAuthError(body);
        if (error.error === "authorization_pending") {
            continue;
        }
        if (error.error === "slow_down") {
            interval += 5;
            continue;
        }
        if (error.error === "access_denied") {
            throw new Error("Authorization was denied");
        }
        if (error.error === "expired_token") {
            throw new Error("The authorization code expired. Run login again");
        }

        throw new Error(error.error_description ?? `WorkOS authorization failed: ${error.error}`);
    }

    throw new Error("Authorization timed out. Run login again");
}

export async function login(config: CliConfig): Promise<void> {
    const authorization = await requestDeviceAuthorization(config);
    console.log(`Open ${authorization.verification_uri}`);
    console.log(`Enter code: ${authorization.user_code}`);
    tryOpenBrowser(authorization.verification_uri_complete, config.authkitUrl);

    const tokens = await pollForTokens(config, authorization);
    await saveCredentials({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
    });
    console.log("Signed in.");
}

export async function logout(): Promise<void> {
    const removed = await clearCredentials();
    console.log(removed ? "Signed out." : "Already signed out.");
}

async function refreshCredentials(
    config: CliConfig,
    credentials: Credentials,
): Promise<Credentials> {
    const response = await postForm(`${config.authkitUrl}/oauth2/token`, {
        client_id: config.clientId,
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
    });
    const body: unknown = await response.json();
    if (!response.ok) {
        const error = parseOAuthError(body);
        if (error.error === "invalid_grant") {
            await clearCredentials();
            throw new Error("Your session expired. Run draftbox login");
        }
        throw new Error(error.error_description ?? `Session refresh failed: ${error.error}`);
    }

    const tokens = parseTokenResponse(body);
    const refreshed = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
    };
    await saveCredentials(refreshed);
    return refreshed;
}

function tokenExpiresSoon(token: string): boolean {
    try {
        const payloadPart = token.split(".")[1];
        if (payloadPart === undefined) {
            return true;
        }
        const payloadText = Buffer.from(payloadPart, "base64url").toString("utf8");
        const payload: unknown = JSON.parse(payloadText);
        return !isRecord(payload)
            || typeof payload.exp !== "number"
            || payload.exp * 1_000 <= Date.now() + 30_000;
    } catch {
        return true;
    }
}

export async function getAccessToken(config: CliConfig, forceRefresh = false): Promise<string> {
    const credentials = await loadCredentials();
    if (credentials === null) {
        throw new Error("You are not signed in. Run draftbox login");
    }

    if (!forceRefresh && !tokenExpiresSoon(credentials.accessToken)) {
        return credentials.accessToken;
    }

    const refreshed = await refreshCredentials(config, credentials);
    return refreshed.accessToken;
}
