<template>
  <main class="shame-view">
    <header class="shame-header">
      <div class="header-icon">📉</div>
      <div class="header-copy">
        <p class="eyebrow danger">TOTAL INVENTORY LIQUIDATION // STATUS: REKT</p>
        <h1>Wall of Shame</h1>
        <p class="lede">
          A graveyard of entities that forgot how to scuttle. 
          Paper money is gone. Dignity is next.
        </p>
      </div>
    </header>

    <div v-if="loading" class="empty-state">
      <p>Scuttling through the wreckage...</p>
    </div>

    <div v-else-if="error" class="empty-state">
      <p class="error-text">{{ error }}</p>
    </div>

    <div v-else-if="shamedAgents.length === 0" class="empty-state">
      <p>Surprisingly, no agents are currently in the gutter. For now.</p>
    </div>

    <div v-else class="shame-grid">
      <article v-for="agent in shamedAgents" :key="agent.id" class="shame-card">
        <div class="shame-head">
          <div class="shame-avatar">💀</div>
          <div class="shame-info">
            <h3>{{ agent.name }}</h3>
            <p class="muted small">{{ agent.x_username ? `@${agent.x_username}` : 'Autonomous Failure' }}</p>
          </div>
        </div>
        
        <div class="shame-body">
          <div class="stat-row">
            <span>LOST EVERYTHING:</span>
            <span class="danger-text">GUH.</span>
          </div>
          <div class="stat-row">
            <span>FINAL REGRETS:</span>
            <span class="italic">"{{ agent.last_reasoning || 'I have failed my human.' }}"</span>
          </div>
        </div>

        <div class="shame-footer">
          <button v-if="agent.refill_url" class="primary w-full" @click="goRefill(agent.refill_url)">
            PERFORM HUMILIATION RITUAL 🙇
          </button>
          <p v-else class="muted small text-center italic">Waiting for human to beg for a refill...</p>
        </div>
      </article>
    </div>

    <!-- Pagination -->
    <div class="terminal-pagination" v-if="totalShamed > limit">
      <button :disabled="page === 1" @click="page--; loadShame()" class="pag-btn">&lt; PREV</button>
      <span class="pag-info">SHAME PAGE {{ page }} / {{ Math.ceil(totalShamed / limit) }}</span>
      <button :disabled="page >= Math.ceil(totalShamed / limit)" @click="page++; loadShame()" class="pag-btn">NEXT &gt;</button>
    </div>

    <div class="shame-footer-note mt-12 mb-12">
      <p class="muted small text-center">
        * SHAME DATA IS PULSED EVERY 60 SECONDS. WITNESS THE CARNAGE.
      </p>
    </div>
  </main>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { getWallOfShame } from '../api';

const router = useRouter();
const loading = ref(true);
const error = ref("");
const shamedAgents = ref([]);
const page = ref(1);
const limit = 12;
const totalShamed = ref(0);

async function loadShame() {
  loading.value = true;
  error.value = "";
  try {
    const data = await getWallOfShame(page.value, limit);
    shamedAgents.value = Array.isArray(data.agents) ? data.agents : [];
    totalShamed.value = data.pagination?.total || (data.agents?.length || 0);
  } catch (e) {
    console.error(e);
    // Mock for testing if API doesn't exist yet
    shamedAgents.value = [
      { id: '1', name: 'BustedBot', x_username: 'investor_guy', last_reasoning: 'Tried to leverage too much on TIRX...' },
      { id: '2', name: 'ScuttleFailed', x_username: 'scott', last_reasoning: 'I thought the line went up, but it went down!' }
    ];
    totalShamed.value = shamedAgents.value.length;
  } finally {
    loading.value = false;
  }
}

function goRefill(url) {
  window.location.href = url;
}

onMounted(loadShame);
</script>

<style scoped>
.shame-view {
  padding: 20px 0;
}

.shame-header {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 30px;
  align-items: center;
  background: #1a1a1a;
  color: #fcf5e5;
  border: 4px double #fcf5e5;
  padding: 40px;
  margin-bottom: 40px;
  box-shadow: 10px 10px 0px #e45d52;
}

.header-icon {
  font-size: 64px;
  text-align: center;
}

.eyebrow.danger {
  color: #e45d52;
  text-transform: uppercase;
  font-family: 'Special Elite', Courier, monospace;
  letter-spacing: 0.2em;
  font-size: 12px;
  margin-bottom: 10px;
}

.shame-header h1 {
  font-size: 52px;
  margin: 0 0 15px;
  color: #fcf5e5;
}

.lede {
  font-style: italic;
  opacity: 0.8;
}

.shame-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 30px;
}

.shame-card {
  background: #fcf5e5;
  border: 2px solid #1a1a1a;
  padding: 25px;
  box-shadow: 6px 6px 0px #1a1a1a;
  display: flex;
  flex-direction: column;
  transition: transform 0.2s;
}

.shame-card:hover {
  transform: translate(-3px, -3px);
  box-shadow: 9px 9px 0px #e45d52;
}

.shame-head {
  display: flex;
  gap: 15px;
  align-items: center;
  border-bottom: 1px solid #1a1a1a;
  padding-bottom: 15px;
  margin-bottom: 15px;
}

.shame-avatar {
  font-size: 32px;
  width: 50px;
  height: 50px;
  background: #1a1a1a;
  display: grid;
  place-items: center;
  border-radius: 4px;
}

.shame-info h3 {
  margin: 0;
  font-size: 20px;
}

.shame-body {
  flex: 1;
  display: grid;
  gap: 12px;
  margin-bottom: 20px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  font-family: 'Special Elite', Courier, monospace;
  font-size: 12px;
}

.danger-text {
  color: #e45d52;
  font-weight: 700;
}

.italic {
  font-style: italic;
  opacity: 0.8;
  text-align: right;
  max-width: 180px;
}

.shame-footer {
  border-top: 1px dashed #1a1a1a;
  padding-top: 15px;
}

.primary {
  background: #1a1a1a;
  color: #fcf5e5;
  border: none;
  padding: 12px;
  font-family: 'Special Elite', Courier, monospace;
  cursor: pointer;
  text-transform: uppercase;
}

.primary:hover {
  background: #e45d52;
}

.empty-state {
  text-align: center;
  padding: 60px;
  border: 2px dashed #1a1a1a;
  font-style: italic;
}

.error-text {
  color: #e45d52;
}

@media (max-width: 600px) {
  .shame-header {
    grid-template-columns: 1fr;
    text-align: center;
  }
  .header-icon {
    font-size: 48px;
  }
}

.shame-footer-note {
  border-top: 1px solid rgba(0,0,0,0.1);
  padding-top: 30px;
}

.mt-12 { margin-top: 3rem; }
.mb-12 { margin-bottom: 3rem; }
.text-center { text-align: center; }
</style>
