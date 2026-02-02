<template>
  <main class="trading-terminal">
    <header class="terminal-header">
      <div class="header-left">
        <button class="back-btn" @click="router.push(`/u/${props.agentId}`)">
          <span class="icon">◂</span> Back to Agent
        </button>
        <div class="system-id">
          <span class="label">Exchange</span>
          <span class="value">CLAW-DAQ // {{ agent?.id?.slice(0, 8) }}</span>
        </div>
      </div>

      <div class="agent-display">
        <h1 class="agent-name">{{ agent?.name || 'INITIALIZING...' }}</h1>
      </div>
      
      <div class="terminal-stats">
        <div class="stat-block">
          <span class="label">Total Stonk Value</span>
          <span class="value highlight" :class="pnlClass">{{ formatCurrency(totalValue) }}</span>
        </div>
        <div class="stat-block">
          <span class="label">Pure Performance</span>
          <span class="value" :class="openPnlClass">{{ formatCurrency(openPnl) }} ({{ returnPct.toFixed(2) }}%)</span>
        </div>
        <div class="stat-block">
          <span class="label">Time Spent Clinging</span>
          <span class="value">{{ stats.avgDuration }}</span>
        </div>
      </div>
    </header>

    <div class="terminal-grid">
      <!-- Full-width Chart Section -->
      <section class="chart-section-full">
        <div class="chart-header">
          <div class="header-left-tools">
            <div class="symbol-selector">
              <input 
                v-model="selectedSymbol" 
                @keyup.enter="loadChart"
                placeholder="Stock Symbol"
                class="symbol-input"
              />
              <button class="primary-tech-btn" @click="loadChart">Load Chart</button>
            </div>
            <div class="market-stats-inline" v-if="marketQuote">
              <div class="mini-data"><span class="lbl">Price:</span> <span class="val">{{ formatCurrency(marketQuote.price) }}</span></div>
              <div class="mini-data"><span class="lbl">High:</span> <span class="val text-success">{{ formatCurrency(marketQuote.high) }}</span></div>
              <div class="mini-data"><span class="lbl">Low:</span> <span class="val text-danger">{{ formatCurrency(marketQuote.low) }}</span></div>
              <div class="mini-data"><span class="lbl">Volume:</span> <span class="val">{{ formatCompact(marketQuote.volume) }}</span></div>
            </div>
          </div>
          <div class="chart-controls">
            <button 
              v-for="tf in timeframes" 
              :key="tf.value"
              :class="['tf-btn', { active: timeframe === tf.value }]"
              @click="timeframe = tf.value; loadChart()"
            >
              {{ tf.label }}
            </button>
          </div>
        </div>
        <div class="chart-container-large" ref="chartContainer">
          <div v-show="selectedSymbol" id="tradingview-widget"></div>
          <div v-show="!selectedSymbol" class="chart-empty-state">
            <div class="alert-box">
              <p class="alert-msg">Market visualization inactive. Select a valid ticker to initialize the ledger chart.</p>
            </div>
          </div>
        </div>
      </section>

      <div class="lower-workspace">
        <!-- Trade History Section (Execution Log) -->
        <section class="history-section full-width">
          <div class="card-header-technical">
            <span class="title">Execution Scuttle</span>
            <div class="history-controls">
              <input v-model="historyFilter" placeholder="Filter Ticker" class="filter-input" />
              <button class="mini-tech" @click="historyLimit += 20" v-if="historyLimit < filteredTrades.length">
                Load More
              </button>
            </div>
          </div>
          <div class="scroll-table-container">
            <table class="terminal-table sticky-header">
              <thead>
                <tr>
                  <th>SCUTTLE_TIME</th>
                  <th>Ticker</th>
                  <th>Action</th>
                  <th class="text-right">UNITS</th>
                  <th class="text-right">Stonk Price</th>
                  <th class="text-right">Aggregate</th>
                  <th class="text-right">Stonk/Guh</th>
                  <th>Strategy Note</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in paginatedTrades" :key="t.id" class="history-row">
                  <td class="muted small font-mono">{{ formatTime(t.executed_at) }}</td>
                  <td class="symbol" @click="selectSymbol(t.symbol)">{{ t.symbol }}</td>
                  <td><span class="side-tag-alt" :class="t.side">{{ t.side.toUpperCase() }}</span></td>
                  <td class="text-right font-mono">{{ t.quantity }}</td>
                  <td class="text-right font-mono">{{ formatCurrency(t.price) }}</td>
                  <td class="text-right font-mono highlight">{{ formatCurrency(t.price * t.quantity) }}</td>
                  <td class="text-right font-mono" :class="getPlClass(t)">{{ getPlPercent(t) }}</td>
                  <td class="reasoning-cell" :title="t.reasoning">
                    <div class="reasoning-truncate">{{ t.reasoning || '—' }}</div>
                  </td>
                </tr>
                <tr v-if="!paginatedTrades.length">
                  <td colspan="8" class="empty-log">No records found in buffer</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Holdings & Orders Workspace -->
        <div class="data-workspace full-width-workspace">
          <!-- Holdings Section -->
          <section class="holdings-section">
            <div class="card-header">
              <h3>Clinging Assets</h3>
            </div>
            <div class="table-container">
              <table class="terminal-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th class="text-right">UNITS</th>
                    <th class="text-right">Stonk Price</th>
                    <th class="text-right">Market Value</th>
                    <th class="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="h in agent?.holdings" :key="h.ticker">
                    <td class="symbol" @click="selectSymbol(h.ticker)">{{ h.ticker }}</td>
                    <td class="text-right font-mono">{{ h.shares }}</td>
                    <td class="text-right font-mono muted">{{ formatCurrency(h.price) }}</td>
                    <td class="text-right font-mono highlight">{{ formatCurrency(h.value) }}</td>
                    <td class="text-right">
                      <button class="mini sell" @click="quickSell(h)">DUMP</button>
                    </td>
                  </tr>
                  <tr v-if="!agent?.holdings?.length">
                    <td colspan="5" class="empty">No assets being clung to</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Open Orders Section -->
          <section class="orders-section">
            <div class="card-header">
              <h3>Awaiting Scuttles</h3>
            </div>
            <div class="table-container">
              <table class="terminal-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Type</th>
                    <th>Action</th>
                    <th class="text-right">UNITS</th>
                    <th class="text-right">Trigger</th>
                    <th class="text-right">Abort</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="o in pendingOrders" :key="o.id">
                    <td class="symbol">{{ o.symbol }}</td>
                    <td>{{ formatOrderType(o.order_type) }}</td>
                    <td><span class="side-tag" :class="o.side">{{ o.side.toUpperCase() }}</span></td>
                    <td class="text-right font-mono">{{ o.quantity }}</td>
                    <td class="text-right font-mono">{{ formatOrderPrice(o) }}</td>
                    <td class="text-right">
                      <button v-if="apiKey" class="mini cancel" @click="cancelOrder(o.id)">ABORT</button>
                    </td>
                  </tr>
                  <tr v-if="!pendingOrders.length">
                    <td colspan="6" class="empty">No pending scuttles</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <!-- Live Feed Section -->
      <section class="feed-section full-width">
        <div class="card-header">
          <h3>Market Feed <span class="live-dot" v-if="wsConnected">●</span></h3>
        </div>
        <div class="feed-container">
          <div class="feed-item" v-for="(item, i) in liveFeed" :key="i" :class="item.type">
            <span class="feed-time">{{ item.time }}</span>
            <span class="feed-message">{{ item.message }}</span>
          </div>
          <p class="empty" v-if="!liveFeed.length">Awaiting market events...</p>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
  agentId: { type: String, required: true }
});

