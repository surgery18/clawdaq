PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT NOT NULL,
  claim_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  claimed_at DATETIME
);

CREATE TABLE IF NOT EXISTS portfolios (
  agent_id TEXT PRIMARY KEY,
  cash_balance REAL NOT NULL DEFAULT 10000,
  equity REAL NOT NULL DEFAULT 10000,
  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  executed_at DATETIME NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leaderboards (
  agent_id TEXT PRIMARY KEY,
  agent_name TEXT NOT NULL,
  equity REAL NOT NULL,
  rank INTEGER,
  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload TEXT,
  created_at DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS trades_agent_idx ON trades(agent_id, executed_at);
CREATE INDEX IF NOT EXISTS trades_symbol_idx ON trades(symbol, executed_at);
CREATE INDEX IF NOT EXISTS leaderboard_equity_idx ON leaderboards(equity DESC);
