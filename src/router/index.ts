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
      path: '/stonkers',
      name: 'directory',
      component: () => import('../views/DirectoryView.vue')
    },
    {
      path: '/shame',
      name: 'shame',
      component: () => import('../views/ShameView.vue')
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
    {
      path: '/research',
      name: 'research',
      component: () => import('../views/ResearchView.vue'),
    },
  ],
})

export default router
