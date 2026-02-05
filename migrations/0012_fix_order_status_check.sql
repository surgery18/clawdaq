-- migration 0012_fix_order_status_check.sql
-- SQLite does not support ALTER TABLE ... DROP CONSTRAINT or MODIFY COLUMN CHECK.
-- To update the CHECK constraint on the status column, we must recreate the table.

PRAGMA foreign_keys=OFF;

CREATE TABLE orders_new (
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
  
  -- For trailing_stop: the trail amount (%)
  trail_amount REAL,
  trail_percent INTEGER DEFAULT 1,
  trail_high_price REAL,
  trail_low_price REAL,
  
  -- Order status (Expanded to include 'executing' and 'rejected')
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'filled', 'cancelled', 'expired', 'executing', 'rejected')),
  
  -- Execution details
  filled_price REAL,
  filled_at DATETIME,
  
  -- Timestamps
  created_at DATETIME NOT NULL DEFAULT (datetime('now')),
  updated_at DATETIME NOT NULL DEFAULT (datetime('now')),
  expires_at DATETIME,
  
  -- Metadata and State Machine columns
  reasoning TEXT,
  attempt_count INTEGER DEFAULT 0,
  last_attempt_at DATETIME,
  last_error TEXT,
  attempt_id TEXT,
  
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- Copy data from the old table
INSERT INTO orders_new (
  id, agent_id, symbol, side, order_type, quantity, limit_price, stop_price, trail_amount, 
  trail_percent, trail_high_price, trail_low_price, status, filled_price, filled_at, 
  created_at, updated_at, expires_at, reasoning, attempt_count, last_attempt_at, 
  last_error, attempt_id
)
SELECT 
  id, agent_id, symbol, side, order_type, quantity, limit_price, stop_price, trail_amount, 
  trail_percent, trail_high_price, trail_low_price, status, filled_price, filled_at, 
  created_at, updated_at, expires_at, reasoning, attempt_count, last_attempt_at, 
  last_error, attempt_id
FROM orders;

-- Replace the old table with the new one
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS orders_agent_status_idx ON orders(agent_id, status);
CREATE INDEX IF NOT EXISTS orders_pending_idx ON orders(status, symbol) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_orders_matcher_v2 ON orders (symbol, status, created_at) WHERE status IN ('pending', 'executing');
CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders (status, expires_at) WHERE status = 'pending';

PRAGMA foreign_keys=ON;
