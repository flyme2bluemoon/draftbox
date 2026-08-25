import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Credentials {
    accessToken: string;
    refreshToken: string;
}

function credentialsDirectory(environment: NodeJS.ProcessEnv = process.env): string {
    const configured = environment.DRAFTBOX_CONFIG_DIR;
    if (configured !== undefined && configured.length > 0) {
        return configured;
    }

    const configHome = environment.XDG_CONFIG_HOME;
    if (configHome !== undefined && configHome.length > 0) {
        return join(configHome, "draftbox");
    }

    return join(homedir(), ".config", "draftbox");
}

export function credentialsPath(environment: NodeJS.ProcessEnv = process.env): string {
    return join(credentialsDirectory(environment), "credentials.json");
}

export async function loadCredentials(
    environment: NodeJS.ProcessEnv = process.env,
): Promise<Credentials | null> {
    try {
        const contents = await readFile(credentialsPath(environment), "utf8");
        const value: unknown = JSON.parse(contents);
        if (
            typeof value !== "object"
            || value === null
            || !("accessToken" in value)
            || !("refreshToken" in value)
            || typeof value.accessToken !== "string"
            || typeof value.refreshToken !== "string"
        ) {
            throw new Error("The credentials file is malformed");
        }

        return {
            accessToken: value.accessToken,
            refreshToken: value.refreshToken,
        };
    } catch (error) {
        if (isFileNotFound(error)) {
            return null;
        }
        throw error;
    }
}

export async function saveCredentials(
    credentials: Credentials,
    environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
    const directory = credentialsDirectory(environment);
    const path = credentialsPath(environment);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    await writeFile(path, `${JSON.stringify(credentials, null, 4)}\n`, {
        encoding: "utf8",
        mode: 0o600,
    });
    await chmod(path, 0o600);
}

export async function clearCredentials(
    environment: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
    try {
        await rm(credentialsPath(environment));
        return true;
    } catch (error) {
        if (isFileNotFound(error)) {
            return false;
        }
        throw error;
    }
}

function isFileNotFound(error: unknown): boolean {
    return error instanceof Error
        && "code" in error
        && error.code === "ENOENT";
}
