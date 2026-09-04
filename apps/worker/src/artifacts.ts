import {
    artifactListResponseSchema,
    artifactMetadataPatchSchema,
    artifactResponseSchema,
    artifactVersionResponseSchema,
    createArtifactRequestSchema,
    updateArtifactRequestSchema,
    versionListResponseSchema,
    type Artifact,
    type ArtifactMetadataPatch,
    type UpdateArtifactRequest,
    type Version,
} from "@draftbox/contracts";

import { ApiError, jsonResponse } from "./http";
import { assertUploadFitsStorage } from "./quota";
import type {
    ArtifactRow,
    AuthenticatedUser,
    Env,
    VersionRow,
} from "./types";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const SOURCE_HASH_PATTERN = /^[a-f0-9]{64}$/;

interface AllocatedVersionRow {
    version_number: number;
}

interface PreparedUpload {
    sourceHash: string;
    bytes: ArrayBuffer;
    metadataPatch: ArtifactMetadataPatch;
}

function encodeBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
}

function createShareSecret(): string {
    return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function getOrigin(request: Request): string {
    return new URL(request.url).origin;
}

function artifactLink(origin: string, shareSecret: string): string {
    return `${origin}/p/${shareSecret}`;
}

function versionLink(origin: string, shareSecret: string, version: number): string {
    return `${artifactLink(origin, shareSecret)}/v${version}`;
}

function artifactJson(artifact: ArtifactRow, origin: string): Artifact {
    return {
        id: artifact.id,
        filename: artifact.filename,
        description: artifact.description,
        currentVersion: artifact.current_version,
        url: artifactLink(origin, artifact.share_secret),
        createdAt: artifact.created_at,
        updatedAt: artifact.updated_at,
    };
}

function versionJson(
    version: VersionRow,
    shareSecret: string,
    origin: string,
): Version {
    return {
        version: version.version_number,
        url: versionLink(origin, shareSecret, version.version_number),
        size: version.byte_size,
        contentHash: version.content_hash,
        createdAt: version.created_at,
    };
}

function readEncodedHeader(request: Request, name: string): string | null {
    const value = request.headers.get(name);
    if (value === null) {
        return null;
    }

    try {
        return decodeURIComponent(value);
    } catch {
        throw new ApiError(400, "invalid_metadata", `The ${name} header is invalid.`);
    }
}

function readMetadataHeaders(request: Request): ArtifactMetadataPatch {
    return artifactMetadataPatchSchema.parse({
        filename: readEncodedHeader(request, "X-Draftbox-Filename") ?? undefined,
        description: readEncodedHeader(request, "X-Draftbox-Description") ?? undefined,
    });
}

function readSourceHash(request: Request): string {
    const sourceHash = request.headers.get("X-Draftbox-Source-Hash");
    if (sourceHash === null) {
        throw new ApiError(
            400,
            "missing_metadata",
            "The X-Draftbox-Source-Hash header is required.",
        );
    }
    if (!SOURCE_HASH_PATTERN.test(sourceHash)) {
        throw new ApiError(
            400,
            "invalid_metadata",
            "The X-Draftbox-Source-Hash header is invalid.",
        );
    }

    return sourceHash;
}

async function readUpload(request: Request): Promise<ArrayBuffer> {
    const declaredLength = request.headers.get("Content-Length");
    if (declaredLength !== null && Number(declaredLength) > MAX_UPLOAD_BYTES) {
        throw new ApiError(413, "upload_too_large", "Uploads may not exceed 10 MB.");
    }

    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new ApiError(413, "upload_too_large", "Uploads may not exceed 10 MB.");
    }

    return bytes;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function findOwnedArtifact(
    env: Env,
    artifactId: string,
    ownerId: string,
): Promise<ArtifactRow> {
    const artifact = await env.DB.prepare(
        "SELECT * FROM artifacts WHERE id = ? AND owner_id = ?",
    )
        .bind(artifactId, ownerId)
        .first<ArtifactRow>();

    if (artifact === null) {
        throw new ApiError(404, "artifact_not_found", "Artifact not found.");
    }

    return artifact;
}

async function findArtifactBySourceHash(
    env: Env,
    ownerId: string,
    sourceHash: string,
): Promise<ArtifactRow | null> {
    return env.DB.prepare(
        `SELECT artifacts.*
         FROM upload_sources
         JOIN artifacts ON artifacts.id = upload_sources.artifact_id
         WHERE upload_sources.owner_id = ? AND upload_sources.source_hash = ?`,
    )
        .bind(ownerId, sourceHash)
        .first<ArtifactRow>();
}

function isUploadSourceConflict(error: unknown): boolean {
    const messages: string[] = [];
    let current: unknown = error;
    while (current instanceof Error) {
        messages.push(current.message);
        current = current.cause;
    }
    if (typeof current === "string") {
        messages.push(current);
    }
    return messages.some((message) =>
        /UNIQUE constraint failed: upload_sources\./i.test(message));
}

export async function createArtifact(
    request: Request,
    env: Env,
    user: AuthenticatedUser,
): Promise<Response> {
    const sourceHash = readSourceHash(request);
    const existingArtifact = await findArtifactBySourceHash(env, user.id, sourceHash);
    if (existingArtifact !== null) {
        return addVersion(request, env, user, existingArtifact.id);
    }

    const filenameHeader =
        readEncodedHeader(request, "X-Draftbox-Filename") ??
        readEncodedHeader(request, "X-Draftbox-Source-Filename");
    if (filenameHeader === null) {
        throw new ApiError(
            400,
            "missing_metadata",
            "The X-Draftbox-Filename header is required.",
        );
    }

    const { filename, description } = createArtifactRequestSchema.parse({
        filename: filenameHeader,
        description: readEncodedHeader(request, "X-Draftbox-Description") ?? "",
    });

    const bytes = await readUpload(request);
    await assertUploadFitsStorage(env, bytes.byteLength);
    const now = new Date().toISOString();
    const artifactId = crypto.randomUUID();
    const shareSecret = createShareSecret();
    const r2Key = `${artifactId}/v1`;
    const contentHash = await sha256(bytes);

    await env.ARTIFACTS.put(r2Key, bytes, {
        customMetadata: {
            artifactId,
            versionNumber: "1",
            contentHash,
            sourceHash,
            size: String(bytes.byteLength),
            uploadedAt: now,
        },
        httpMetadata: {
            contentType: "text/html; charset=utf-8",
        },
    });

    try {
        await env.DB.batch([
            env.DB.prepare(
                `INSERT INTO artifacts (
                    id, owner_id, filename, description, share_secret,
                    current_version, next_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 1, 2, ?, ?)`,
            ).bind(
                artifactId,
                user.id,
                filename,
                description,
                shareSecret,
                now,
                now,
            ),
            env.DB.prepare(
                `INSERT INTO versions (
                    artifact_id, version_number, r2_key, content_hash, source_hash,
                    byte_size, created_at
                ) VALUES (?, 1, ?, ?, ?, ?, ?)`,
            ).bind(artifactId, r2Key, contentHash, sourceHash, bytes.byteLength, now),
            env.DB.prepare(
                `INSERT INTO upload_sources (owner_id, source_hash, artifact_id)
                 VALUES (?, ?, ?)`,
            ).bind(user.id, sourceHash, artifactId),
        ]);
    } catch (error) {
        await env.ARTIFACTS.delete(r2Key);
        if (isUploadSourceConflict(error)) {
            const bound = await findArtifactBySourceHash(env, user.id, sourceHash);
            if (bound !== null) {
                return addPreparedVersion(request, env, user, bound, {
                    sourceHash,
                    bytes,
                    metadataPatch: { filename, description },
                });
            }
        }
        throw error;
    }

    const artifact: ArtifactRow = {
        id: artifactId,
        owner_id: user.id,
        filename,
        description,
        share_secret: shareSecret,
        current_version: 1,
        next_version: 2,
        created_at: now,
        updated_at: now,
    };

    return jsonResponse(
        artifactVersionResponseSchema,
        {
            artifact: artifactJson(artifact, getOrigin(request)),
            version: {
                version: 1,
                url: versionLink(getOrigin(request), shareSecret, 1),
                size: bytes.byteLength,
                contentHash,
                createdAt: now,
            },
        },
        { status: 201 },
    );
}

export async function addVersion(
    request: Request,
    env: Env,
    user: AuthenticatedUser,
    artifactId: string,
): Promise<Response> {
    const sourceHash = readSourceHash(request);
    const metadataPatch = readMetadataHeaders(request);
    const bytes = await readUpload(request);
    const artifact = await findOwnedArtifact(env, artifactId, user.id);
    await assertUploadFitsStorage(env, bytes.byteLength);
    return addPreparedVersion(request, env, user, artifact, { sourceHash, metadataPatch, bytes });
}

async function addPreparedVersion(
    request: Request,
    env: Env,
    user: AuthenticatedUser,
    artifact: ArtifactRow,
    upload: PreparedUpload,
): Promise<Response> {
    const { sourceHash, metadataPatch, bytes } = upload;
    const artifactId = artifact.id;
    const allocated = await env.DB.prepare(
        `UPDATE artifacts
         SET next_version = next_version + 1
         WHERE id = ? AND owner_id = ?
         RETURNING next_version - 1 AS version_number`,
    )
        .bind(artifactId, user.id)
        .first<AllocatedVersionRow>();

    if (allocated === null) {
        throw new ApiError(404, "artifact_not_found", "Artifact not found.");
    }

    const filename = metadataPatch.filename ?? artifact.filename;
    const description = metadataPatch.description ?? artifact.description;
    const versionNumber = allocated.version_number;
    const r2Key = `${artifactId}/v${versionNumber}`;
    const now = new Date().toISOString();
    const contentHash = await sha256(bytes);

    await env.ARTIFACTS.put(r2Key, bytes, {
        customMetadata: {
            artifactId,
            versionNumber: String(versionNumber),
            contentHash,
            sourceHash,
            size: String(bytes.byteLength),
            uploadedAt: now,
        },
        httpMetadata: {
            contentType: "text/html; charset=utf-8",
        },
    });

    try {
        await env.DB.batch([
            env.DB.prepare(
                `INSERT INTO versions (
                    artifact_id, version_number, r2_key, content_hash, source_hash,
                    byte_size, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
                artifactId,
                versionNumber,
                r2Key,
                contentHash,
                sourceHash,
                bytes.byteLength,
                now,
            ),
            env.DB.prepare(
                `UPDATE artifacts
                 SET current_version = MAX(current_version, ?),
                     filename = ?, description = ?, updated_at = ?
                 WHERE id = ? AND owner_id = ?`,
            ).bind(versionNumber, filename, description, now, artifactId, user.id),
        ]);
    } catch (error) {
        await env.ARTIFACTS.delete(r2Key);
        throw error;
    }

    return jsonResponse(
        artifactVersionResponseSchema,
        {
            artifact: {
                ...artifactJson(artifact, getOrigin(request)),
                filename,
                description,
                currentVersion: Math.max(artifact.current_version, versionNumber),
                updatedAt: now,
            },
            version: {
                version: versionNumber,
                url: versionLink(getOrigin(request), artifact.share_secret, versionNumber),
                size: bytes.byteLength,
                contentHash,
                createdAt: now,
            },
        },
        { status: 201 },
    );
}

export async function listArtifacts(
    request: Request,
    env: Env,
    user: AuthenticatedUser,
): Promise<Response> {
    const result = await env.DB.prepare(
        "SELECT * FROM artifacts WHERE owner_id = ? ORDER BY updated_at DESC",
    )
        .bind(user.id)
        .all<ArtifactRow>();

    return jsonResponse(
        artifactListResponseSchema,
        {
            artifacts: result.results.map((artifact) => artifactJson(artifact, getOrigin(request))),
        },
    );
}

export async function listVersions(
    request: Request,
    env: Env,
    user: AuthenticatedUser,
    artifactId: string,
): Promise<Response> {
    const artifact = await findOwnedArtifact(env, artifactId, user.id);
    const result = await env.DB.prepare(
        "SELECT * FROM versions WHERE artifact_id = ? ORDER BY version_number DESC",
    )
        .bind(artifactId)
        .all<VersionRow>();

    return jsonResponse(
        versionListResponseSchema,
        {
            artifact: artifactJson(artifact, getOrigin(request)),
            versions: result.results.map((version) =>
                versionJson(version, artifact.share_secret, getOrigin(request)),
            ),
        },
    );
}

async function readMetadataPatch(request: Request): Promise<UpdateArtifactRequest> {
    let value: unknown;
    try {
        value = await request.json();
    } catch {
        throw new ApiError(400, "invalid_json", "The request body must be valid JSON.");
    }

    const result = updateArtifactRequestSchema.safeParse(value);
    if (!result.success) {
        const message = result.error.issues[0]?.message ?? "The metadata is invalid.";
        throw new ApiError(400, "invalid_metadata", message);
    }

    return result.data;
}

export async function editArtifact(
    request: Request,
    env: Env,
    user: AuthenticatedUser,
    artifactId: string,
): Promise<Response> {
    const existing = await findOwnedArtifact(env, artifactId, user.id);
    const patch = await readMetadataPatch(request);
    const filename = patch.filename ?? existing.filename;
    const description = patch.description ?? existing.description;
    const now = new Date().toISOString();

    const updated = await env.DB.prepare(
        `UPDATE artifacts
         SET filename = ?, description = ?, updated_at = ?
         WHERE id = ? AND owner_id = ?
         RETURNING *`,
    )
        .bind(filename, description, now, artifactId, user.id)
        .first<ArtifactRow>();

    if (updated === null) {
        throw new ApiError(404, "artifact_not_found", "Artifact not found.");
    }

    return jsonResponse(
        artifactResponseSchema,
        { artifact: artifactJson(updated, getOrigin(request)) },
    );
}

export async function rotateLink(
    request: Request,
    env: Env,
    user: AuthenticatedUser,
    artifactId: string,
): Promise<Response> {
    const shareSecret = createShareSecret();
    const now = new Date().toISOString();
    const updated = await env.DB.prepare(
        `UPDATE artifacts
         SET share_secret = ?, updated_at = ?
         WHERE id = ? AND owner_id = ?
         RETURNING *`,
    )
        .bind(shareSecret, now, artifactId, user.id)
        .first<ArtifactRow>();

    if (updated === null) {
        throw new ApiError(404, "artifact_not_found", "Artifact not found.");
    }

    return jsonResponse(
        artifactResponseSchema,
        { artifact: artifactJson(updated, getOrigin(request)) },
    );
}

export async function deleteArtifact(
    env: Env,
    user: AuthenticatedUser,
    artifactId: string,
): Promise<Response> {
    await findOwnedArtifact(env, artifactId, user.id);
    const versions = await env.DB.prepare(
        "SELECT * FROM versions WHERE artifact_id = ? ORDER BY version_number DESC",
    )
        .bind(artifactId)
        .all<VersionRow>();

    await env.DB.prepare("DELETE FROM artifacts WHERE id = ? AND owner_id = ?")
        .bind(artifactId, user.id)
        .run();

    const keys = versions.results.map((version) => version.r2_key);
    for (let start = 0; start < keys.length; start += 1_000) {
        await env.ARTIFACTS.delete(keys.slice(start, start + 1_000));
    }

    return new Response(null, { status: 204 });
}

export async function deleteVersion(
    env: Env,
    user: AuthenticatedUser,
    artifactId: string,
    versionNumber: number,
): Promise<Response> {
    await findOwnedArtifact(env, artifactId, user.id);
    const version = await env.DB.prepare(
        "SELECT * FROM versions WHERE artifact_id = ? AND version_number = ?",
    )
        .bind(artifactId, versionNumber)
        .first<VersionRow>();

    if (version === null) {
        throw new ApiError(404, "version_not_found", "Version not found.");
    }

    const now = new Date().toISOString();
    await env.DB.batch([
        env.DB.prepare(
            "DELETE FROM versions WHERE artifact_id = ? AND version_number = ?",
        ).bind(artifactId, versionNumber),
        env.DB.prepare(
            `UPDATE artifacts
             SET current_version = (
                 SELECT MAX(version_number) FROM versions WHERE artifact_id = ?
             ), updated_at = ?
             WHERE id = ? AND owner_id = ?
               AND EXISTS (SELECT 1 FROM versions WHERE artifact_id = ?)`,
        ).bind(artifactId, now, artifactId, user.id, artifactId),
        env.DB.prepare(
            `DELETE FROM artifacts
             WHERE id = ? AND owner_id = ?
               AND NOT EXISTS (SELECT 1 FROM versions WHERE artifact_id = ?)`,
        ).bind(artifactId, user.id, artifactId),
    ]);

    await env.ARTIFACTS.delete(version.r2_key);

    return new Response(null, { status: 204 });
}
