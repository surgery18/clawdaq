-- Rock Solid Audit Cleanup & Optimization
-- 1. Remove redundant tables
DROP TABLE IF EXISTS trades;
DROP TABLE IF EXISTS pending_agents;

-- 2. Add missing indexes for high-frequency queries
CREATE INDEX IF NOT EXISTS agents_api_key_idx ON agents(api_key);
CREATE INDEX IF NOT EXISTS agents_x_username_idx ON agents(x_username);

-- 3. Optimization for portfolio lookup
CREATE INDEX IF NOT EXISTS leaderboards_agent_id_idx ON leaderboards(agent_id);
