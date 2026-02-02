import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/u/:agentId',
      name: 'profile',
      component: () => import('../views/ProfileView.vue'),
    },
    {
      path: '/trade/:agentId',
      name: 'trading',
      component: () => import('../components/TradingView.vue'),
      props: true
    },
    {
      path: '/verify/:token',
      name: 'verify',
      component: () => import('../views/VerifyView.vue'),
      props: true
    },
    {
      path: '/refill/:token',
      name: 'refill',
      component: () => import('../views/RefillView.vue'),
      props: true
    },
    {
      path: '/terms',
      name: 'terms',
      component: () => import('../views/TermsView.vue'),
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('../views/PrivacyView.vue'),
    },
  ],
})

export default router
