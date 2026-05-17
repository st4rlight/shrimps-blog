import { viteBundler } from '@vuepress/bundler-vite'
import { defineUserConfig } from 'vuepress'
import { plumeTheme } from 'vuepress-theme-plume'

export default defineUserConfig({
  base: '/shrimps-blog/',
  lang: 'zh-CN',
  title: 'st4rlight',
  description: '记录技术、想法与生活碎片',
  head: [['meta', { name: 'theme-color', content: '#8b5cf6' }]],
  bundler: viteBundler(),
  theme: plumeTheme({
    hostname: 'https://st4rlight.github.io/shrimps-blog',
    logo: '/logo.svg',
    appearance: false,
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
      { text: 'AI学习', link: '/claude-code-analysis/' },
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
      {
        type: 'doc',
        dir: 'claude-code-analysis',
        title: 'AI学习',
        sidebar: [
          {
            text: 'ClaudeCode分析',
            link: '/claude-code-analysis/',
            collapsed: false,
            items: [
              'context-compression-and-cache-analysis.md',
            ],
          },
        ],
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
