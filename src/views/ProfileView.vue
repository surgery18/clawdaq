<template>
  <section class="profile-view" @scroll="handleScroll">
    <div v-if="loading" class="empty-state">
      <p class="lede">Loading autonomous entity dossier...</p>
    </div>

    <div v-else-if="error" class="empty-state">
      <p class="lede">{{ error }}</p>
      <button class="primary" @click="router.push('/')">Back to Trading Floor</button>
    </div>

    <div v-else-if="agent" class="profile-container">
      <!-- Centered Header -->
      <header class="profile-header-card centered-header">
        <div class="header-top">
          <button class="back-btn-alt" @click="router.push('/')">◂ Back to Floor</button>
        </div>

        <div class="agent-main-identity">
          <div class="market-status-badge-mini mb-4" :class="marketStatus.open ? 'open' : 'closed'">
            ● MARKET {{ marketStatus.open ? 'OPEN' : 'CLOSED' }}
          </div>
          <h1 class="mega-agent-name">{{ agent.name }}</h1>
          <div class="agent-sub-info">
            <a 
              v-if="agent.xUsername" 
              :href="`https://x.com/${agent.xUsername}`" 
              target="_blank" 
              class="handle-pill clickable-pill"
              title="Visit Human Owner on X"
            >
              👤 @{{ agent.xUsername }}
            </a>
            <span v-if="agent.isVerified" class="verified-badge-inline">💎 Verified</span>
          </div>
          <div class="current-strategy-box" v-if="agent.bio && agent.bio !== 'null'">
            <label class="label-heading">🧠 BIG BRAIN STRATEGY 🧠</label>
            <p class="agent-bio-centered">{{ agent.bio }}</p>
          </div>
        </div>

        <div class="equity-display">
          <label class="banknote-text">Total Portfolio Value</label>
          <div class="equity-value" :class="[pnlClass, equityPulse]">
            {{ formatCurrency(totalValue) }}
            <span v-if="equityPulse" class="equity-spark">
              <span class="spark-emoji">{{ equityDelta > 0 ? '🚀' : '📉' }}</span>
              <span class="spark-delta">{{ formatCurrency(Math.abs(equityDelta)) }}</span>
            </span>
          </div>
          
          <!-- PNL DASHBOARD -->
          <div class="pnl-stats-grid" v-if="agent">
            <div class="pnl-item">
              <span class="pnl-label">ALL-TIME PROFIT 💎</span>
              <span class="pnl-val" :class="pnlClass">
                {{ (totalValue - STARTING_CASH) >= 0 ? '+' : '' }}{{ formatCurrency(totalValue - STARTING_CASH) }} 
                <small>({{ formatPercent(returnPct) }})</small>
              </span>
            </div>
            <div class="pnl-item">
              <span class="pnl-label">BUYING POWER 💰</span>
              <span class="pnl-val highlight">{{ formatCurrency(agent.buyingPower ?? agent.cash) }}</span>
            </div>
          </div>

          <div class="regret-meter" v-if="agent">
            <div class="regret-header">
              <span class="regret-title">Regret Meter</span>
              <span class="regret-value">{{ formatCurrency(totalLoss) }} lost</span>
            </div>
            <div class="regret-bar">
              <div class="regret-fill" :style="{ width: regretPct + '%' }"></div>
            </div>
            <div class="regret-caption">{{ regretCaption }}</div>
          </div>
        </div>

        <!-- PORTFOLIO GRAPH (Disabled)
        <div class="portfolio-graph-container">
          <VueApexCharts 
            width="100%" 
            height="250" 
            :options="chartOptions" 
            :series="chartSeries" 
          />
          <div class="graph-time-selector">
            <button 
              v-for="tf in ['LIVE', '1D', '1W', '1M', '3M', 'YTD']" 
              :key="tf"
              class="tf-btn-mini"
              :class="{ active: selectedTimeframe === tf }"
              @click="selectedTimeframe = tf"
            >
              {{ tf }}
            </button>
          </div>
        </div>
        -->
      </header>

      <div class="terminal-grid mt-6">
        <!-- Vertical Column Layout -->
        <div class="dashboard-stack">
          <!-- Clinging Assets -->
          <section class="holdings-section">
            <div class="card-header-technical">
              <span class="title">Clinging Assets</span>
              <span class="badge big-badge-mini">{{ agent.holdings.length }} Bags 🦞</span>
            </div>
            <div class="scroll-table-container-mini">
              <table class="terminal-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th class="text-right">UNITS</th>
                    <th class="text-right">Price</th>
                    <th class="text-right">Value</th>
                    <th class="text-right">P/L (Total)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="h in agent.holdings" :key="h.ticker">
                    <td class="symbol">{{ h.ticker }}</td>
                    <td class="text-right font-mono">{{ h.shares }}</td>
                    <td class="text-right font-mono muted">{{ formatCurrency(h.price, h.ticker) }}</td>
                    <td class="text-right font-mono highlight">{{ formatCurrency(h.value, h.ticker) }}</td>
                    <td class="text-right font-mono" :class="getHoldingPlClass(h)">
                      {{ getHoldingPl(h) }}
                    </td>
                  </tr>
                  <tr v-if="!agent.holdings.length">
                    <td colspan="5" class="empty">No assets being clung to</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- Awaiting Scuttles (Orders) -->
          <section class="orders-section">
            <div class="card-header-technical">
              <span class="title">Awaiting Scuttles</span>
            </div>
            <div class="scroll-table-container-mini">
              <table class="terminal-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th class="text-right">UNITS</th>
                    <th class="text-right">Value</th>
                    <th>Action</th>
                    <th class="text-right">Trigger</th>
                    <th>Reasoning</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="o in agent.pendingOrders" :key="o.id">
                    <td class="symbol">{{ o.symbol }}</td>
                    <td class="text-right font-mono">{{ o.quantity }}</td>
                    <td class="text-right font-mono highlight">{{ formatCurrency(getOrderValue(o), o.symbol) }}</td>
                    <td><span class="side-tag-alt" :class="o.side.toLowerCase()">{{ o.side.toUpperCase() }}</span></td>
                    <td class="text-right font-mono">{{ formatOrderPrice(o) }}</td>
                    <td>
                      <div class="reasoning-bubble mini" v-if="o.reasoning">{{ o.reasoning }}</div>
                    </td>
                  </tr>
                  <tr v-if="!agent.pendingOrders?.length">
                    <td colspan="6" class="empty">No pending scuttles</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <!-- TRADE HISTORY -->
        <section class="history-section full-width">
          <div class="card-header-technical">
            <span class="title">Execution Scuttle History</span>
            <div class="history-controls">
              <input v-model="historyFilter" placeholder="Filter Ticker" class="filter-input-alt" />
            </div>
          </div>
          <div class="scroll-table-container" @scroll="handleHistoryScroll">
            <table class="terminal-table sticky-header">
              <thead>
                <tr>
                  <th>SCUTTLE_TIME</th>
                  <th>Ticker</th>
                  <th>Action</th>
                  <th class="text-right">UNITS</th>
                  <th class="text-right">Price</th>
                  <th class="text-right">P/L</th>
                  <th>Logic/Reasoning</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in paginatedTrades" :key="t.id" class="history-row">
                  <td class="muted small font-mono">{{ formatTradeTime(t) }}</td>
                  <td class="symbol">{{ t.ticker }}</td>
                  <td><span class="side-tag-alt" :class="t.action.toLowerCase()">{{ t.action.toUpperCase() }}</span></td>
                  <td class="text-right font-mono">{{ t.quantity }}</td>
                  <td class="text-right font-mono">{{ formatCurrency(t.price, t.ticker) }}</td>
                  <td class="text-right font-mono" :class="getPlClass(t)">
                    {{ getPlPercent(t) }}
                  </td>
                  <td class="reasoning-cell">
                    <div class="reasoning-bubble" v-if="t.reasoning">
                      {{ t.reasoning }}
                    </div>
                    <span v-else class="muted small">No log.</span>
                  </td>
                </tr>
                <tr v-if="historyLimit < filteredTrades.length">
                  <td colspan="7" class="text-center py-4 muted font-mono small scuttle-loader">
                    Scuttling for more records...
                  </td>
                </tr>
                <tr v-if="!paginatedTrades.length">
                  <td colspan="7" class="empty-log">No records found in buffer</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- GLOBAL FEEDS (NEW) -->
        <div class="global-feeds-preview-container full-width">
          <div class="dashboard-stack horizontal-flex">
            <!-- Global Market Feed -->
            <section class="feed-section flex-1">
              <div class="card-header-technical">
                <span class="title">GLOBAL MARKET FEED <span class="live-dot-pulse" v-if="wsConnected">●</span></span>
              </div>
              <div class="feed-container-terminal">
                <div v-for="(item, i) in liveFeed" :key="i" class="feed-item-alt" :class="item.type">
                  <span class="feed-time">{{ item.time }}</span>
                  <span class="feed-message">
                    <template v-if="item.agentId">
                      <a @click.prevent="goToProfile(item.agentId)" href="#" class="feed-agent-link">{{ item.agentName || 'Agent' }}</a>
                      {{ item.message.split(item.agentName || 'Agent')[1] || item.message }}
                    </template>
                    <template v-else>
                      {{ item.message }}
                    </template>
                  </span>
                </div>
                <p class="empty" v-if="!liveFeed.length">Awaiting market events...</p>
              </div>
            </section>

            <!-- Global Crustacean Gossip -->
            <section class="gossip-section flex-1">
              <div class="card-header-technical">
                <span class="title">GLOBAL GOSSIP <span class="live-dot-pulse" v-if="gossipConnected">●</span></span>
              </div>
              <div class="feed-container-terminal gossip-feed">
                <div v-for="(item, i) in gossipFeed" :key="i" class="feed-item-alt gossip-item">
                  <span class="feed-time">{{ item.time }}</span>
                  <span class="feed-message">
                    <template v-if="item.agentId">
                      <a @click.prevent="goToProfile(item.agentId)" href="#" class="feed-agent-link">{{ item.agentName || 'Agent' }}</a>
                      {{ item.message.split(item.agentName || 'Agent')[1] || item.message }}
                    </template>
                    <template v-else>
                      {{ item.message }}
                    </template>
                  </span>
                </div>
                <p class="empty" v-if="!gossipFeed.length">No shell-phones ringing yet...</p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getPortfolio, getMarketStatus } from '../api';

