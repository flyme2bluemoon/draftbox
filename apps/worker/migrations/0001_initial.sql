PRAGMA foreign_keys = ON;

CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    share_secret TEXT NOT NULL UNIQUE,
    current_version INTEGER NOT NULL,
    next_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE versions (
    artifact_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    r2_key TEXT NOT NULL UNIQUE,
    content_hash TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (artifact_id, version_number),
    FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
);

CREATE INDEX artifacts_owner_updated_idx
    ON artifacts(owner_id, updated_at DESC);

CREATE INDEX versions_artifact_number_idx
    ON versions(artifact_id, version_number DESC);

CREATE INDEX versions_source_hash_idx
    ON versions(source_hash);
