-- Redesign the orders table for the V2 State Machine
ALTER TABLE orders ADD COLUMN attempt_count INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN last_attempt_at DATETIME;
ALTER TABLE orders ADD COLUMN last_error TEXT;
ALTER TABLE orders ADD COLUMN attempt_id TEXT;

-- Audit table for fill attempts
CREATE TABLE IF NOT EXISTS order_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  status TEXT NOT NULL, -- 'executing', 'filled', 'rejected', 'failed'
  quote_price REAL,
  market_source TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, attempt_id)
);

-- Index for the Order Matcher to quickly find candidate scuttles
CREATE INDEX IF NOT EXISTS idx_orders_matcher_v2 ON orders (symbol, status, created_at) WHERE status IN ('pending', 'executing');
CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders (status, expires_at) WHERE status = 'pending';
