<script lang="ts">
import { defineComponent } from 'vue'
import { Layout } from 'vuepress-theme-plume/client'

export default defineComponent({
  name: 'CustomLayout',
  components: { Layout },
})
</script>

<template>
  <Layout />
</template>