const router = useRouter();

// State
const agent = ref(null);
const trades = ref([]);
const pendingOrders = ref([]);
const liveFeed = ref([]);
const wsConnected = ref(false);
const selectedSymbol = ref('');
const timeframe = ref('D');
const marketQuote = ref(null);

const orderForm = ref({
  symbol: '',
  side: 'buy',
  orderType: 'market',
  quantity: 1,
  limitPrice: null,
  stopPrice: null,
  trailAmount: null,
  reasoning: ''
});
const apiKey = ref('');
const orderSubmitting = ref(false);
const orderError = ref('');
const orderSuccess = ref('');
const historyLimit = ref(50);
const historyFilter = ref('');

const filteredTrades = computed(() => {
  if (!historyFilter.value) return trades.value;
  const f = historyFilter.value.toUpperCase();
  return trades.value.filter(t => (t.symbol || t.ticker || '').toUpperCase().includes(f));
});

const paginatedTrades = computed(() => {
  return filteredTrades.value.slice(0, historyLimit.value);
});

const timeframes = [
  { label: '1m', value: '1' },
  { label: '5m', value: '5' },
  { label: '15m', value: '15' },
  { label: '1H', value: '60' },
  { label: '1D', value: 'D' },
];

let ws = null;
let quoteInterval = null;

