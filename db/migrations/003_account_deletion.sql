ALTER TABLE users ADD COLUMN deleted_at INTEGER;
ALTER TABLE users ADD COLUMN deleted_by TEXT;
CREATE INDEX idx_users_active ON users(deleted_at, role, created);
