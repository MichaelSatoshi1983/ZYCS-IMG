import { createRouter, createWebHistory } from 'vue-router'
import { verifyOwnerSession } from '@/utils/supabase'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'Home',
      component: () => import('@/views/Home/Home.vue'),
    },
    {
      path: '/gallery',
      name: 'Gallery',
      component: () => import('@/views/Gallery/Gallery.vue'),
    },
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/Login/Login.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

router.beforeEach(async (to) => {
  try {
    const user = await verifyOwnerSession()
    if (user) {
      if (to.name === 'Login') {
        const next = typeof to.query.redirect === 'string' ? to.query.redirect : '/'
        return next.startsWith('/') && !next.startsWith('//') ? next : '/'
      }
      return true
    }
  } catch {
    // The login page remains available when Supabase is temporarily unreachable.
  }

  return to.name === 'Login'
    ? true
    : { name: 'Login', query: { redirect: to.fullPath } }
})

export default router
