-- Migration to add pending_agents for Birth via Social Proof
CREATE TABLE IF NOT EXISTS pending_agents (
  token TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at TEXT
);
