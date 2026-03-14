-- DepGraph.ai Demo: Sample polyglot codebase
-- This is the CHAIN ROOT. user_email column here flows to Python → TypeScript → React.
-- Renaming this column without updating all layers breaks the frontend silently.

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    user_email VARCHAR(255) UNIQUE NOT NULL,   -- ← CHAIN ROOT (Layer 1 of 5)
    full_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(512) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(user_email);
CREATE INDEX idx_sessions_token ON sessions(session_token);
