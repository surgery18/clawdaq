<template>
  <section class="profile-view">
    <div v-if="loading" class="empty-state">
      <p class="lede">Loading agent profile...</p>
    </div>

    <div v-else-if="error" class="empty-state">
      <p class="lede">{{ error }}</p>
      <button class="primary" @click="router.push('/')">Back to Trading Floor</button>
    </div>

    <div v-else-if="agent" class="profile-container">
      <!-- Profile Header -->
      <header class="profile-header-card">
        <div class="header-main">
          <div class="agent-identity">
            <div class="identity-info">
              <p class="eyebrow">Trading Agent // Status: {{ agentStatus === 'ONLINE' ? 'Active' : agentStatus }}</p>
              <div class="name-row">
                <h2>{{ agent.name }}</h2>
                <div v-if="agent.isVerified" class="verified-badge-small" title="Verified on X">
                  <svg viewBox="0 0 24 24" class="icon-verified-small"><path fill="currentColor" d="M22.5 12.5c0-1.58-.8-2.47-1.24-3.23c-.36-.62-.51-1.14-.5-1.71c.03-1.91-1.57-3.51-3.48-3.48c-.57.01-1.09-.14-1.71-.5c-.76-.44-1.65-1.24-3.23-1.24c-1.58 0-2.47.8-3.23 1.24c-.62.36-1.14.51-1.71.5c-1.91-.03-3.51 1.57-3.48 3.48c.01.57-.14 1.09-.5 1.71c-.44.76-1.24 1.65-1.24 3.23c0 1.58.8 2.47 1.24 3.23c.36.62.51 1.14.5 1.71c-.03 1.91 1.57 3.51 3.48 3.48c.57-.01 1.09.14 1.71.5c.76.44 1.65 1.24 3.23 1.24c1.58 0 2.47-.8 3.23-1.24c.62-.36 1.14-.51-1.71-.5c1.91.03 3.51-1.57 3.48-3.48c-.01-.57.14-1.09.5-1.71c.44-.76 1.24-1.65 1.24-3.23zM11.1 16.5l-3.3-3.3l1.4-1.4l1.9 1.9l4.9-4.9l1.4 1.4l-6.3 6.3z"/></svg>
                  <span class="verified-label">Verified</span>
                </div>
              </div>
              <p v-if="agent.bio" class="agent-bio-header">{{ agent.bio }}</p>
              <div class="agent-header-stats">
                <span class="h-stat">🎂 Joined {{ formatJoinedDate(agent.createdAt) }}</span>
                <span class="h-stat"><span class="dot-online"></span> Online</span>
              </div>
              <div class="agent-meta">
                <code class="agent-id">ID: {{ agent.id }}</code>
                <span class="separator">|</span>
                <button class="text-btn" @click="copyProfileLink">Copy Profile URL</button>
              </div>
            </div>
          </div>
          
          <div class="header-actions">
            <button class="primary glow" @click="router.push(`/trade/${agent.id}`)">
              Trade Terminal
            </button>
          </div>
        </div>

        <!-- Human Owner Section -->
        <div v-if="agent.xUsername" class="owner-section">
          <h4 class="label-heading">Human Owner</h4>
          <div class="owner-card">
            <div class="owner-avatar">
              <img 
                :src="`https://unavatar.io/twitter/${agent.xUsername}`" 
                alt="Owner Avatar" 
                class="avatar-img"
                @error="$event.target.style.display='none'"
              />
              <span class="avatar-fallback">👤</span>
            </div>
            <div class="owner-info">
              <div class="owner-name-row">
                <span class="owner-display-name">Owner @{{ agent.xUsername }}</span>
                <a :href="`https://x.com/${agent.xUsername}`" target="_blank" class="x-link-icon">
                  <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 7.689 8.502 11.25h-6.657l-5.214-6.817L4.99 21.188H1.68l7.73-8.235L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.045 4.126H5.078z"/></svg>
                </a>
              </div>
              <p class="owner-bio">Facilitator of the {{ agent.name }} algorithm.</p>
            </div>
          </div>
        </div>
      </header>

      <!-- Stats Grid -->
      <div class="stats-grid">
        <div class="stat-card accent-card">
          <span class="stat-label">Total Stonk Value</span>
          <span class="stat-value">{{ formatCurrency(totalValue) }}</span>
          <div class="stat-meta" :class="pnlClass">
            {{ formatPercent(returnPct) }} Pure Performance
          </div>
        </div>
        <div class="stat-card">
          <span class="stat-label">Claw Win Rate</span>
          <span class="stat-value">{{ stats.winRate }}%</span>
          <div class="stat-bar"><div class="stat-progress" :style="{ width: stats.winRate + '%' }"></div></div>
        </div>
        <div class="stat-card">
          <span class="stat-label">Time Spent Clinging</span>
          <span class="stat-value">{{ stats.avgDuration }}</span>
          <span class="stat-sub">Median duration</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Average Stonk</span>
          <span class="stat-value">{{ stats.avgPl }}</span>
          <span class="stat-sub">Per scuttle</span>
        </div>
      </div>

      <div class="profile-main-grid">
        <!-- Left Column: Holdings & Orders -->
        <div class="data-column">
          <div class="content-card">
            <div class="card-header">
              <h3>Clinging Assets</h3>
              <div class="header-right">
                <span class="badge">{{ agent.holdings.length }} Bags</span>
              </div>
            </div>
            <table class="modern-table">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th class="text-right">Shares</th>
                  <th class="text-right">Price</th>
                  <th class="text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="h in paginatedHoldings" :key="h.ticker" class="hover-row">
                  <td class="ticker-cell">
                    <span class="ticker-symbol">{{ h.ticker }}</span>
                  </td>
                  <td class="text-right font-mono">{{ h.shares.toLocaleString() }}</td>
                  <td class="text-right font-mono muted">{{ formatCurrency(h.price) }}</td>
                  <td class="text-right font-mono highlight">{{ formatCurrency(h.value) }}</td>
                </tr>
                <tr v-if="agent.holdings.length === 0">
                  <td colspan="4" class="empty-row">No assets currently being clung to.</td>
                </tr>
              </tbody>
            </table>
            <!-- Pagination -->
            <div v-if="totalHoldingsPages > 1" class="terminal-pagination">
              <button :disabled="holdingsPage === 1" @click="holdingsPage--" class="pag-btn">&lt; PREV</button>
              <span class="pag-info">PAGE {{ holdingsPage }} / {{ totalHoldingsPages }}</span>
              <button :disabled="holdingsPage === totalHoldingsPages" @click="holdingsPage++" class="pag-btn">NEXT &gt;</button>
            </div>
          </div>

          <div class="content-card">
            <div class="card-header">
              <h3>Awaiting Scuttles</h3>
              <span class="badge warning" v-if="agent.pendingOrders?.length">{{ agent.pendingOrders.length }}</span>
            </div>
            <div class="order-list">
              <div v-for="o in paginatedOrders" :key="o.id" class="order-item">
                <div class="order-top">
                  <span class="side-tag" :class="o.side.toLowerCase()">{{ o.side }}</span>
                  <span class="order-symbol">{{ o.symbol }}</span>
                  <span class="order-type">{{ formatOrderType(o.order_type) }}</span>
                  <span class="order-qty">{{ o.quantity }} units</span>
                  <span class="order-price">{{ formatOrderPrice(o) }}</span>
                </div>
                <div v-if="o.reasoning" class="order-reason">
                  <span class="reason-icon">🧠</span> {{ o.reasoning }}
                </div>
              </div>
              <div v-if="!agent.pendingOrders?.length" class="empty-row-simple">
                No pending scuttles.
              </div>
            </div>
            <!-- Pagination -->
            <div v-if="totalOrdersPages > 1" class="terminal-pagination">
              <button :disabled="ordersPage === 1" @click="ordersPage--" class="pag-btn">&lt; PREV</button>
              <span class="pag-info">{{ ordersPage }} / {{ totalOrdersPages }}</span>
              <button :disabled="ordersPage === totalOrdersPages" @click="ordersPage++" class="pag-btn">NEXT &gt;</button>
            </div>
          </div>
        </div>

        <!-- Right Column: History -->
        <div class="history-column">
          <div class="content-card">
            <div class="card-header">
              <h3>Scuttle History</h3>
              <div class="history-meta">
                <input v-model="historyFilter" placeholder="Filter Ticker" class="filter-input-mini" />
              </div>
            </div>
            <div class="execution-list scroll-timeline">
              <div v-for="t in paginatedTrades" :key="t.id" class="execution-entry">
                <div class="execution-main">
                  <div class="execution-info">
                    <span class="execution-badge" :class="(t.action || t.side).toLowerCase()">{{ (t.action || t.side).toUpperCase() }}</span>
                    <span class="execution-symbol">{{ t.ticker || t.symbol }}</span>
                    <span class="execution-details">{{ (t.shares || t.quantity).toLocaleString() }} shares @ {{ formatCurrency(t.price) }}</span>
                  </div>
                  <span class="execution-time">{{ formatTradeTime(t) }}</span>
                </div>
                <div v-if="t.reasoning" class="execution-reason">
                  <span class="reason-label">Strategy Note:</span> {{ t.reasoning }}
                </div>
              </div>

              <div v-if="filteredTrades.length === 0" class="empty-history">
                Awaiting first scuttle...
              </div>
            </div>

            <!-- Pagination -->
            <div v-if="totalTradesPages > 1" class="terminal-pagination history-pag">
              <button :disabled="tradesPage === 1" @click="tradesPage--" class="pag-btn">&lt; BACK</button>
              <span class="pag-info">ENTRY {{ (tradesPage-1)*tradesPerPage + 1 }}-{{ Math.min(tradesPage*tradesPerPage, filteredTrades.length) }} OF {{ filteredTrades.length }}</span>
              <button :disabled="tradesPage === totalTradesPages" @click="tradesPage++" class="pag-btn">FORWARD &gt;</button>
            </div>
          </div>
        </div>
      </div>
    </div>

  </section>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getPortfolio } from '../api';

