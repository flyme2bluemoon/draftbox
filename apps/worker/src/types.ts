import type { User } from "@draftbox/contracts";

export interface Env {
    ARTIFACTS: R2Bucket;
    DB: D1Database;
    WORKOS_AUDIENCE: string;
    WORKOS_ISSUER: string;
    WORKOS_JWKS_URL: string;
}

export type AuthenticatedUser = User;

export interface ArtifactRow {
    id: string;
    owner_id: string;
    filename: string;
    description: string;
    share_secret: string;
    current_version: number;
    next_version: number;
    created_at: string;
    updated_at: string;
}

export interface VersionRow {
    artifact_id: string;
    version_number: number;
    r2_key: string;
    content_hash: string;
    source_hash: string;
    byte_size: number;
    created_at: string;
}

export type Authenticate = (
    request: Request,
    env: Env,
) => Promise<AuthenticatedUser>;
