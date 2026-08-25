export const DEFAULT_API_URL = "https://draftbox.flyme2bluemoon.workers.dev";
export const DEFAULT_AUTHKIT_URL = "https://palatial-chess-26-staging.authkit.app";
export const DEFAULT_WORKOS_CLIENT_ID = "client_01M0PNAJFAWP8RH8SXQY2Q7TS5";

export interface CliConfig {
    apiUrl: string;
    authkitUrl: string;
    clientId: string;
}

function withoutTrailingSlash(value: string): string {
    return value.replace(/\/+$/, "");
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): CliConfig {
    return {
        apiUrl: withoutTrailingSlash(environment.DRAFTBOX_API_URL ?? DEFAULT_API_URL),
        authkitUrl: withoutTrailingSlash(
            environment.DRAFTBOX_WORKOS_AUTHKIT_URL ?? DEFAULT_AUTHKIT_URL,
        ),
        clientId: environment.DRAFTBOX_WORKOS_CLIENT_ID ?? DEFAULT_WORKOS_CLIENT_ID,
    };
}