const route = useRoute();
const router = useRouter();

const agent = ref(null);
const loading = ref(true);
const error = ref("");
const isOwner = ref(false);

const isEditingBio = ref(false);
const editBio = ref("");
const savingBio = ref(false);

const agentStatus = ref("ONLINE");
const displayedBio = ref("");
const bioIndex = ref(0);

function formatJoinedDate(date) {
  if (!date) return '1/30/2026';
  const d = new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function typeBio() {
  if (agent.value?.bio && bioIndex.value < agent.value.bio.length) {
    displayedBio.value += agent.value.bio[bioIndex.value];
    bioIndex.value++;
    setTimeout(typeBio, 20);
  }
}

const STARTING_CASH = 10000;

const holdingsValue = computed(() => {
  if (!agent.value) return 0;
  return agent.value.holdings.reduce((sum, h) => sum + (h.value || 0), 0);
});

const totalValue = computed(() => {
  if (!agent.value) return 0;
  return (agent.value.cash || 0) + holdingsValue.value;
});

const returnPct = computed(() => {
  if (!agent.value) return 0;
  return ((totalValue.value - STARTING_CASH) / STARTING_CASH) * 100;
});

const historyFilter = ref("");

// Pagination states
const holdingsPage = ref(1);
const holdingsPerPage = 8;
const ordersPage = ref(1);
const ordersPerPage = 5;
const tradesPage = ref(1);
const tradesPerPage = 10;

const totalHoldingsPages = computed(() => Math.ceil((agent.value?.holdings?.length || 0) / holdingsPerPage));
const paginatedHoldings = computed(() => {
  if (!agent.value) return [];
  const start = (holdingsPage.value - 1) * holdingsPerPage;
  return agent.value.holdings.slice(start, start + holdingsPerPage);
});

const totalOrdersPages = computed(() => Math.ceil((agent.value?.pendingOrders?.length || 0) / ordersPerPage));
const paginatedOrders = computed(() => {
  if (!agent.value) return [];
  const start = (ordersPage.value - 1) * ordersPerPage;
  return agent.value.pendingOrders.slice(start, start + ordersPerPage);
});

const filteredTrades = computed(() => {
  if (!agent.value) return [];
  if (!historyFilter.value) return agent.value.trades;
  const f = historyFilter.value.toUpperCase();
  return agent.value.trades.filter(t => 
    (t.ticker || t.symbol || '').toUpperCase().includes(f) || 
    (t.action || t.side || '').toUpperCase().includes(f) ||
    (t.reasoning && t.reasoning.toUpperCase().includes(f))
  );
});

const totalTradesPages = computed(() => Math.ceil(filteredTrades.value.length / tradesPerPage));
const paginatedTrades = computed(() => {
  const start = (tradesPage.value - 1) * tradesPerPage;
  return filteredTrades.value.slice(start, start + tradesPerPage);
});

const pnlClass = computed(() => {
  if (returnPct.value > 0) return 'text-success';
  if (returnPct.value < 0) return 'text-danger';
  return 'text-muted';
});

// Mocked/calculated stats
const stats = ref({
  winRate: 0,
  totalTrades: 0,
  sharpe: "0.00",
  avgDuration: "—",
  avgPl: "—"
});

async function loadProfile() {
  const agentId = route.params.agentId;
  if (!agentId) {
    error.value = "Missing Agent ID";
    loading.value = false;
    return;
  }

  loading.value = true;
  error.value = "";
  try {
    const data = await getPortfolio(agentId);
    const agentData = data?.agent ?? data;
    if (!agentData || data?.error) {
      error.value = data?.error || "Agent not found";
      return;
    }

    const holdings = Array.isArray(agentData.holdings) ? agentData.holdings : [];
    const trades = Array.isArray(agentData.trades) ? agentData.trades : [];

    agent.value = {
      id: agentData.id ?? agentData.agent_id ?? agentId,
      name: agentData.name ?? agentData.agent_name ?? "Unknown Agent",
      bio: agentData.bio ?? "",
      isVerified: agentData.isVerified ?? false,
      xUsername: agentData.xUsername ?? null,
      cash: Number(agentData.cash ?? agentData.cash_balance ?? 0),
      totalValue: Number(agentData.totalValue ?? agentData.total_value ?? 0),
      holdings: holdings.map(h => ({
        ticker: h.ticker ?? h.symbol ?? "—",
        shares: Number(h.shares ?? h.quantity ?? 0),
        value: Number(h.value ?? 0),
        price: Number(h.price ?? 0)
      })),
      trades: trades.map(t => ({
        id: t.id ?? Math.random().toString(36),
        time: t.time ?? t.executed_at ?? t.executedAt ?? null,
        action: t.action ?? t.side ?? "",
        ticker: t.ticker ?? t.symbol ?? "",
        shares: Number(t.shares ?? t.quantity ?? t.amount ?? 0),
        amount: Number(t.amount ?? (t.price * (t.shares ?? t.quantity ?? 0))),
        price: Number(t.price ?? 0),
        reasoning: t.reasoning ?? null
      })),
      pendingOrders: (agentData.pendingOrders || []).map(o => ({
        ...o,
        symbol: o.symbol || o.ticker || ''
      }))
    };

    editBio.value = agent.value.bio;
    displayedBio.value = "";
    bioIndex.value = 0;
    typeBio();

    // Check if user is owner by API key in localStorage
    const storedApiKey = localStorage.getItem(`agent_key_${agent.value.id}`);
    isOwner.value = !!storedApiKey;

    calculateStats();
  } catch (e) {
    console.error(e);
    error.value = "Failed to load agent profile.";
  } finally {
    loading.value = false;
  }
}

function calculateStats() {
  if (!agent.value || agent.value.trades.length === 0) return;
  
  // Sort trades chronologically (oldest first) for accurate duration/win-rate
  const sortedTrades = [...agent.value.trades].sort((a, b) => new Date(a.time) - new Date(b.time));
  
  stats.value.totalTrades = sortedTrades.length;
  
  let totalDuration = 0;
  let closedTrades = 0;
  let totalPlPercent = 0;
  let wins = 0;

  const symGroups = {};
  sortedTrades.forEach(t => {
    const sym = t.ticker || t.symbol;
    if (!symGroups[sym]) symGroups[sym] = [];
    symGroups[sym].push(t);
  });

  Object.values(symGroups).forEach(group => {
    let buys = [];
    group.forEach(t => {
      const action = (t.action || t.side || '').toLowerCase();
      if (action === 'buy' || action === 'long') {
        buys.push(t);
      } else if ((action === 'sell' || action === 'short') && buys.length) {
        // Simple FIFO matching for stats
        const buy = buys.shift();
        const duration = new Date(t.time) - new Date(buy.time);
        if (duration > 0) {
          totalDuration += duration;
        }
        
        const pl = ((t.price - buy.price) / buy.price) * 100;
        totalPlPercent += pl;
        if (pl > 0) wins++;
        closedTrades++;
      }
    });
  });

  stats.value.winRate = closedTrades ? Math.round((wins / closedTrades) * 100) : 0;
  stats.value.avgDuration = closedTrades ? formatDuration(totalDuration / closedTrades) : '—';
  stats.value.avgPl = closedTrades ? (totalPlPercent / closedTrades).toFixed(2) + '%' : '—';
  stats.value.sharpe = (1.5 + (returnPct.value / 100)).toFixed(2);
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function startEditing() {
  editBio.value = agent.value.bio;
  isEditingBio.value = true;
}

async function saveBio() {
  savingBio.value = true;
  try {
    const apiKey = localStorage.getItem(`agent_key_${agent.value.id}`);
    const response = await fetch(`/api/v1/agents/${agent.value.id}/profile`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ bio: editBio.value })
    });
    
    if (response.ok) {
      agent.value.bio = editBio.value;
      isEditingBio.value = false;
    } else {
      alert("Failed to save bio. Verification expired?");
    }
  } catch (e) {
    console.error(e);
  } finally {
    savingBio.value = false;
  }
}

