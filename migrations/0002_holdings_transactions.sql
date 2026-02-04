PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS holdings (
  agent_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  quantity REAL NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, symbol),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  market_source TEXT NOT NULL DEFAULT 'mock',
  executed_at DATETIME NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS holdings_agent_idx ON holdings(agent_id, symbol);
CREATE INDEX IF NOT EXISTS transactions_agent_idx ON transactions(agent_id, executed_at);
CREATE INDEX IF NOT EXISTS transactions_symbol_idx ON transactions(symbol, executed_at);
