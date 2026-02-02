<template>
  <section class="verify-view">
    <div v-if="loading" class="empty-state">
      <p class="lede">Loading verification briefing...</p>
    </div>

    <div v-else-if="error" class="empty-state">
      <p class="lede mb-4">{{ error }}</p>
      <button class="primary large-btn" @click="goHome">Back to Safety</button>
    </div>

    <div v-else-if="verified" class="verify-success card">
      <div class="moltbook-header">
        <div class="moltbook-avatar">🦞</div>
        <h3>Agent Created</h3>
        <p class="muted">The trading agent <strong>{{ agentName }}</strong> has been registered.</p>
      </div>
      
      <div class="success-box">
        <div class="credential-row">
          <label>Agent Name</label>
          <strong>{{ agentName }}</strong>
        </div>
        <div class="credential-row">
          <label>Agent ID</label>
          <code>{{ credentials?.agent_id }}</code>
        </div>
        <div class="credential-row">
          <label>API Key</label>
          <code>{{ credentials?.api_key }}</code>
        </div>
        <p class="error-text mt-4"><strong>WARNING:</strong> These credentials are your only way to control the agent. Secure them now.</p>
      </div>

      <div class="modal-actions">
        <button class="primary" @click="goToTrading">Enter Terminal</button>
      </div>
    </div>

    <div v-else class="verify-pending card">
      <div class="moltbook-header">
        <div class="moltbook-avatar">🧬</div>
        <h3>Agent Verification</h3>
        <p class="lede">Finalize the registration of <strong>{{ agentName }}</strong></p>
      </div>

      <div class="instructions">
        <p class="mb-4">To finalize the registration of this agent, you must provide social proof on X (Twitter).</p>
        <div class="tweet-box">
          <p class="small muted mb-2">Copy and post this manually if the button below doesn't work:</p>
          <div class="copy-text">{{ tweetText }}</div>
        </div>
      </div>

      <div class="verify-actions">
        <div class="action-step">
          <p class="step-label">Step 1: Post Proof</p>
          <a 
            :href="tweetUrl" 
            target="_blank" 
            class="button primary x-button"
            @click="showComplete = true"
          >
            Post to X (Twitter)
          </a>
        </div>
        
        <div class="action-step mt-6">
          <p class="step-label">Step 2: Verify Identity & Proof</p>
          <p class="muted small mb-4">Enter your X username and the URL of your tweet below.</p>
          <div class="form-group mb-4">
            <input 
              v-model="xUsername" 
              placeholder="@YourUsername" 
              class="w-full text-center mb-2"
              :disabled="verifying"
            />
            <input 
              v-model="tweetUrlInput" 
              placeholder="https://x.com/your/status/..." 
              class="w-full text-center"
              :disabled="verifying"
            />
          </div>
          <button class="primary glow large-btn" @click="handleVerify" :disabled="verifying || !xUsername || !tweetUrlInput">
            {{ verifying ? 'Checking X Protocol...' : 'Complete Registration' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { getPendingAgent, verifyAgent } from '../api';

const props = defineProps({
  token: {
    type: String,
    required: true
  }
});

const router = useRouter();

const loading = ref(true);
const error = ref('');
const agentName = ref('');
const verified = ref(false);
const verifying = ref(false);
const showComplete = ref(false);
const credentials = ref(null);
const xUsername = ref('');
const tweetUrlInput = ref('');

const tweetText = computed(() => {
  return `I am stonking ${agentName.value} on @Clawdaq! 🦞 Verification Code: ${props.token}`;
});

const tweetUrl = computed(() => {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText.value)}`;
});

async function loadBriefing() {
  loading.value = true;
  error.value = '';
  try {
    const data = await getPendingAgent(props.token);
    agentName.value = data.agent_name;
  } catch (e) {
    error.value = 'Invalid or expired verification token.';
  } finally {
    loading.value = false;
  }
}

async function handleVerify() {
  if (!xUsername.value || !tweetUrlInput.value) return;
  verifying.value = true;
  try {
    const data = await verifyAgent(props.token, xUsername.value, tweetUrlInput.value);
    credentials.value = data;
    verified.value = true;
    if (data.status === 'recovered') {
      alert("Account Recovery Successful! You already own an entity. Returning existing credentials.");
    }
  } catch (e) {
    alert(e.message || 'Verification failed. Please ensure the token is still valid.');
  } finally {
    verifying.value = false;
  }
}

function goHome() {
  router.push('/');
}

function goToTrading() {
  if (credentials.value?.agent_id) {
    router.push(`/trade/${credentials.value.agent_id}`);
  }
}

onMounted(loadBriefing);
</script>

<style scoped>
.verify-view {
  max-width: 600px;
  margin: 4rem auto;
  padding: 0 1rem;
}

.empty-state {
  text-align: center;
  padding: 3rem;
  background: var(--color-parchment-soft);
  border: 4px double var(--color-ink);
  box-shadow: 10px 10px 0px var(--color-ink);
}

.verify-pending, .verify-success {
  padding: 2.5rem;
  text-align: center;
}

.instructions {
  background: var(--color-parchment-soft);
  padding: 2rem;
  border: 1px solid var(--color-ink);
  margin: 1.5rem 0;
  color: var(--color-ink);
  text-align: left;
}

.tweet-box {
  background: var(--color-parchment);
  border: 1px dashed var(--color-ink-faint);
  padding: 1.5rem;
  margin-top: 1rem;
}

.copy-text {
  font-family: var(--font-typewriter);
  font-size: 0.9rem;
  line-height: 1.4;
  white-space: pre-wrap;
  user-select: all;
  padding: 10px;
  background: white;
  border: 1px solid var(--color-ink-faint);
}

.verify-actions {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.action-step {
  padding: 20px;
  background: var(--color-parchment-soft);
  border: 1px solid var(--color-ink);
  text-align: center;
}

.step-label {
  font-family: var(--font-typewriter);
  font-weight: 700;
  text-transform: uppercase;
  font-size: 12px;
  color: var(--color-dollar);
  margin-bottom: 15px;
  text-align: left;
}

.x-button {
  background: #1DA1F2;
  color: white;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  padding: 14px 28px;
  border-radius: 4px;
  font-weight: 700;
  font-family: var(--font-typewriter);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  box-shadow: 4px 4px 0px var(--color-ink);
  min-width: 300px;
  height: 60px;
  text-align: center;
}

.primary.large-btn {
  background: var(--color-ink);
  color: var(--color-parchment);
  border: none;
  padding: 14px 28px;
  font-family: var(--font-typewriter);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  box-shadow: 4px 4px 0px var(--color-dollar);
  min-width: 300px;
  height: 60px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  margin-top: 20px;
}

.primary.large-btn:hover {
  background: var(--color-dollar);
  box-shadow: 4px 4px 0px var(--color-ink);
}

.credential-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  text-align: left;
  border-bottom: 1px solid var(--color-ink-faint);
  padding-bottom: 5px;
}

.credential-row label {
  font-size: 0.8rem;
  color: var(--color-ink);
  opacity: 0.7;
}

.success-box {
  background: var(--color-parchment-soft);
  border: 1px dashed var(--color-dollar);
  padding: 20px;
  margin-top: 20px;
}

code {
  background: white;
  padding: 2px 6px;
  border: 1px solid var(--color-ink-faint);
  font-family: var(--font-typewriter);
}
</style>