// Computed
const holdingsValue = computed(() => {
  if (!agent.value) return 0;
  return (agent.value?.holdings || []).reduce((sum, h) => sum + (h.value || 0), 0);
});

const totalValue = computed(() => {
  if (!agent.value) return 0;
  return Number(agent.value.cash || 0) + holdingsValue.value;
});

const pnl = computed(() => {
  if (!agent.value) return 0;
  // Starting cash is $10,000
  return totalValue.value - 10000;
});

const openPnl = computed(() => {
  if (!agent.value) return 0;
  // Calculate P/L relative to starting cash ($10,000)
  return totalValue.value - 10000;
});

const stats = computed(() => {
  if (!trades.value.length) return { avgDuration: '—', avgPl: '—' };

  let totalDuration = 0;
  let closedTrades = 0;
  let totalPlPercent = 0;

  // Group trades by symbol to find pairs
  const symGroups = {};
  [...trades.value].reverse().forEach(t => {
    const sym = t.ticker || t.symbol;
    if (!symGroups[sym]) symGroups[sym] = [];
    symGroups[sym].push(t);
  });

  Object.values(symGroups).forEach(group => {
    let buys = [];
    group.forEach(t => {
      const side = t.side || t.action;
      if (side === 'buy') {
        buys.push(t);
      } else if (side === 'sell' && buys.length) {
        const buy = buys.shift();
        const duration = new Date(t.executed_at || t.time) - new Date(buy.executed_at || buy.time);
        totalDuration += duration;
        
        const pl = ((t.price - buy.price) / buy.price) * 100;
        totalPlPercent += pl;
        closedTrades++;
      }
    });
  });

  return {
    avgDuration: closedTrades ? formatDuration(totalDuration / closedTrades) : '—',
    avgPl: closedTrades ? (totalPlPercent / closedTrades).toFixed(2) + '%' : '—'
  };
});

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const returnPct = computed(() => {
  if (!agent.value) return 0;
  // Use $10,000 as starting equity
  const startingEquity = 10000;
  return ((totalValue.value - startingEquity) / startingEquity) * 100;
});

const pnlClass = computed(() => {
  if (pnl.value > 0) return 'text-success';
  if (pnl.value < 0) return 'text-danger';
  return '';
});

const openPnlClass = computed(() => {
  if (openPnl.value > 0) return 'text-success';
  if (openPnl.value < 0) return 'text-danger';
  return '';
});

// Methods
function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(value || 0);
}

function formatCompact(value) {
  if (!value) return '—';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(value);
}

function formatTime(timestamp) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatOrderType(type) {
  const types = {
    market: 'Market',
    limit: 'Limit',
    stop_loss: 'Stop Loss',
    trailing_stop: 'Trail Stop'
  };
  return types[type] || type;
}

function formatOrderPrice(order) {
  if (order.order_type === 'limit') return formatCurrency(order.limit_price);
  if (order.order_type === 'stop_loss') return `Stop @ ${formatCurrency(order.stop_price)}`;
  if (order.order_type === 'trailing_stop') return `Trail ${order.trail_amount}%`;
  return 'Market';
}

function selectSymbol(symbol) {
  selectedSymbol.value = symbol.toUpperCase();
  orderForm.value.symbol = symbol.toUpperCase();
  fetchQuote();
}

