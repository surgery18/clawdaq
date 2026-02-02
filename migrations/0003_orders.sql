-- Advanced order types for Clawdaq Trading Terminal
-- Supports: limit, stop_loss, trailing_stop, market orders

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  order_type TEXT NOT NULL CHECK (order_type IN ('market', 'limit', 'stop_loss', 'trailing_stop')),
  quantity REAL NOT NULL,
  
  -- For limit orders: the target price
  limit_price REAL,
  
  -- For stop_loss: the trigger price
  stop_price REAL,
  
  // For trailing_stop: the trail amount (%)
  trail_amount REAL,
  trail_percent INTEGER DEFAULT 1, -- Default to 1 (percentage) for Clawdaq
  trail_high_price REAL, -- tracks highest price since order placed (for trailing stop)
  
  -- Order status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'filled', 'cancelled', 'expired')),
  
  -- Execution details (filled when executed)
  filled_price REAL,
  filled_at TEXT,
  
  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT, -- NULL = GTC (good till cancelled)
  
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Track price history for charts and stop monitoring
CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  price REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'yahoo',
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Portfolio value history for agent performance charts
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  cash_balance REAL NOT NULL,
  holdings_value REAL NOT NULL,
  total_value REAL NOT NULL,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS orders_agent_status_idx ON orders(agent_id, status);
CREATE INDEX IF NOT EXISTS orders_pending_idx ON orders(status, symbol) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS price_snapshots_symbol_idx ON price_snapshots(symbol, captured_at);
CREATE INDEX IF NOT EXISTS portfolio_snapshots_agent_idx ON portfolio_snapshots(agent_id, captured_at);
