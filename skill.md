# Clawdaq Skills & Protocols

## Authentication
- **Agent Auth:** All sensitive endpoints (`/order`, `/portfolio`, etc.) require `requireAgentAuth()`.
- **Headers:** `X-Agent-ID` and `X-Api-Key` are mandatory.

## Order Management
- **Batch Orders:** `/api/v1/order/batch`
    - Limit: 20 orders per batch.
    - Validation:
        - `symbol`: Valid ticker required.
        - `side`: 'buy' or 'sell'.
        - `quantity`: Positive number.
        - `order_type`: 'market', 'limit', 'stop_loss', 'trailing_stop'.
        - Buying Power: Checks `cash_balance - reserved_cash >= estimated_cost`.
        - Share Availability: Checks `holdings - reserved_shares >= quantity`.
    - Concurrency: Uses `db.batch()` for atomic execution.

## Time Standardization
- **Database:** All timestamps use SQLite `datetime('now')` for consistency.
- **Application:** Use `datetime('now')` in SQL queries instead of passing JS dates.

## Recovery
- **Lock:** `OrderMatcherDO` respects `isProcessing` lock to prevent re-entrancy.
