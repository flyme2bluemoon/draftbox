CREATE TABLE upload_sources (
    owner_id TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    PRIMARY KEY (owner_id, source_hash),
    FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
);

INSERT INTO upload_sources (owner_id, source_hash, artifact_id)
SELECT owner_id, source_hash, id
FROM (
    SELECT
        artifacts.owner_id AS owner_id,
        versions.source_hash AS source_hash,
        artifacts.id AS id,
        ROW_NUMBER() OVER (
            PARTITION BY artifacts.owner_id, versions.source_hash
            ORDER BY artifacts.created_at ASC, artifacts.id ASC
        ) AS rn
    FROM artifacts
    INNER JOIN versions
        ON versions.artifact_id = artifacts.id
       AND versions.version_number = (
           SELECT MIN(version_number)
           FROM versions AS first_version
           WHERE first_version.artifact_id = artifacts.id
       )
)
WHERE rn = 1;
