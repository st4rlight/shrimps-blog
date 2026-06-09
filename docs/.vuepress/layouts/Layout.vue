<script lang="ts">
import { defineComponent, watch } from 'vue'
import { useRoute } from 'vuepress/client'
import { Layout } from 'vuepress-theme-plume/client'
import BackgroundToggle from '../components/BackgroundToggle.vue'

const STORAGE_KEY = 'shrimps-blog-bg-mode'

export default defineComponent({
  name: 'CustomLayout',
  components: { Layout, BackgroundToggle },
  setup() {
    const route = useRoute()

    function applyMode(mode: 'default' | 'multica') {
      const layout = document.querySelector('.vp-layout') as HTMLElement | null
      if (!layout) return
      if (mode === 'multica') {
        layout.classList.add('bg-multica')
        layout.classList.remove('bg-default')
      } else {
        layout.classList.remove('bg-multica')
        layout.classList.add('bg-default')
      }
    }

    // Apply saved mode on mount
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY) as 'default' | 'multica' | null
      const mode = saved === 'multica' ? 'multica' : 'default'
      applyMode(mode)
    }

    // Re-apply on route change
    watch(
      () => route.path,
      () => {
        const saved = localStorage.getItem(STORAGE_KEY) as 'default' | 'multica' | null
        const mode = saved === 'multica' ? 'multica' : 'default'
        requestAnimationFrame(() => applyMode(mode))
      },
    )
  },
})
</script>

<template>
  <Layout>
    <template #layout-bottom>
      <BackgroundToggle />
    </template>
  </Layout>
</template>