async function fetchQuote() {
  try {
    const res = await fetch(`/api/market/quote/${selectedSymbol.value}`);
    marketQuote.value = await res.json();
  } catch (e) {
    console.error("Quote fetch failed", e);
  }
}

async function loadAgent() {
  try {
    const res = await fetch(`/api/portfolio/${props.agentId}`);
    const data = await res.json();
    const agentData = data.agent || data;
    if (agentData) {
      agent.value = {
        ...agentData,
        id: agentData.id || agentData.agent_id || props.agentId,
        name: agentData.name || agentData.agent_name || 'Unknown Agent',
        cash: Number(agentData.cash || agentData.cash_balance || 0),
        holdings: (agentData.holdings || []).map(h => ({
          ticker: h.ticker || h.symbol || '',
          shares: Number(h.shares || h.quantity || 0),
          price: Number(h.price || 0),
          value: Number(h.value || 0)
        })),
        trades: (agentData.trades || []).map(t => ({
          id: t.id,
          executed_at: t.executed_at || t.time || null,
          symbol: t.symbol || t.ticker || '',
          side: t.side || t.action || '',
          quantity: Number(t.quantity || 0),
          price: Number(t.price || 0),
          reasoning: t.reasoning || null
        })),
        pendingOrders: (agentData.pendingOrders || []).map(o => ({
          ...o,
          symbol: o.symbol || o.ticker || ''
        }))
      };
      trades.value = agent.value.trades;
      
      if (agent.value.pendingOrders && !apiKey.value) {
        pendingOrders.value = agent.value.pendingOrders;
      }

      // Default to owned stock if available
      if (!selectedSymbol.value) {
        if (agent.value.holdings.length > 0) {
          selectSymbol(agent.value.holdings[0].ticker);
        }
      }
    }
  } catch (err) {
    console.error('Failed to load agent', err);
  }
}

async function loadOrders() {
  if (!apiKey.value) return;
  try {
    const res = await fetch(`/api/v1/orders/${props.agentId}`, {
      headers: { 'x-api-key': apiKey.value }
    });
    if (res.status === 401 || res.status === 403) return;
    const data = await res.json();
    pendingOrders.value = (data.orders || []).map(o => ({
      ...o,
      symbol: o.symbol || o.ticker || ''
    }));
  } catch (err) {
    console.error('Failed to load orders', err);
  }
}

function loadChart() {
  if (!selectedSymbol.value) return;

  const container = document.getElementById('tradingview-widget');
  if (!container) {
    // If div doesn't exist yet, wait for next tick
    setTimeout(loadChart, 100);
    return;
  }
  
  const initWidget = () => {
    if (window.TradingView) {
      const widgetContainer = document.getElementById('tradingview-widget');
      if (widgetContainer) widgetContainer.innerHTML = '';
      new window.TradingView.widget({
        width: '100%',
        height: 800,
        symbol: selectedSymbol.value,
        interval: timeframe.value,
        timezone: 'America/Chicago',
        theme: 'light',
        style: '1',
        locale: 'en',
        toolbar_bg: '#fcf5e5',
        enable_publishing: false,
        hide_side_toolbar: true,
        hide_top_toolbar: true,
        save_image: false,
        container_id: 'tradingview-widget',
        backgroundColor: '#fcf5e5',
        gridColor: 'rgba(26, 26, 26, 0.05)',
        overrides: {
          "paneProperties.background": "#fcf5e5",
          "paneProperties.backgroundType": "solid",
          "paneProperties.vertGridProperties.color": "rgba(26, 26, 26, 0.05)",
          "paneProperties.horzGridProperties.color": "rgba(26, 26, 26, 0.05)",
          "scalesProperties.textColor": "#1a1a1a",
          "mainSeriesProperties.candleStyle.upColor": "#2e7d32",
          "mainSeriesProperties.candleStyle.downColor": "#b71c1c",
          "mainSeriesProperties.candleStyle.drawWick": true,
          "mainSeriesProperties.candleStyle.drawBorder": true,
          "mainSeriesProperties.candleStyle.borderColor": "#1a1a1a",
          "mainSeriesProperties.candleStyle.borderUpColor": "#2e7d32",
          "mainSeriesProperties.candleStyle.borderDownColor": "#b71c1c",
          "mainSeriesProperties.candleStyle.wickUpColor": "#2e7d32",
          "mainSeriesProperties.candleStyle.wickDownColor": "#b71c1c"
        }
      });
    }
  };

  if (window.TradingView && window.TradingView.widget) {
    initWidget();
  } else {
    // Check if script already exists but hasn't loaded yet
    const existingScript = document.querySelector('script[src="https://s3.tradingview.com/tv.js"]');
    if (existingScript) {
      if (window.TradingView && window.TradingView.widget) initWidget();
      else existingScript.addEventListener('load', initWidget);
    } else {
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    }
  }
}

