<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const STORAGE_KEY = 'shrimps-blog-bg-mode'
type BgMode = 'default' | 'multica'

const currentMode = ref<BgMode>('default')

function applyMode(mode: BgMode) {
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

function toggleBg() {
  const next: BgMode = currentMode.value === 'default' ? 'multica' : 'default'
  currentMode.value = next
  localStorage.setItem(STORAGE_KEY, next)
  applyMode(next)
}

onMounted(() => {
  const saved = localStorage.getItem(STORAGE_KEY) as BgMode | null
  if (saved === 'multica' || saved === 'default') {
    currentMode.value = saved
  }
  applyMode(currentMode.value)
})

onBeforeUnmount(() => {
  // cleanup not needed
})
</script>

<template>
  <button
    class="bg-toggle-btn"
    :class="{ 'bg-toggle-btn--multica': currentMode === 'multica' }"
    :title="currentMode === 'default' ? '切换到 Multica 背景' : '切换回默认背景'"
    @click="toggleBg"
  >
    <svg
      v-if="currentMode === 'default'"
      class="bg-toggle-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
    <svg
      v-else
      class="bg-toggle-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  </button>
</template>

<style scoped>
.bg-toggle-btn {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1px solid rgb(148 163 184 / 18%);
  border-radius: 50%;
  background: rgb(255 255 255 / 75%);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 16px rgb(15 23 42 / 10%);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: #64748b;
}

.bg-toggle-btn:hover {
  transform: scale(1.08);
  box-shadow: 0 6px 20px rgb(15 23 42 / 14%);
  border-color: rgb(139 92 246 / 30%);
  color: #8b5cf6;
}

.bg-toggle-btn:active {
  transform: scale(0.96);
}

.bg-toggle-btn--multica {
  background: rgb(139 92 246 / 12%);
  border-color: rgb(139 92 246 / 24%);
  color: #8b5cf6;
}

.bg-toggle-btn--multica:hover {
  border-color: rgb(139 92 246 / 40%);
  color: #7c3aed;
  box-shadow: 0 6px 20px rgb(139 92 246 / 12%);
}

.bg-toggle-icon {
  width: 20px;
  height: 20px;
}

@media (max-width: 768px) {
  .bg-toggle-btn {
    bottom: 16px;
    right: 16px;
    width: 40px;
    height: 40px;
  }

  .bg-toggle-icon {
    width: 18px;
    height: 18px;
  }
}
</style>