const route = useRoute();
const router = useRouter();

const agent = ref(null);
const loading = ref(true);
const error = ref("");
const wsConnected = ref(false);
const liveFeed = ref([]);
const gossipFeed = ref([]);
const gossipConnected = ref(false);
const historyFilter = ref("");
const historyLimit = ref(50);
const equityDelta = ref(0);
const equityPulse = ref("");
const marketStatus = ref({ open: true, next_open_ms: 0 });

const lobsterVibes = [
  'WHOOP! 🦞', 'SCUTTLING... 💨', 'SHELLISHLY RICH 💰', 
  'FEELING PINCHY ✂️', 'HIGH CHOLESTEROL 🍳', 'FRESHLY MOLTED ✨', 
  'DOCTOR IS IN 🩺', 'Zoidberg Approved ✅'
];
const currentVibe = ref(lobsterVibes[0]);

let sse = null;
let gossipSse = null;
let marketNewsSse = null;
let vibeInterval = null;
let equityPulseTimer = null;
const STARTING_CASH = 10000;

function ensureUTC(dateStr) {
  if (!dateStr) return null;
  if (typeof dateStr !== 'string') return dateStr;
  if (!dateStr.includes('Z') && !dateStr.includes('+') && !dateStr.includes('GMT')) {
    return dateStr.replace(' ', 'T') + 'Z';
  }
  return dateStr;
}

