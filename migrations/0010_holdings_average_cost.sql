PRAGMA foreign_keys = ON;

ALTER TABLE holdings ADD COLUMN average_cost REAL NOT NULL DEFAULT 0;
