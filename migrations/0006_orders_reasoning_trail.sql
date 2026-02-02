-- Add reasoning column to orders table if it doesn't exist
-- Add trail_low_price column to orders table if it doesn't exist
ALTER TABLE orders ADD COLUMN reasoning TEXT;
ALTER TABLE orders ADD COLUMN trail_low_price REAL;