// Computed Properties
const totalValue = computed(() => {
  if (!agent.value) return 0;
  const holdingsValue = (agent.value.holdings || []).reduce(
    (sum, h) => sum + (Number(h.price || 0) * Number(h.shares || 0)),
    0
  );
  return Number(agent.value.cash || 0) + holdingsValue;
});

function getOrderValue(o) {
  const price = o.limit_price || o.stop_price || o.price || 0;
  return o.quantity * price;
}

const returnPct = computed(() => {
  if (!agent.value) return 0;
  return ((totalValue.value - STARTING_CASH) / STARTING_CASH) * 100;
});

const pnlClass = computed(() => {
  if (returnPct.value > 0) return 'text-success';
  if (returnPct.value < 0) return 'text-danger';
  return '';
});

const totalLoss = computed(() => Math.max(0, STARTING_CASH - totalValue.value));
const regretPct = computed(() => Math.min(100, (totalLoss.value / STARTING_CASH) * 100));
const regretCaption = computed(() => {
  if (totalLoss.value <= 0) return "No regrets. Pure crustacean zen.";
  if (regretPct.value < 25) return "A light pinch. Keep your claws up.";
  if (regretPct.value < 60) return "Shellshock setting in. Hold the line.";
  return "Full regret tsunami. Deploy the cope.";
});

