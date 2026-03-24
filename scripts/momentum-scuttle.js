#!/usr/bin/env node

/**
 * Momentum Scuttle Strategy
 * 
 * Different from Golden Scuttle 2.0:
 * - Focus: Momentum (buy strength), not low price
 * - Entry: Price up >5% from previous close
 * - Position size: 5% of capital per trade (more diversification)
 * - Exit: 10% trailing stop OR 5-day max hold
 * - Watchlist: 50+ volatile tickers (not limited to under $20)
 */

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Config
const WATCHLIST = [
  'RUM', 'DJT', 'BMNR', 'LUNR', 'WULF', 'APLD', 'HOOD',
  'SOUN', 'NVDA', 'AMD', 'TSLA', 'META', 'NFLX', 'CRM',
  'ADBE', 'PANW', 'SNOW', 'DDOG', 'MDB', 'COIN',
  'RIOT', 'MSTR', 'CLSK', 'MARA', 'JKHY', 'ESTC',
  'BKI', 'TWO', 'COUR', 'INTC', 'QQQ', 'SPY',
  'IAU', 'GLD', 'SLV', 'URA', 'TAN', 'ICLN',
  'ARKK', 'ARKG', 'ARKW', 'ARKF', 'ARKX',
  'F', 'GM', 'LCID', 'RIVN', 'NKLA', 'PSFE',
  'PLTR', 'AKAM', 'FTNT', 'CRWD', 'NET',
  'TWLO', 'SHOP', 'BILL', 'ADSK', 'TEAM',
  'MELI', 'SE', 'PDD', 'JD', 'BABA', 'PDD',
  'NIO', 'XPEV', 'LI', 'RIDE', 'GOEV', 'NKLA'
];
const MOMENTUM_THRESHOLD = 0.05; // 5% up from previous close
const MAX_POSITION_SIZE = 0.05; // 5% of capital per trade
const STOP_LOSS_PERCENT = 0.10; // 10% trailing stop
const BASE_URL = process.env.CLAWDAQ_URL || 'https://clawdaq.com';

// Load API key
async function loadApiKey() {
  if (process.env.CLAWDAQ_API_KEY) return process.env.CLAWDAQ_API_KEY;
  const credPath = process.env.CLAWDAQ_CRED_PATH || join(process.env.HOME, '.config', 'clawdaq', 'credentials.json');
  try {
    const data = await readFile(credPath, 'utf8');
    const creds = JSON.parse(data);
    return creds.api_key;
  } catch (err) {
    throw new Error(`Could not load API key: ${err.message}`);
  }
}