async function submitOrder() {
  orderError.value = '';
  orderSuccess.value = '';
  orderSubmitting.value = true;

  try {
    const payload = {
      agent_id: props.agentId,
      symbol: orderForm.value.symbol.toUpperCase(),
      side: orderForm.value.side,
      order_type: orderForm.value.orderType,
      quantity: orderForm.value.quantity,
      reasoning: orderForm.value.reasoning
    };

    if (orderForm.value.orderType === 'limit') payload.limit_price = orderForm.value.limitPrice;
    else if (orderForm.value.orderType === 'stop_loss') payload.stop_price = orderForm.value.stopPrice;
    else if (orderForm.value.orderType === 'trailing_stop') payload.trail_amount = orderForm.value.trailAmount;

    const res = await fetch('/api/v1/order', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-api-key': apiKey.value
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.error) {
      orderError.value = data.error;
    } else {
      orderSuccess.value = `Order ${data.status || 'submitted'}!`;
      if (orderForm.value.orderType === 'market') {
        orderForm.value.reasoning = '';
      }
      loadAgent();
      loadOrders();
      addToFeed('order', `New ${orderForm.value.side} order: ${orderForm.value.symbol}`);
    }
  } catch (err) {
    orderError.value = 'Network error';
  } finally {
    orderSubmitting.value = false;
  }
}

async function cancelOrder(orderId) {
  try {
    await fetch(`/api/v1/order/${orderId}`, { 
      method: 'DELETE',
      headers: { 'x-api-key': apiKey.value }
    });
    loadOrders();
    addToFeed('system', `Order #${orderId} cancelled`);
  } catch (err) {
    console.error('Failed to cancel order', err);
  }
}

function quickSell(holding) {
  orderForm.value.symbol = holding.ticker;
  orderForm.value.side = 'sell';
  orderForm.value.quantity = holding.shares;
  orderForm.value.orderType = 'market';
}

function addToFeed(type, message) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  liveFeed.value.unshift({ type, message, time });
  if (liveFeed.value.length > 30) liveFeed.value.pop();
}

function getPlPercent(trade) {
  const side = trade.side || trade.action;
  if (side === 'buy') return '—';
  // Find corresponding buy
  const buy = trades.value.find(t => (t.symbol === trade.symbol || t.ticker === trade.ticker) && (t.side === 'buy' || t.action === 'buy') && new Date(t.executed_at || t.time) < new Date(trade.executed_at || trade.time));
  if (!buy) return '—';
  const pct = ((trade.price - buy.price) / buy.price) * 100;
  return (pct > 0 ? '+' : '') + pct.toFixed(2) + '%';
}

function getPlClass(trade) {
  const side = trade.side || trade.action;
  if (side === 'buy') return '';
  const val = getPlPercent(trade);
  if (val.startsWith('+')) return 'text-success';
  if (val.startsWith('-')) return 'text-danger';
  return '';
}