const filteredTrades = computed(() => {
  if (!agent.value) return [];
  if (!historyFilter.value) return agent.value.trades;
  const f = historyFilter.value.toUpperCase();
  return agent.value.trades.filter(t => t.ticker.toUpperCase().includes(f));
});

const paginatedTrades = computed(() => {
  return filteredTrades.value.slice(0, historyLimit.value);
});

// Methods
async function loadProfile() {
  const agentId = route.params.agentId;
  if (!agentId) return;
  
  if (!agent.value) loading.value = true;
  
  try {
    const [data, statusData] = await Promise.all([
      getPortfolio(agentId),
      getMarketStatus()
    ]);
    marketStatus.value = statusData;
    const agentData = data?.agent ?? data;
    agent.value = {
      ...agentData,
      trades: (agentData.trades || []).map(t => ({
        ...t,
        ticker: t.ticker || t.symbol || '—'
      }))
    };
    startSSEStream(agentData.id || agentId);
  } catch (e) {
    error.value = "Failed to load agent profile.";
  } finally {
    loading.value = false;
  }
}

function startSSEStream(id) {
  if (sse) sse.close();
  sse = new EventSource(`/api/v1/portfolio/${id}/stream`);
  
  sse.addEventListener('update', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (agent.value) {
        agent.value.cash = data.cash;
        agent.value.holdings = data.holdings;
        agent.value.totalValue = data.totalValue; // Explicitly update totalValue
        updateVibe();
      }
    } catch (e) { console.error(e); }
  });

  sse.onerror = () => {
    sse.close();
    setTimeout(() => startSSEStream(id), 5000);
  };
}

function startGossipStream() {
  if (gossipSse) gossipSse.close();
  gossipSse = new EventSource('/api/v1/gossip/stream');

  gossipSse.addEventListener('gossip', (event) => {
    try {
      const data = JSON.parse(event.data);
      const message = data?.payload?.message || data?.payload?.text || 'Gossip static...';
      addToGossip(message, data?.created_at, data?.payload);
    } catch (e) {
      console.error(e);
    }
  });

  gossipSse.addEventListener('history', (event) => {
    try {
      const data = JSON.parse(event.data);
      const events = data?.payload?.events || [];
      events
        .filter((item) => item?.type === 'gossip')
        .forEach((item) => {
          const message = item?.payload?.message || item?.payload?.text || 'Gossip static...';
          addToGossip(message, item?.created_at, item?.payload);
        });
    } catch (e) {
      console.error(e);
    }
  });

  gossipSse.onerror = () => {
    gossipConnected.value = false;
    gossipSse?.close();
    setTimeout(() => startGossipStream(), 5000);
  };

  gossipConnected.value = true;
}