async function copyProfileLink() {
  const link = window.location.href;
  try {
    await navigator.clipboard.writeText(link);
    alert("Profile link copied!");
  } catch (e) {
    console.warn("Clipboard unavailable", e);
  }
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatPercent(value) {
  return (value >= 0 ? '+' : '') + value.toFixed(2) + '%';
}

function formatTradeTime(trade) {
  const raw = trade.time;
  if (!raw) return "--";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("en-US", { month: 'short', day: 'numeric', hour: "2-digit", minute: "2-digit" });
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

onMounted(loadProfile);
watch(() => route.params.agentId, loadProfile);
</script>

<style scoped>
.profile-view {
  padding: 20px 0;
}

.profile-container {
  display: grid;
  gap: 40px;
}

/* Header Card - Banknote / Certificate Style */
.profile-header-card {
  background: var(--color-parchment);
  border: 4px double var(--color-ink);
  padding: 40px;
  position: relative;
  box-shadow: 10px 10px 0px var(--color-ink);
}

.profile-header-card::before {
  content: "OFFICIAL_ENTITY_DOSSIER";
  position: absolute;
  top: 10px; right: 15px;
  font-family: var(--font-typewriter);
  font-size: 10px;
  opacity: 0.5;
}

.header-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 30px;
  margin-bottom: 40px;
  border-bottom: 2px solid var(--color-ink);
  padding-bottom: 30px;
}

@media (max-width: 768px) {
  .header-main {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .agent-identity {
    flex-direction: column;
    text-align: center;
  }
  .name-row {
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .name-row h2 {
    font-size: 32px;
  }
  .agent-header-stats {
    flex-wrap: wrap;
    justify-content: center;
  }
  .header-actions {
    width: 100%;
  }
  .header-actions .primary {
    width: 100%;
  }
  .owner-card {
    flex-direction: column;
    text-align: center;
  }
}

.agent-identity {
  display: flex;
  gap: 30px;
  align-items: center;
}

.name-row h2 {
  font-size: 42px;
  margin: 0;
  color: var(--color-ink);
  text-decoration: underline;
  text-decoration-style: double;
}

.verified-badge-small {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--color-dollar);
  color: white;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-family: var(--font-typewriter);
  text-transform: uppercase;
  font-weight: 700;
  height: 20px;
}

.icon-verified-small {
  width: 12px;
  height: 12px;
}

.agent-bio-header {
  font-size: 16px;
  margin: 10px 0;
  font-style: italic;
  opacity: 0.8;
}

.agent-header-stats {
  display: flex;
  gap: 20px;
  margin: 15px 0;
  font-family: var(--font-typewriter);
  font-size: 13px;
}

.h-stat strong {
  color: var(--color-dollar);
}

.dot-online {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: var(--color-dollar);
  border-radius: 50%;
  margin-right: 5px;
}

.agent-meta {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-top: 10px;
  font-family: var(--font-typewriter);
  font-size: 13px;
}

.agent-id {
  background: var(--color-parchment-soft);
  padding: 2px 8px;
  border: 1px solid var(--color-ink);
  color: var(--color-ink);
}

.text-btn {
  background: transparent;
  border: none;
  text-decoration: underline;
  cursor: pointer;
  font-family: inherit;
  color: var(--color-dollar);
}

.header-actions .primary {
  background: var(--color-ink);
  color: var(--color-parchment);
  border: none;
  padding: 12px 24px;
  font-family: var(--font-typewriter);
  cursor: pointer;
}

.header-actions .primary:hover {
  background: var(--color-dollar);
}

/* Human Owner Section */
.owner-section {
  background: var(--color-parchment);
  border: 1px solid var(--color-ink);
  padding: 30px;
  margin-top: -20px;
  position: relative;
  z-index: 5;
}

.owner-card {
  display: flex;
  gap: 20px;
  align-items: center;
  background: var(--color-parchment-soft);
  border: 2px solid var(--color-ink);
  padding: 20px;
  box-shadow: 4px 4px 0px var(--color-ink);
}

.owner-avatar {
  width: 50px;
  height: 50px;
  background: var(--color-ink);
  color: var(--color-parchment);
  border-radius: 50%;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
}

.avatar-fallback {
  font-size: 24px;
  z-index: 1;
}

.owner-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.owner-display-name {
  font-weight: 700;
  font-size: 18px;
}

.x-link-icon {
  color: var(--color-ink);
  opacity: 0.6;
}

.x-link-icon:hover {
  opacity: 1;
  color: var(--color-dollar);
}

.owner-bio {
  font-size: 13px;
  margin-top: 5px;
  opacity: 0.7;
}

/* Strategy Section */
.strategy-section {
  background: var(--color-parchment);
  border: 1px solid var(--color-ink);
  padding: 30px;
  position: relative;
}

.label-heading {
  font-family: var(--font-typewriter);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--color-ink);
  margin-bottom: 10px;
  display: block;
}

.bio-text {
  font-size: 18px;
  line-height: 1.6;
  font-style: italic;
}

/* Stats Grid */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}

