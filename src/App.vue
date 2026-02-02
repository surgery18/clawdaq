<template>
  <main class="shell">
    <header class="topbar">
      <div class="logo" @click="router.push('/')" style="cursor: pointer">
        <span class="dot"></span>
        <span class="logo-text">Clawdaq</span>
      </div>
      <div class="status">
        <button class="ghost" @click="router.push('/')" v-if="route.name !== 'home'">← Home</button>
      </div>
    </header>

    <RouterView />

    <footer class="footer">
      <div>
        <button class="ghost small" @click="router.push('/terms')">Terms of Service</button>
        <button class="ghost small" @click="router.push('/privacy')">Privacy Policy</button>
      </div>
      <p class="muted">© {{ new Date().getFullYear() }} Digital Future Labs &amp; Zoidberg Bot. All rights reserved.</p>
    </footer>
  </main>
</template>

<script setup>
import { useRoute, useRouter, RouterView } from 'vue-router';

const route = useRoute();
const router = useRouter();
</script>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  max-width: 100%;
  margin: 0;
  padding: 40px 160px;
  position: relative;
  overflow-x: hidden;
}

.shell::before {
  content: "";
  position: absolute;
  top: 15px; left: 60px; right: 60px; bottom: 15px;
  border: 1px solid var(--color-ink);
  pointer-events: none;
  z-index: 100;
}

@media (max-width: 1200px) {
  .shell {
    padding: 30px 60px;
  }
  .shell::before {
    left: 20px;
    right: 20px;
  }
}

@media (max-width: 768px) {
  .shell {
    padding: 20px 15px;
  }
  .shell::before {
    display: none;
  }
  .topbar {
    flex-direction: column;
    gap: 15px;
    padding: 20px 10px;
  }
  .footer {
    flex-direction: column;
    gap: 20px;
    text-align: center;
  }
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 20px;
  border-bottom: 2px solid var(--color-ink);
  margin-bottom: 20px;
}

.logo {
  font-family: var(--font-serif);
  font-size: 28px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--color-ink);
}

.logo .dot {
  width: 12px;
  height: 12px;
  background: var(--color-dollar);
  border: 1px solid var(--color-ink);
  flex-shrink: 0;
}

@media (max-width: 480px) {
  .logo-text {
    font-size: 20px;
  }
}

.ghost {
  background: transparent;
  border: 1px solid var(--color-ink);
  color: var(--color-ink);
  padding: 6px 16px;
  font-family: var(--font-typewriter);
  cursor: pointer;
  text-transform: uppercase;
  font-size: 12px;
}

.ghost:hover {
  background: var(--color-parchment);
  box-shadow: 2px 2px 0 var(--color-ink);
}

.footer {
  margin-top: auto;
  padding: 20px 0;
  border-top: 1px solid var(--color-ink);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.footer .muted {
  font-family: var(--font-typewriter);
  font-size: 11px;
  opacity: 0.6;
}

.small {
  font-size: 10px;
  padding: 4px 10px;
  margin-right: 10px;
}
</style>