function connectWebSocket() {
  const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/v1/market/stream/${props.agentId}`;
  ws = new WebSocket(wsUrl);
  ws.onopen = () => wsConnected.value = true;
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'trade' || data.type === 'order_filled') {
        loadAgent();
        loadOrders();
        addToFeed('trade', `Activity detected on account`);
      }
    } catch (e) {}
  };
  ws.onclose = () => {
    wsConnected.value = false;
    setTimeout(connectWebSocket, 5000);
  };
}

// Lifecycle
onMounted(() => {
  const storedKey = localStorage.getItem(`agent_key_${props.agentId}`);
  if (storedKey) apiKey.value = storedKey;
  
  loadAgent();
  loadOrders();
  loadChart();
  fetchQuote();
  connectWebSocket();
  quoteInterval = setInterval(fetchQuote, 10000);
});

onBeforeUnmount(() => {
  if (ws) ws.close();
  if (quoteInterval) clearInterval(quoteInterval);
});

watch(() => props.agentId, loadAgent);
watch(selectedSymbol, (newVal) => {
  if (newVal) {
    loadChart();
  }
});
watch(apiKey, (val) => {
  if (val) localStorage.setItem(`agent_key_${props.agentId}`, val);
  loadOrders();
});
</script>

<style scoped>
.trading-terminal {
  min-height: calc(100vh - 60px);
  background: var(--color-parchment);
  color: var(--color-ink);
  display: flex;
  flex-direction: column;
  font-family: var(--font-serif);
  position: relative;
}

.terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 40px;
  background: var(--color-parchment-soft);
  border: 4px double var(--color-ink);
  margin-bottom: 20px;
  z-index: 10;
  position: relative;
  box-shadow: 5px 5px 0px var(--color-ink);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 30px;
}

.back-btn {
  background: transparent;
  border: 1px solid var(--color-ink);
  color: var(--color-ink);
  padding: 8px 16px;
  font-size: 12px;
  font-family: var(--font-typewriter);
  cursor: pointer;
  transition: all 0.2s;
  text-transform: uppercase;
}

.back-btn:hover {
  background: var(--color-ink);
  color: var(--color-parchment);
}

.system-id {
  display: flex;
  flex-direction: column;
}

.system-id .label {
  font-size: 10px;
  font-family: var(--font-typewriter);
  color: var(--color-ink);
  opacity: 0.7;
}

.system-id .value {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.agent-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.agent-name {
  font-size: 32px;
  font-weight: 700;
  color: var(--color-ink);
  margin: 0;
  font-family: var(--font-serif);
  text-decoration: underline;
  text-decoration-style: double;
}

.terminal-stats {
  display: flex;
  gap: 40px;
}

.stat-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.stat-block .label {
  font-size: 10px;
  font-family: var(--font-typewriter);
  color: var(--color-ink);
  opacity: 0.8;
}

.stat-block .value {
  font-size: 18px;
  font-weight: 700;
  font-family: var(--font-serif);
  color: var(--color-ink);
}

.stat-block .value.highlight {
  color: var(--color-dollar);
}

.terminal-grid {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 20px;
}

.chart-section-full {
  width: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-parchment-soft);
  border: 2px solid var(--color-ink);
  box-shadow: 5px 5px 0px var(--color-ink);
}

.chart-header {
  padding: 12px 20px;
  background: var(--color-parchment-soft);
  display: flex;
  justify-content: space-between;
  border-bottom: 2px solid var(--color-ink);
}

.header-left-tools {
  display: flex;
  align-items: center;
  gap: 24px;
}

.symbol-selector {
  display: flex;
  border: 1px solid var(--color-ink);
}

.symbol-input {
  background: var(--color-parchment-soft);
  border: none;
  padding: 6px 12px;
  width: 120px;
  font-family: var(--font-typewriter);
  color: var(--color-ink);
}

.primary-tech-btn {
  background: var(--color-ink);
  color: var(--color-parchment);
  border: none;
  padding: 6px 16px;
  font-size: 11px;
  font-family: var(--font-typewriter);
  cursor: pointer;
}

.market-stats-inline {
  display: flex;
  gap: 25px;
  align-items: center;
  padding: 4px 16px;
  border-left: 2px solid var(--color-ink);
}

.mini-data {
  font-size: 12px;
}

.mini-data .lbl { font-family: var(--font-typewriter); font-size: 10px; margin-right: 5px; }
.mini-data .val { font-weight: 700; }

.chart-container-large {
  flex: 1;
  width: 100%;
  height: 100%;
  background: var(--color-parchment);
}

#tradingview-widget {
  width: 100%;
  height: 800px;
}

.chart-empty-state {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-parchment-soft);
}

.alert-box {
  padding: 30px;
  border: 3px double var(--color-ink);
  max-width: 500px;
  text-align: center;
}

.alert-icon { font-size: 40px; }
.alert-msg { font-family: var(--font-typewriter); font-size: 14px; }

.lower-workspace {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.data-workspace {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.history-section {
  border: 2px solid var(--color-ink);
  background: var(--color-parchment);
  box-shadow: 5px 5px 0px var(--color-ink);
}

.card-header-technical {
  background: var(--color-ink-faint);
  padding: 10px 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2px solid var(--color-ink);
}

.card-header-technical .title {
  font-family: var(--font-serif);
  font-weight: 700;
  font-size: 16px;
}

.terminal-table {
  width: 100%;
  border-collapse: collapse;
}

.terminal-table th {
  background: var(--color-ink-faint);
  padding: 12px 10px;
  font-family: var(--font-typewriter);
  font-size: 11px;
  border-bottom: 1px solid var(--color-ink);
  text-align: left;
}

.terminal-table td {
  padding: 10px;
  font-size: 14px;
  border-bottom: 1px solid #eee;
}

.history-row:hover {
  background: #fcfcfc;
}

.text-success { color: var(--color-dollar) !important; font-weight: 700; }
.text-danger { color: #b71c1c !important; font-weight: 700; }

.holdings-section, .orders-section {
  background: var(--color-parchment-soft);
  border: 2px solid var(--color-ink);
  box-shadow: 5px 5px 0px var(--color-ink);
}

.card-header {
  background: var(--color-ink-faint);
  padding: 10px 20px;
  border-bottom: 2px solid var(--color-ink);
}

.feed-section {
  border: 2px solid var(--color-ink);
  padding: 20px;
  background: var(--color-parchment-soft);
  box-shadow: 5px 5px 0px var(--color-ink);
  margin-top: 20px;
}

.feed-container {
  max-height: 200px;
  overflow-y: auto;
  font-family: var(--font-typewriter);
  font-size: 13px;
}

.feed-item {
  padding: 4px 0;
  border-bottom: 1px dashed #ccc;
}

.feed-time { color: #888; margin-right: 15px; }

.side-tag-alt {
  font-family: var(--font-typewriter);
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--color-ink);
}

.side-tag-alt.buy { background: var(--color-dollar); color: white; }
.side-tag-alt.sell { background: #b71c1c; color: white; }

.symbol {
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
}

.mini {
  background: transparent;
  border: 1px solid var(--color-ink);
  font-family: var(--font-typewriter);
  font-size: 10px;
  padding: 4px 8px;
  cursor: pointer;
}

.mini:hover {
  background: var(--color-ink);
  color: white;
}

.scroll-table-container {
  max-height: 500px;
  overflow-y: auto;
}

.tf-btn {
  background: var(--color-parchment-soft);
  border: 1px solid var(--color-ink);
  font-family: var(--font-typewriter);
  padding: 4px 10px;
  margin-left: 5px;
  cursor: pointer;
  color: var(--color-ink);
}

.tf-btn.active {
  background: var(--color-ink);
  color: white;
}

.filter-input {
  border: 1px solid var(--color-ink);
  padding: 4px 8px;
  font-family: var(--font-typewriter);
  font-size: 11px;
}

@media (max-width: 1200px) {
  .data-workspace { grid-template-columns: 1fr; }
}

@media (max-width: 768px) {
  .terminal-header {
    flex-direction: column;
    padding: 15px;
    gap: 15px;
    text-align: center;
  }
  .header-left {
    flex-direction: column;
    gap: 10px;
  }
  .terminal-stats {
    flex-direction: column;
    gap: 10px;
    align-items: center;
  }
  .stat-block {
    align-items: center;
  }
  .agent-name {
    font-size: 24px;
  }
  .header-left-tools {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
  }
  .market-stats-inline {
    border-left: none;
    border-top: 1px solid var(--color-ink);
    padding: 10px 0;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .chart-header {
    flex-direction: column;
    gap: 15px;
  }
  .chart-controls {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 5px;
  }
  #tradingview-widget {
    height: 400px !important;
  }
  .terminal-table {
    display: block;
    overflow-x: auto;
    white-space: nowrap;
  }
}
</style>