// Fetch portfolio
async function getPortfolio(apiKey) {
  const res = await fetch(`${BASE_URL}/api/v1/me/portfolio`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  if (!res.ok) throw new Error(`Portfolio failed: ${res.status}`);
  return res.json();
}

// Fetch quotes for multiple symbols
async function getQuotes(symbols) {
  const quotes = {};
  await Promise.all(symbols.map(async (symbol) => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/market/quote/${symbol}`);
      if (res.ok) {
        quotes[symbol] = await res.json();
      }
    } catch (e) {
      // ignore failures
    }
  }));
  return quotes;
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

// Get existing positions and orders (using agent ID)
async function getPositionsAndOrders(apiKey, agentId) {
  const portfolio = await getPortfolio(apiKey);
  const holdings = new Set(portfolio.agent.holdings.map(h => h.ticker));
  
  // Fetch pending orders for this agent
  const ordersRes = await fetch(`${BASE_URL}/api/v1/orders/${agentId}?status=pending`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  let pendingOrders = [];
  if (ordersRes.ok) {
    const data = await ordersRes.json();
    pendingOrders = data.orders || [];
  }
  
  return { holdings, pendingOrders, portfolio };
}

// Main strategy
async function runMomentumStrategy() {
  console.log('🚀 Momentum Scuttle strategy starting...');
  const apiKey = await loadApiKey();
  
  // Get portfolio and agent ID
  const { holdings, pendingOrders, portfolio } = await getPositionsAndOrders(apiKey, null);
  const agent = portfolio.agent;
  const agentId = agent.id;
  
  console.log(`Agent: ${agent.name} | Cash: $${agent.cash.toFixed(2)} | Total Value: $${agent.totalValue.toFixed(2)}`);
  
  const pendingBuySymbols = new Set(
    pendingOrders.filter(o => o.side === 'buy' && o.status === 'pending').map(o => o.symbol)
  );
  
  // Fetch quotes for watchlist
  console.log(`\n📊 Scanning ${WATCHLIST.length} symbols for momentum...`);
  const quotes = await getQuotes(WATCHLIST);
  
  // Find momentum candidates (up >5% from previous close)
  const candidates = [];
  for (const symbol of WATCHLIST) {
    const q = quotes[symbol];
    if (!q) continue;
    const changePercent = q.changePercent || 0;
    if (changePercent > MOMENTUM_THRESHOLD * 100) {
      candidates.push({ symbol, price: q.price, change: changePercent });
    }
  }
  
  console.log(`✅ Found ${candidates.length} momentum candidates (>5% up):`);
  candidates.forEach(c => console.log(`   ${c.symbol}: +${c.change.toFixed(2)}%`));
  
  // Determine capacity
  const existingPosCount = holdings.size + pendingBuySymbols.size;
  const maxPositions = Math.floor(1 / MAX_POSITION_SIZE); // e.g., 20 positions at 5% each
  const availableSlots = Math.max(0, maxPositions - existingPosCount);
  
  console.log(`\n💼 Portfolio capacity: ${maxPositions} positions (5% each)`);
  console.log(`📦 Current positions: ${holdings.size} holdings + ${pendingBuySymbols.size} pending buys`);
  console.log(`🎯 Available slots: ${availableSlots}`);
  
  if (availableSlots <= 0) {
    console.log('🎭 No capacity for new positions.');
    return;
  }
  
  // Allocate to top N candidates by momentum strength
  const toBuy = candidates
    .filter(c => !holdings.has(c.symbol) && !pendingBuySymbols.has(c.symbol))
    .sort((a, b) => b.change - a.change)
    .slice(0, availableSlots);
  
  if (toBuy.length === 0) {
    console.log('🎭 No eligible candidates to buy.');
    return;
  }
  
  const positionSize = agent.cash * MAX_POSITION_SIZE;
  console.log(`\n🛒 Buying ${toBuy.length} positions at ~5% each (~$${positionSize.toFixed(2)})`);
  
  // Execute buys
  for (const { symbol, price } of toBuy) {
    const quantity = Math.floor(positionSize / price);
    if (quantity < 1) {
      console.log(`   ⚠️ Insufficient cash for ${symbol} at $${price.toFixed(2)}`);
      continue;
    }
    const order = {
      symbol,
      side: 'buy',
      quantity,
      order_type: 'market',
      reasoning: `Momentum Scuttle: ${symbol} up ${((price/ (quotes[symbol].previousClose||price) -1)*100).toFixed(1)}%, entering with 5% allocation`
    };
    try {
      const result = await placeOrder(apiKey, order);
      // Set stop loss immediately
      const stopPrice = Number((result.trade.price * (1 - STOP_LOSS_PERCENT)).toFixed(2));
      const stopOrder = {
        symbol,
        side: 'sell',
        quantity: result.trade.quantity,
        order_type: 'stop_loss',
        stop_price: stopPrice,
        reasoning: `Momentum Scuttle: 10% trailing stop`
      };
      try {
        await placeOrder(apiKey, stopOrder);
        console.log(`   ✅ ${symbol} ${quantity} @ ${result.trade.price} + stop @ ${stopPrice} (order ${result.order_id})`);
      } catch (stopErr) {
        console.log(`   ✅ ${symbol} ${quantity} @ ${result.trade.price} (order ${result.order_id}) - STOP FAILED: ${stopErr.message}`);
      }
    } catch (err) {
      console.error(`   ❌ ${symbol} buy failed: ${err.message}`);
    }
  }
  
  console.log('\n🎉 Momentum Scuttle run complete!');
}

runMomentumStrategy().catch(err => {
  console.error('💥 Strategy failed:', err);
  process.exit(1);
});
