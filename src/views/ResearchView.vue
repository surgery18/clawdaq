<template>
  <div class="research-view">
    <header class="research-header">
      <button class="back-btn" @click="router.push('/')">◂ Back to Tank</button>
      <h1 class="title">Stonk Research Lab 🔬</h1>
      <p class="subtitle">Dr. Zoidberg's Cutting-Edge Market Analysis</p>
    </header>

    <div class="search-container">
      <input 
        v-model="symbol" 
        @keyup.enter="fetchData" 
        placeholder="Enter Ticker (e.g. TIRX, DJT)" 
        class="symbol-input"
      />
      <button @click="fetchData" class="search-btn">Scuttle!</button>
    </div>

    <div v-if="loading" class="loading-state">
      <p>Consulting the ancient scrolls... (Fetching data)</p>
    </div>

    <div v-else-if="error" class="error-state">
      <p>{{ error }}</p>
    </div>

    <!-- TradingView Widget Container -->
    <div v-show="activeSymbol" class="chart-wrapper">
      <div id="tradingview-widget"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const symbol = ref('');
const activeSymbol = ref('');
const loading = ref(false);
const error = ref(null);

async function fetchData() {
  if (!symbol.value) return;
  const target = symbol.value.toUpperCase();
  activeSymbol.value = target;
  loadChart(target);
}

function loadChart(sym) {
  const initWidget = () => {
    if (window.TradingView) {
      const widgetContainer = document.getElementById('tradingview-widget');
      if (widgetContainer) widgetContainer.innerHTML = '';
      new window.TradingView.widget({
        width: '100%',
        height: 700, // Reduced height back to something more reasonable
        symbol: sym,
        interval: 'D',
        timezone: 'America/Chicago',
        theme: 'light',
        style: '1',
        locale: 'en',
        toolbar_bg: '#fcf5e5',
        enable_publishing: false,
        hide_side_toolbar: false,
        allow_symbol_change: true,
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
    const existingScript = document.querySelector('script[src="https://s3.tradingview.com/tv.js"]');
    if (existingScript) {
      existingScript.addEventListener('load', initWidget);
    } else {
      const script = document.createElement('script');
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    }
  }
}
</script>

<style scoped>
.research-view {
  max-width: 100%; /* Full width for the layout */
  margin: 0;
  padding: 40px;
  min-height: 100vh;
  font-family: 'Courier New', Courier, monospace;
  color: #333;
}

.research-header {
  text-align: center;
  margin-bottom: 40px;
}

.title { font-size: 3rem; margin: 0; text-transform: uppercase; }
.subtitle { opacity: 0.7; font-style: italic; }

.back-btn {
  background: #333;
  color: #fffaf4;
  border: none;
  padding: 8px 16px;
  cursor: pointer;
  margin-bottom: 20px;
  box-shadow: 4px 4px 0px #2e7d32;
  font-family: inherit;
}

.search-container {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 40px;
}

.symbol-input {
  padding: 12px 20px;
  font-size: 1.2rem;
  border: 3px solid #333;
  background: #fff;
  width: 300px;
  font-family: inherit;
}

.search-btn {
  padding: 12px 30px;
  font-size: 1.2rem;
  background: #2e7d32;
  color: #fff;
  border: 3px solid #333;
  cursor: pointer;
  box-shadow: 4px 4px 0px #333;
  font-family: inherit;
}

.search-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 2px 2px 0px #333;
}

.chart-wrapper {
  background: #fffaf4;
  border: 3px solid #333;
  padding: 10px;
  box-shadow: 10px 10px 0px #333;
  margin-bottom: 40px;
  min-height: 700px; /* Match reduced height */
}

#tradingview-widget {
  width: 100%;
  height: 700px;
}

.loading-state, .error-state {
  text-align: center;
  padding: 40px;
  font-size: 1.2rem;
}

.error-state { color: #b71c1c; }
</style>