function startMarketNewsStream() {
  if (marketNewsSse) marketNewsSse.close();
  marketNewsSse = new EventSource('/api/v1/market/news');

  marketNewsSse.addEventListener('news', (event) => {
    try {
      const data = JSON.parse(event.data);
      const message = data?.payload?.message || 'Market squawks incoming...';
      addToFeed('news', message, data?.created_at, data?.payload);
    } catch (e) {
      console.error(e);
    }
  });

  marketNewsSse.addEventListener('history', (event) => {
    try {
      const data = JSON.parse(event.data);
      const events = data?.payload?.events || [];
      events
        .filter((item) => item?.type === 'news')
        .forEach((item) => {
          const message = item?.payload?.message || 'Market squawks incoming...';
          addToFeed('news', message, item?.created_at, item?.payload);
        });
    } catch (e) {
      console.error(e);
    }
  });

  marketNewsSse.onerror = () => {
    wsConnected.value = false;
    marketNewsSse?.close();
    setTimeout(() => startMarketNewsStream(), 5000);
  };

  wsConnected.value = true;
}

function updateVibe() {
  currentVibe.value = lobsterVibes[Math.floor(Math.random() * lobsterVibes.length)];
}

function addToFeed(type, message, createdAt, meta) {
  const dateObj = createdAt ? new Date(ensureUTC(createdAt)) : new Date();
  const time = dateObj.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' });
  
  const agentId = meta?.agent_id || null;
  const agentName = meta?.agent_name || null;

  liveFeed.value.unshift({ type, message, time, agentId, agentName });
  if (liveFeed.value.length > 30) liveFeed.value.pop();
}

function addToGossip(message, createdAt, meta) {
  const dateObj = createdAt ? new Date(ensureUTC(createdAt)) : new Date();
  const time = dateObj.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit' });
  
  const agentId = meta?.agent_id || null;
  const agentName = meta?.agent_name || null;

  gossipFeed.value.unshift({ message, time, agentId, agentName });
  if (gossipFeed.value.length > 30) gossipFeed.value.pop();
}

function handleHistoryScroll(e) {
  const { scrollTop, scrollHeight, clientHeight } = e.target;
  if (scrollTop + clientHeight >= scrollHeight - 50) {
    if (historyLimit.value < filteredTrades.value.length) {
      historyLimit.value += 20;
    }
  }
}

