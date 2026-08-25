import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { hostname } from "node:os";
import { basename } from "node:path";

import {
    apiErrorResponseSchema,
    artifactListResponseSchema,
    artifactResponseSchema,
    artifactVersionResponseSchema,
    artifactMetadataPatchSchema,
    updateArtifactRequestSchema,
    userResponseSchema,
    versionListResponseSchema,
    type ApiErrorCode,
    type ContractSchema,
    type CreateArtifactRequest,
    type UpdateArtifactRequest,
} from "@draftbox/contracts";

import { getAccessToken } from "./auth.js";
import type { CliConfig } from "./config.js";

export type { Artifact, Version } from "@draftbox/contracts";

export class DraftboxApiError extends Error {
    readonly code: ApiErrorCode;
    readonly status: number;

    constructor(status: number, code: ApiErrorCode, message: string) {
        super(message);
        this.name = "DraftboxApiError";
        this.code = code;
        this.status = status;
    }
}

function invalidResponse(status: number, detail: string, cause?: unknown): Error {
    return new Error(
        `Draftbox returned an invalid response with status ${status} (${detail})`,
        cause === undefined ? undefined : { cause },
    );
}

function readApiError(value: unknown, status: number): Error {
    const result = apiErrorResponseSchema.safeParse(value);
    if (result.success) {
        return new DraftboxApiError(
            status,
            result.data.error.code,
            result.data.error.message,
        );
    }
    return invalidResponse(
        status,
        result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        result.error,
    );
}

async function readJson(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch (error) {
        throw invalidResponse(response.status, "response body was not valid JSON", error);
    }
}

export class DraftboxApi {
    readonly config: CliConfig;

    constructor(config: CliConfig) {
        this.config = config;
    }

    async #request<T>(
        path: string,
        responseSchema: ContractSchema<T>,
        init?: RequestInit,
    ): Promise<T>;
    async #request(
        path: string,
        responseSchema: null,
        init?: RequestInit,
    ): Promise<void>;
    async #request<T>(
        path: string,
        responseSchema: ContractSchema<T> | null,
        init: RequestInit = {},
    ): Promise<T | void> {
        const send = (token: string) => {
            const headers = new Headers(init.headers);
            headers.set("Authorization", `Bearer ${token}`);
            return fetch(`${this.config.apiUrl}${path}`, { ...init, headers });
        };

        let response = await send(await getAccessToken(this.config));
        if (response.status === 401) {
            response = await send(await getAccessToken(this.config, true));
        }

        if (!response.ok) {
            throw readApiError(await readJson(response), response.status);
        }
        if (responseSchema === null) {
            return;
        }
        if (response.status === 204) {
            throw invalidResponse(204, "expected a response body but received none");
        }

        const result = responseSchema.safeParse(await readJson(response));
        if (!result.success) {
            throw invalidResponse(
                response.status,
                result.error.issues
                    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                    .join("; "),
                result.error,
            );
        }
        return result.data;
    }

    async whoami() {
        return this.#request("/api/whoami", userResponseSchema);
    }

    async listArtifacts() {
        return this.#request("/api/artifacts", artifactListResponseSchema);
    }

    async listVersions(artifactId: string) {
        return this.#request(
            `/api/artifacts/${encodeURIComponent(artifactId)}/versions`,
            versionListResponseSchema,
        );
    }

    async upload(
        filePath: string,
        options: { artifactId?: string } & Partial<CreateArtifactRequest>,
    ) {
        const resolvedFilePath = await realpath(filePath);
        const bytes = await readFile(resolvedFilePath);
        const sourceHash = createHash("sha256")
            .update(`${hostname()}:${resolvedFilePath}`)
            .digest("hex");
        const metadata = artifactMetadataPatchSchema.parse({
            filename: options.filename,
            description: options.description,
        });
        const path =
            options.artifactId === undefined
                ? "/api/artifacts"
                : `/api/artifacts/${encodeURIComponent(options.artifactId)}/versions`;

        const headers = new Headers({
            "Content-Type": "application/octet-stream",
            "X-Draftbox-Source-Hash": sourceHash,
        });
        if (options.artifactId === undefined) {
            headers.set("X-Draftbox-Source-Filename", encodeURIComponent(basename(filePath)));
        }
        if (metadata.filename !== undefined) {
            headers.set("X-Draftbox-Filename", encodeURIComponent(metadata.filename));
        }
        if (metadata.description !== undefined) {
            headers.set("X-Draftbox-Description", encodeURIComponent(metadata.description));
        }

        return this.#request(path, artifactVersionResponseSchema, {
            method: "POST",
            headers,
            body: bytes,
        });
    }

    async edit(
        artifactId: string,
        metadata: UpdateArtifactRequest,
    ) {
        const request = updateArtifactRequestSchema.parse(metadata);
        return this.#request(
            `/api/artifacts/${encodeURIComponent(artifactId)}`,
            artifactResponseSchema,
            {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(request),
            },
        );
    }

    async rotateLink(artifactId: string) {
        return this.#request(
            `/api/artifacts/${encodeURIComponent(artifactId)}/rotate-link`,
            artifactResponseSchema,
            { method: "POST" },
        );
    }

    async deleteArtifact(artifactId: string): Promise<void> {
        await this.#request(`/api/artifacts/${encodeURIComponent(artifactId)}`, null, {
            method: "DELETE",
        });
    }

    async deleteVersion(artifactId: string, version: number): Promise<void> {
        await this.#request(
            `/api/artifacts/${encodeURIComponent(artifactId)}/versions/${version}`,
            null,
            { method: "DELETE" },
        );
    }
}
