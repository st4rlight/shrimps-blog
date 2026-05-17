import { viteBundler } from '@vuepress/bundler-vite'
import { defineUserConfig } from 'vuepress'
import { plumeTheme } from 'vuepress-theme-plume'

export default defineUserConfig({
  base: '/',
  lang: 'zh-CN',
  title: "st4rlight's blog",
  description: '记录技术、想法与生活碎片',
  head: [['meta', { name: 'theme-color', content: '#8b5cf6' }]],
  bundler: viteBundler(),
  theme: plumeTheme({
    hostname: 'https://st4rlight.github.io',
    autoFrontmatter: {
      title: true,
      createTime: true,
      permalink: true,
    },
    profile: {
      name: 'st4rlight',
      description: '在代码、灵感和日常之间持续发光',
      circle: true,
      layout: 'right',
    },
    social: [
      { icon: 'github', link: 'https://github.com/st4rlight' },
    ],
    navbar: [
      { text: '首页', link: '/' },
      { text: '博客', link: '/blog/' },
      { text: '归档', link: '/blog/archives/' },
      { text: '标签', link: '/blog/tags/' },
      { text: '关于', link: '/about/' },
    ],
    collections: [
      {
        type: 'post',
        dir: 'blog',
        title: '博客',
      },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'Powered by VuePress & vuepress-theme-plume',
      copyright: 'Copyright © 2026 st4rlight',
    },
  }),
})