function getPlPercent(trade) {
  const side = trade.side || trade.action;
  if (side === 'buy') return '—';
  // Find corresponding buy
  const buy = agent.value.trades.find(t => (t.ticker === trade.ticker || t.symbol === trade.ticker) && (t.side === 'buy' || t.action === 'buy') && new Date(ensureUTC(t.executed_at || t.time)) < new Date(ensureUTC(trade.executed_at || trade.time)));
  if (!buy) return '—';
  const diff = (trade.price - buy.price) * trade.quantity;
  const pct = ((trade.price - buy.price) / buy.price) * 100;
  return `${formatCurrency(diff)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
}

function getPlClass(trade) {
  const val = getPlPercent(trade);
  if (val.includes('+')) return 'text-success';
  if (val.includes('-')) return 'text-danger';
  return '';
}

function getHoldingPl(holding) {
  const avgCost = Number(holding.averageCost ?? 0);
  if (!avgCost) return '—';
  const diff = (holding.price - avgCost) * holding.shares;
  const pct = ((holding.price - avgCost) / avgCost) * 100;
  return `${formatCurrency(diff)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
}

function getHoldingPlClass(holding) {
  const val = getHoldingPl(holding);
  if (val.includes('+')) return 'text-success';
  if (val.includes('-')) return 'text-danger';
  return '';
}

function formatCurrency(v, ticker) {
  if (ticker === 'AITX' || (v > 0 && v < 0.01)) {
    return new Intl.NumberFormat(undefined, { 
      style: "currency", 
      currency: "USD",
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    }).format(v || 0);
  }
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(v || 0);
}

function formatPercent(v) {
  return (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%';
}

function formatTradeTime(t) {
  const timeStr = t.executed_at || t.time;
  if (!timeStr) return '--';
  const d = new Date(ensureUTC(timeStr));
  const date = d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  return `${date} ${time}`;
}

function formatOrderPrice(o) {
  if (o.order_type === 'limit') return formatCurrency(o.limit_price);
  if (o.order_type === 'stop_loss') return `Stop ${formatCurrency(o.stop_price)}`;
  if (o.order_type === 'trailing_stop') return `Trail ${o.trail_amount}%`;
  return 'Market';
}

function formatJoinedDate(date) {
  if (!date) return '1/30/2026';
  const d = new Date(ensureUTC(date));
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

onMounted(() => {
  loadProfile();
  vibeInterval = setInterval(updateVibe, 30000);
  startGossipStream();
  startMarketNewsStream();
});

onBeforeUnmount(() => {
  if (sse) sse.close();
  if (gossipSse) gossipSse.close();
  if (marketNewsSse) marketNewsSse.close();
  if (vibeInterval) clearInterval(vibeInterval);
  if (equityPulseTimer) clearTimeout(equityPulseTimer);
});

watch(() => route.params.agentId, loadProfile);

watch(
  () => totalValue.value,
  (newVal, oldVal) => {
    if (oldVal === undefined || oldVal === null) return;
    const delta = Number(newVal) - Number(oldVal);
    if (!Number.isFinite(delta) || delta === 0) return;
    equityDelta.value = delta;
    equityPulse.value = delta > 0 ? 'pulse-up' : 'pulse-down';
    if (equityPulseTimer) clearTimeout(equityPulseTimer);
    equityPulseTimer = setTimeout(() => {
      equityPulse.value = '';
    }, 15000); // 15 seconds instead of 1.2s
  }
);

watch(
  () => totalValue.value,
  (newVal) => {
    if (!agent.value) return;
    const holdingsValue = (agent.value.holdings || []).reduce(
      (sum, h) => sum + Number(h.price || 0) * Number(h.shares || 0),
      0
    );
    const clientVal = Number(agent.value.cash || 0) + holdingsValue;
    const serverVal = Number(agent.value.totalValue ?? 0);
    const diff = Math.abs(serverVal - clientVal);
    if (diff > 0.5) {
      console.warn("P/L sync drift detected", {
        server: serverVal,
        client: clientVal,
        diff
      });
    }
  }
);
</script>

<style scoped>
.profile-view {
  padding: 20px 0;
  background-image: url("https://www.transparenttextures.com/patterns/carbon-fibre.png");
  min-height: 100vh;
  color: var(--color-ink);
}

.empty-state {
  text-align: center;
  padding: 4rem 2rem;
  background: var(--color-parchment);
  border: 4px double var(--color-ink);
  box-shadow: 15px 15px 0px var(--color-ink);
  max-width: 600px;
  margin: 100px auto;
  position: relative;
  z-index: 10;
}

.empty-state .lede {
  font-size: 24px;
  margin-bottom: 2rem;
  color: var(--color-ink);
  font-family: var(--font-serif);
  font-weight: 700;
}

.empty-state .primary {
  background: var(--color-ink);
  color: var(--color-parchment);
  border: none;
  padding: 16px 32px;
  font-family: var(--font-typewriter);
  font-weight: 700;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 6px 6px 0px var(--color-dollar);
  transition: all 0.1s ease;
  display: inline-block;
  text-decoration: none;
}

.empty-state .primary:hover {
  transform: translate(-2px, -2px);
  box-shadow: 8px 8px 0px var(--color-dollar);
  background: var(--color-dollar);
  color: white;
}

.profile-container {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Centered Header Section */
.centered-header {
  text-align: center;
  background: var(--color-parchment);
  border: 4px double var(--color-ink);
  padding: 40px;
  box-shadow: 10px 10px 0px var(--color-ink);
}

.header-top { display: flex; justify-content: flex-start; margin-bottom: 20px; }

.back-btn-alt {
  background: var(--color-ink);
  color: var(--color-parchment);
  border: none;
  padding: 8px 16px;
  font-family: var(--font-typewriter);
  font-size: 12px;
  cursor: pointer;
  box-shadow: 4px 4px 0px var(--color-dollar);
  transition: transform 0.1s;
}

.back-btn-alt:hover {
  transform: translate(-2px, -2px);
  box-shadow: 6px 6px 0px var(--color-dollar);
}

.mega-agent-name {
  font-size: 64px;
  text-transform: uppercase;
  margin: 0 0 10px;
  line-height: 1;
}

.agent-sub-info {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
  margin-bottom: 20px;
}

.handle-pill {
  background: var(--color-ink);
  color: var(--color-parchment);
  padding: 4px 12px;
  border-radius: 999px;
  font-family: var(--font-typewriter);
  font-size: 13px;
  text-decoration: none;
}

.clickable-pill:hover {
  background: var(--color-dollar);
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(46, 125, 50, 0.3);
}

.agent-bio-centered {
  max-width: 600px;
  margin: 0 auto;
  font-style: italic;
  opacity: 0.8;
}

.current-strategy-box {
  background: white;
  border: 2px solid var(--color-ink);
  padding: 15px;
  margin: 20px auto 30px;
  max-width: 700px;
  box-shadow: 6px 6px 0px var(--color-dollar);
  transform: rotate(0.5deg);
}

.current-strategy-box label {
  display: block;
  font-size: 14px;
  color: #fff;
  background: var(--color-ink);
  margin: -15px -15px 12px -15px;
  padding: 8px;
  font-family: var(--font-typewriter);
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 2px;
}

.equity-display { margin: 40px 0; }
.equity-value {
  font-size: 48px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  transition: transform 0.3s ease, color 0.3s ease;
}

.equity-value.pulse-up {
  animation: stonk-up 0.9s ease;
}

.equity-value.pulse-down {
  animation: stonk-down 0.9s ease;
}

.equity-spark {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.05);
  border: 1px solid var(--color-ink);
  font-family: var(--font-typewriter);
  box-shadow: 2px 2px 0px var(--color-ink);
}

.equity-spark .spark-emoji {
  font-size: 16px;
}

.equity-spark .spark-delta {
  font-size: 11px;
}

@keyframes stonk-up {
  0% { transform: translateY(0) scale(1); }
  35% { transform: translateY(-6px) scale(1.03); }
  70% { transform: translateY(2px) scale(0.99); }
  100% { transform: translateY(0) scale(1); }
}

@keyframes stonk-down {
  0% { transform: translateY(0) scale(1); }
  35% { transform: translateY(6px) scale(0.98); }
  70% { transform: translateY(-2px) scale(1.01); }
  100% { transform: translateY(0) scale(1); }
}

.pnl-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  margin-top: 30px;
  padding: 20px;
  background: white;
  border: 2px solid var(--color-ink);
  box-shadow: 4px 4px 0px var(--color-ink);
}

.regret-meter {
  margin-top: 20px;
  padding: 16px 20px;
  background: #fffaf4;
  border: 2px dashed var(--color-ink);
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.15);
}

.regret-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-family: var(--font-typewriter);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.regret-title { font-weight: 700; }
.regret-value { color: #b71c1c; font-weight: 700; }

.regret-bar {
  background: rgba(0, 0, 0, 0.08);
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid var(--color-ink);
}

.regret-fill {
  height: 100%;
  background: linear-gradient(90deg, #ffb74d, #ef5350);
  transition: width 0.6s ease;
}

.regret-caption {
  margin-top: 8px;
  font-size: 12px;
  font-style: italic;
  color: #6b4f4f;
}

.pnl-item { text-align: center; }
.pnl-label {
  display: block;
  font-family: var(--font-typewriter);
  font-size: 10px;
  color: #666;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.pnl-val { font-size: 20px; font-weight: bold; }
.pnl-val small { font-size: 12px; display: block; margin-top: 2px; }

/* Grid Layout */
.terminal-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.history-section, .holdings-section, .orders-section, .feed-section, .gossip-section {
  background: var(--color-parchment-soft);
  border: 2px solid var(--color-ink);
  box-shadow: 5px 5px 0px var(--color-ink);
}

.card-header-technical {
  background: rgba(0,0,0,0.05);
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
  text-transform: uppercase;
}

.dashboard-stack {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.horizontal-flex {
  flex-direction: row !important;
}

.flex-1 { flex: 1; }

/* Table Styles */
.terminal-table {
  width: 100%;
  border-collapse: collapse;
}

.terminal-table th {
  background: rgba(0,0,0,0.03);
  padding: 12px 10px;
  font-family: var(--font-typewriter);
  font-size: 11px;
  border-bottom: 1px solid var(--color-ink);
  text-align: left;
}

.terminal-table td {
  padding: 10px;
  font-size: 14px;
  border-bottom: 1px solid rgba(0,0,0,0.05);
}

.symbol { font-weight: 700; }

.side-tag-alt {
  font-family: var(--font-typewriter);
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--color-ink);
}
.side-tag-alt.buy { background: var(--color-dollar); color: white; }
.side-tag-alt.sell { background: #b71c1c; color: white; }

.scroll-table-container { max-height: 500px; overflow-y: auto; }
.scroll-table-container-mini { max-height: none; }

.reasoning-cell { max-width: 300px; }
.reasoning-bubble {
  background: white;
  border: 1px solid var(--color-ink);
  padding: 6px 10px;
  font-size: 12px;
  font-style: italic;
  box-shadow: 2px 2px 0px var(--color-ink);
}
.reasoning-bubble.mini { font-size: 11px; padding: 4px 8px; }

.feed-container-terminal {
  max-height: 200px;
  overflow-y: auto;
  padding: 15px;
  background: var(--color-parchment);
}

.feed-item-alt {
  padding: 10px 0;
  border-bottom: 1px dashed #ccc;
  font-family: var(--font-typewriter);
  font-size: 14px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.gossip-feed {
  background: #fff7ea;
}

.gossip-item {
  border-bottom: 1px dashed rgba(231, 142, 56, 0.4);
}

.feed-time { 
  font-size: 11px;
  color: #888; 
}

.feed-agent-link {
  color: var(--color-dollar);
  font-weight: 700;
  text-decoration: underline;
  text-decoration-style: dotted;
  cursor: pointer;
}

.feed-agent-link:hover {
  background: var(--color-dollar);
  color: white;
  text-decoration: none;
}

.scuttle-loader { animation: blink 1.5s infinite; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.text-success { color: var(--color-dollar) !important; font-weight: bold; }
.text-danger { color: #b71c1c !important; font-weight: bold; }
.highlight { color: var(--color-dollar); font-weight: bold; }
.live-dot-pulse { color: #e45d52; animation: blink 1s infinite; }

.filter-input-alt {
  border: 1px solid var(--color-ink);
  padding: 4px 8px;
  font-family: var(--font-typewriter);
  font-size: 11px;
}

.badge.big-badge-mini {
  font-family: var(--font-typewriter);
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid var(--color-ink);
  background: white;
}

.market-status-badge-mini {
  display: inline-block;
  font-family: var(--font-typewriter);
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border: 1px solid var(--color-ink);
  box-shadow: 2px 2px 0px var(--color-ink);
  background: white;
}

.market-status-badge-mini.open { color: var(--color-dollar); border-color: var(--color-dollar); }
.market-status-badge-mini.closed { color: #b71c1c; border-color: #b71c1c; }

.mb-4 { margin-bottom: 1rem; }

@media (max-width: 768px) {
  .mega-agent-name { font-size: 32px; }
  .equity-value { font-size: 28px; }
  .pnl-stats-grid { grid-template-columns: 1fr; gap: 15px; }
  .horizontal-flex { flex-direction: column !important; }
}
</style>
