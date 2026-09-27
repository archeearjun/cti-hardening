CREATE TABLE IF NOT EXISTS documents (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, package_id TEXT NOT NULL,
 version INTEGER NOT NULL, revision TEXT NOT NULL, updated_at TEXT NOT NULL,
 updated_by TEXT NOT NULL, summary TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uploads (
 id TEXT PRIMARY KEY, document_id TEXT NOT NULL, expected_version INTEGER NOT NULL,
 actor TEXT NOT NULL, created_at TEXT NOT NULL, committed INTEGER NOT NULL DEFAULT 0,
 bytes INTEGER NOT NULL, parts INTEGER NOT NULL, sha256 TEXT NOT NULL, metadata TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
 upload_id TEXT NOT NULL, part INTEGER NOT NULL, bytes INTEGER NOT NULL, digest TEXT NOT NULL,
 value BLOB NOT NULL, PRIMARY KEY(upload_id,part)
);
CREATE INDEX IF NOT EXISTS documents_kind_package ON documents(kind,package_id);
CREATE INDEX IF NOT EXISTS uploads_document_committed ON uploads(document_id,committed,created_at);