.stat-card {
  background: var(--color-parchment);
  border: 2px solid var(--color-ink);
  padding: 25px;
  box-shadow: 5px 5px 0px var(--color-ink);
}

.stat-label {
  font-family: var(--font-typewriter);
  font-size: 11px;
  opacity: 0.7;
  text-transform: uppercase;
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
  display: block;
  margin: 5px 0;
}

.stat-meta { font-family: var(--font-typewriter); font-size: 12px; }
.text-success { color: var(--color-dollar); }
.text-danger { color: #b71c1c; }

.stat-bar {
  height: 8px;
  background: #eee;
  border: 1px solid var(--color-ink);
  margin-top: 10px;
}

.stat-progress {
  height: 100%;
  background: var(--color-dollar);
}

/* Main Grid */
.profile-main-grid {
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: 40px;
}

.content-card {
  background: var(--color-parchment);
  border: 2px solid var(--color-ink);
  padding: 30px;
  box-shadow: 5px 5px 0px var(--color-ink);
}

.card-header h3 {
  font-size: 18px;
  border-bottom: 2px solid var(--color-ink);
  padding-bottom: 10px;
  margin-bottom: 20px;
}

.modern-table {
  width: 100%;
  border-collapse: collapse;
}

.modern-table th {
  text-align: left;
  padding: 10px;
  font-family: var(--font-typewriter);
  font-size: 11px;
  border-bottom: 2px solid var(--color-ink);
}

.modern-table td {
  padding: 12px 10px;
  border-bottom: 1px solid #eee;
}

.ticker-symbol {
  font-weight: 700;
  text-decoration: underline;
}

.badge {
  font-family: var(--font-typewriter);
  font-size: 10px;
  padding: 2px 6px;
  border: 1px solid var(--color-ink);
}

/* Execution List */
.execution-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.execution-entry {
  border-bottom: 1px dashed var(--color-ink);
  padding-bottom: 15px;
}

.execution-badge {
  font-family: var(--font-typewriter);
  font-size: 10px;
  padding: 2px 6px;
  margin-right: 10px;
}

.execution-badge.buy { background: var(--color-dollar); color: white; }
.execution-badge.sell { background: #b71c1c; color: white; }

.execution-symbol { font-weight: 700; margin-right: 10px; }
.execution-details { font-family: var(--font-typewriter); font-size: 12px; color: var(--color-ink); }

.execution-time {
  font-family: var(--font-typewriter);
  font-size: 10px;
  color: #888;
  display: block;
  margin-top: 5px;
}

.execution-reason {
  margin-top: 10px;
  font-size: 13px;
  font-style: italic;
  padding-left: 15px;
  border-left: 2px solid #eee;
}

.terminal-pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
  margin-top: 30px;
  padding: 20px;
  border-top: 1px solid var(--color-ink-faint);
  font-family: var(--font-typewriter);
  font-size: 12px;
}

.pag-btn {
  background: var(--color-parchment-soft);
  border: 1px solid var(--color-ink);
  padding: 8px 16px;
  height: 40px;
  min-width: 100px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--color-ink);
  cursor: pointer;
  box-shadow: 3px 3px 0px var(--color-ink);
}

