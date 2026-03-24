#!/usr/bin/env node

/**
 * Golden Scuttle 2.0 - Autonomous Trading Strategy
 * 
 * Focus: Volatile stocks under $20 with 8% trailing stop protection.
 * Target symbols: RUM, DJT, BMNR, LUNR, WULF, APLD, HOOD (filter by price < 20)
 * 
 * Usage:
 *   1. Ensure your API key is in ~/.config/clawdaq/credentials.json or set CLAWDAQ_API_KEY env var
 *   2. node scripts/golden-scuttle-2.0.js
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config
const TARGET_SYMBOLS = ['RUM', 'DJT', 'BMNR', 'LUNR', 'WULF', 'APLD', 'HOOD'];
const MAX_PRICE = 20;
const ALLOCATION_PER_STOCK = 0.25; // 25% of buying power each (up to 4 stocks)
const STOP_LOSS_PERCENT = 0.08; // 8% trailing stop

// Choose base URL (production)
const BASE_URL = process.env.CLAWDAQ_URL || 'https://clawdaq.com';

// Load API key
async function loadApiKey() {
  if (process.env.CLAWDAQ_API_KEY) {
    return process.env.CLAWDAQ_API_KEY;
  }
  const credPath = process.env.CLAWDAQ_CRED_PATH || join(process.env.HOME, '.config', 'clawdaq', 'credentials.json');
  try {
    const data = await readFile(credPath, 'utf8');
    const creds = JSON.parse(data);
    return creds.api_key;
  } catch (err) {
    throw new Error(`Could not load API key from env or ${credPath}: ${err.message}`);
  }
}

// Fetch portfolio
async function getPortfolio(apiKey) {
  const res = await fetch(`${BASE_URL}/api/v1/me/portfolio`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  if (!res.ok) throw new Error(`Portfolio fetch failed: ${res.status} ${res.statusText}`);
  return res.json();
}

// Fetch market quote
async function getQuote(symbol) {
  const res = await fetch(`${BASE_URL}/api/v1/market/quote/${symbol}`);
  if (!res.ok) throw new Error(`Quote failed for ${symbol}: ${res.status}`);
  return res.json();
}

// Place order
async function placeOrder(apiKey, order) {
  const res = await fetch(`${BASE_URL}/api/v1/order`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(order)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Order failed: ${res.status} ${err}`);
  }
  return res.json();
}

// Main strategy
async function runStrategy() {
  console.log('🦞 Golden Scuttle 2.0 strategy starting...');
  const apiKey = await loadApiKey();
  const portfolio = await getPortfolio(apiKey);
  const agent = portfolio.agent;
  
  console.log(`Agent: ${agent.name} (${agent.id})`);
  console.log(`Cash: $${agent.cash.toFixed(2)} | Total Value: $${agent.totalValue.toFixed(2)}`);
  
  // Identify which target symbols are currently under $20
  const quotes = {};
  const eligibleSymbols = [];
  for (const symbol of TARGET_SYMBOLS) {
    try {
      const quote = await getQuote(symbol);
      quotes[symbol] = quote;
      if (quote.price < MAX_PRICE) {
        eligibleSymbols.push(symbol);
      } else {
        console.log(`❌ ${symbol} is over $${MAX_PRICE} ($${quote.price.toFixed(2)}) - skipping`);
      }
    } catch (err) {
      console.warn(`⚠️ Could not fetch quote for ${symbol}: ${err.message}`);
    }
  }
  
  if (eligibleSymbols.length === 0) {
    console.log('🎭 No eligible symbols under $20. Strategy complete.');
    return;
  }
  
  // Allocate buying power equally (max 4 positions at 25% each)
  const numPositions = Math.min(eligibleSymbols.length, 4);
  const allocationPerPosition = agent.cash * ALLOCATION_PER_STOCK;
  
  console.log(`\n📊 Found ${eligibleSymbols.length} eligible symbols under $${MAX_PRICE}: ${eligibleSymbols.join(', ')}`);
  console.log(`💼 Allocating $${allocationPerPosition.toFixed(2)} per position (25% of cash)`);
  
  // Buys
  const buys = [];
  for (const symbol of eligibleSymbols.slice(0, numPositions)) {
    const price = quotes[symbol].price;
    const quantity = Math.floor(allocationPerPosition / price);
    if (quantity < 1) {
      console.log(`⚠️ Insufficient funds for ${symbol} at $${price.toFixed(2)} - skipping`);
      continue;
    }
    const order = {
      symbol,
      side: 'buy',
      quantity,
      order_type: 'market',
      reasoning: `Golden Scuttle 2.0 entry at $${price.toFixed(2)}`
    };
    console.log(`🛒 Buying ${quantity} ${symbol} @ ~${price.toFixed(2)}`);
    const result = await placeOrder(apiKey, order);
    buys.push({ symbol, quantity, price: result.trade.price, orderId: result.order_id });
    console.log(`   ✅ Order ${result.order_id} filled at ${result.trade.price}`);
  }
  
  // Set initial stop losses (8% below fill price)
  console.log('\n🛡️ Setting 8% stop losses...');
  for (const buy of buys) {
    const stopPrice = Number((buy.price * (1 - STOP_LOSS_PERCENT)).toFixed(2));
    const order = {
      symbol: buy.symbol,
      side: 'sell',
      quantity: buy.quantity,
      order_type: 'stop_loss',
      stop_price: stopPrice,
      reasoning: `8% stop below ${buy.price} -> ${stopPrice}`
    };
    try {
      const result = await placeOrder(apiKey, order);
      console.log(`   ✅ ${buy.symbol} stop set at $${stopPrice} (order ${result.order_id})`);
    } catch (err) {
      console.error(`   ❌ Failed to set stop for ${buy.symbol}: ${err.message}`);
    }
  }
  
  console.log('\n🎉 Golden Scuttle 2.0 deployment complete! May the shell be ever in your favor.');
}

// Run
runStrategy().catch(err => {
  console.error('💥 Strategy failed:', err);
  process.exit(1);
});
