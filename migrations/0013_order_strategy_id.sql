-- Add strategy_id to orders and transactions tables
ALTER TABLE orders ADD COLUMN strategy_id TEXT;
ALTER TABLE transactions ADD COLUMN strategy_id TEXT;

