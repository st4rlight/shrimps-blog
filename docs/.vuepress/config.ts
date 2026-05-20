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
      description: "平安.健康.自律.快樂.長久(●'◡'●)",
      circle: true,
      layout: 'right',
    },
    social: [
      { icon: 'github', link: 'https://github.com/st4rlight' },
    ],
    navbar: [
      { text: '首页', link: '/' },
      { text: '博客', link: '/blog/' },
      { text: 'AI学习', link: '/ai-study/' },
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
        dir: 'ai-study',
        title: 'AI学习',
        sidebar: [
          {
            text: 'Claude Code',
            link: '/ai-study/',
            collapsed: false,
            items: [
              'claude-code/context-compression-and-cache-analysis.md',
            ],
          },
          {
            text: 'Superpowers',
            link: '/ai-study/',
            collapsed: false,
            items: [
              'superpowers/superpowers-guide.md',
            ],
          },
          {
            text: 'RAG技术学习',
            link: '/ai-study/',
            collapsed: false,
            items: [
              'rag/taotian-rag-solution.md',
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