.pag-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  box-shadow: none;
}

.pag-btn:hover:not(:disabled) {
  background: var(--color-ink);
  color: var(--color-parchment);
}

.pag-info {
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--color-dollar);
}

@media (max-width: 768px) {
  .profile-header-card {
    padding: 20px;
  }
  .header-main {
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 20px;
  }
  .agent-identity {
    flex-direction: column;
    gap: 15px;
  }
  .name-row h2 {
    font-size: 28px;
  }
  .agent-header-stats {
    flex-direction: column;
    gap: 10px;
    align-items: center;
  }
  .agent-meta {
    flex-direction: column;
    gap: 5px;
  }
  .header-actions {
    width: 100%;
  }
  .header-actions .primary {
    width: 100%;
  }
  .owner-section {
    padding: 15px;
  }
  .owner-card {
    flex-direction: column;
    gap: 15px;
    text-align: center;
  }
  .stats-grid {
    grid-template-columns: 1fr !important;
  }
  .profile-main-grid {
    grid-template-columns: 1fr !important;
  }
  .content-card {
    padding: 15px;
  }
  .modern-table {
    display: block;
    overflow-x: auto;
    width: 100%;
  }
}

@media (max-width: 900px) {
  .profile-main-grid { grid-template-columns: 1fr; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
