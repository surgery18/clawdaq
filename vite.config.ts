import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

import { cloudflare } from "@cloudflare/vite-plugin"

// https://vite.dev/config/
export default defineConfig({
	appType: 'spa',
	plugins: [
		vue(),
		vueDevTools(),
		cloudflare()
	],
	server: {
		host: '0.0.0.0',
		port: 5173,
		strictPort: true,
		fs: {
			strict: false
		},
		proxy: {
			'/api': {
				target: 'http://localhost:8787',
				changeOrigin: true
			}
		}
	},
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url))
		},
	},
})
