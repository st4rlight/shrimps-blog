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
      description: '所有事与愿违都是另有安排',
      circle: true,
      layout: 'right',
    },
    social: [
      { icon: 'github', link: 'https://github.com/st4rlight' },
    ],
    navbar: [
      { text: '首页', link: '/', icon: 'mdi:home' },
      { text: '时间轴', link: '/changelog/', icon: 'mdi:timeline-clock-outline' },
      { text: '博客', link: '/blog/', icon: 'mdi:post-outline' },
      { text: '思考领悟', link: '/thoughts/', icon: 'mdi:lightbulb-outline' },
      { text: 'AI学习', link: '/ai-study/', icon: 'mdi:robot-outline' },
      { text: '拾遗补阙', link: '/notes/', icon: 'mdi:puzzle-outline' },
      { text: '归档', link: '/blog/archives/', icon: 'mdi:archive-outline' },
      { text: '标签', link: '/blog/tags/', icon: 'mdi:tag-outline' },
      { text: '关于', link: '/about/', icon: 'mdi:account-outline' },
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
            text: 'ClaudeCode分析',
            link: '/ai-study/',
            collapsed: false,
            items: [
              'claude-code/context-compression-and-cache-analysis.md',
              'claude-code/system-prompt-and-injection-analysis.md',
            ],
          },
          {
            text: 'SDD规范驱动开发',
            link: '/ai-study/',
            collapsed: false,
            items: [
              'sdd/openspec-guide.md',
              'sdd/superpowers-guide.md',
            ],
          },
          {
            text: 'Harness',
            link: '/ai-study/',
            collapsed: false,
            items: [
              'harness/dewu-harness-practice.md',
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
          {
            text: 'DeepAgents源码分析',
            link: '/ai-study/',
            collapsed: false,
            items: [
              'deep-agents/deep-agents-overview.md',
            ],
          },
        ],
      },
      {
        type: 'doc',
        dir: 'notes',
        title: '拾遗补阙',
        sidebar: [
          {
            text: 'Java拾遗',
            link: '/notes/',
            collapsed: false,
            items: [
              'java-pickup/java-thread-synchronization.md',
            ],
          },
          {
            text: '离线数仓建设',
            link: '/notes/',
            collapsed: false,
            items: [
              'data-warehouse/warehouse-table-paradigm-and-layering.md',
              'data-warehouse/mysql2hive-sync-principle.md',
            ],
          },
          {
            text: '数据库技术',
            link: '/notes/',
            collapsed: false,
            items: [
              'database/database-normal-forms.md',
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
