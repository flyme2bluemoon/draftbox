import { z } from "zod";

const positiveIntegerSchema = z.number().int().positive();

export const userSchema = z.strictObject({
    id: z.string().min(1),
    email: z.email().nullable(),
});

export const artifactSchema = z.strictObject({
    id: z.uuid(),
    filename: z.string(),
    description: z.string(),
    currentVersion: positiveIntegerSchema,
    url: z.url(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
});

export const versionSchema = z.strictObject({
    version: positiveIntegerSchema,
    url: z.url(),
    size: z.number().int().nonnegative(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.iso.datetime(),
});

export const createArtifactRequestSchema = z.strictObject({
    filename: z.string(),
    description: z.string(),
});

export const artifactMetadataPatchSchema = z.strictObject({
    filename: z.string().optional(),
    description: z.string().optional(),
});

export const updateArtifactRequestSchema = artifactMetadataPatchSchema.refine(
    (value) => value.filename !== undefined || value.description !== undefined,
    { message: "Provide filename or description." },
);

export const userResponseSchema = z.strictObject({
    user: userSchema,
});

export const artifactResponseSchema = z.strictObject({
    artifact: artifactSchema,
});

export const artifactVersionResponseSchema = artifactResponseSchema.extend({
    version: versionSchema,
});

export const artifactListResponseSchema = z.strictObject({
    artifacts: z.array(artifactSchema),
});

export const versionListResponseSchema = artifactResponseSchema.extend({
    versions: z.array(versionSchema),
});

export const apiErrorCodeSchema = z.enum([
    "artifact_not_found",
    "internal_error",
    "invalid_json",
    "invalid_metadata",
    "invalid_path",
    "invalid_token",
    "missing_metadata",
    "not_found",
    "quota_exceeded",
    "unauthenticated",
    "upload_too_large",
    "version_not_found",
]);

export const apiErrorSchema = z.strictObject({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
});

export const apiErrorResponseSchema = z.strictObject({
    error: apiErrorSchema,
});

export type User = z.infer<typeof userSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Version = z.infer<typeof versionSchema>;
export type CreateArtifactRequest = z.infer<typeof createArtifactRequestSchema>;
export type ArtifactMetadataPatch = z.infer<typeof artifactMetadataPatchSchema>;
export type UpdateArtifactRequest = z.infer<typeof updateArtifactRequestSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
export type ArtifactResponse = z.infer<typeof artifactResponseSchema>;
export type ArtifactVersionResponse = z.infer<typeof artifactVersionResponseSchema>;
export type ArtifactListResponse = z.infer<typeof artifactListResponseSchema>;
export type VersionListResponse = z.infer<typeof versionListResponseSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type ContractSchema<T> = z.ZodType<T>;
