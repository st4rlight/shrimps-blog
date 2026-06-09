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
      { text: '存卿偶寄', link: '/blog/', icon: 'mdi:feather' },
      { text: '思考领悟', link: '/thoughts/', icon: 'mdi:lightbulb-outline' },
      { text: 'AI学习', link: '/ai-study/', icon: 'mdi:robot-outline' },
      { text: 'AI源码', link: '/ai-source/', icon: 'mdi:code-braces' },
      { text: '拾遗补阙', link: '/notes/', icon: 'mdi:puzzle-outline' },
      // { text: '归档', link: '/blog/archives/', icon: 'mdi:archive-outline' },
      // { text: '标签', link: '/blog/tags/', icon: 'mdi:tag-outline' },
      { text: '关于', link: '/about/', icon: 'mdi:account-outline' },
    ],
    collections: [
      {
        type: 'post',
        dir: 'blog',
        title: '存卿偶寄',
      },
      {
        type: 'doc',
        dir: 'ai-study',
        title: 'AI学习',
        sidebar: [
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
            text: 'Harness Engineering',
            link: '/ai-study/',
            collapsed: false,
            items: [
              'harness/dewu-harness-practice.md',
            ],
          },
          {
            text: 'AI Infra演进',
            link: '/ai-study/',
            collapsed: false,
            items: [
              'ai-infra/anthropic-managed-agents.md',
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
      {
        type: 'doc',
        dir: 'ai-source',
        title: 'AI源码',
        sidebar: [
          {
            text: 'ClaudeCode源码分析',
            link: '/ai-source/',
            collapsed: false,
            items: [
              'claude-code/context-compression-and-cache-analysis.md',
              'claude-code/system-prompt-and-injection-analysis.md',
            ],
          },
          {
            text: 'DeepAgents源码分析',
            link: '/ai-source/',
            collapsed: false,
            items: [
              'deep-agents/deep-agents-overview.md',
            ],
          },
          {
            text: 'OpenClaw源码分析',
            link: '/ai-source/',
            collapsed: false,
            items: [
              'open-claw/open-claw-overview.md',
              'open-claw/openclaw-architecture-analysis.md',
              'open-claw/openclaw-cli-startup-architecture.md',
              'open-claw/openclaw-plugin-skill-architecture.md',
              'open-claw/openclaw-gateway-architecture.md',
              'open-claw/openclaw-agent-session-architecture.md',
              'open-claw/openclaw-context-engine-architecture.md',
              'open-claw/openclaw-channel-architecture.md',
              'open-claw/openclaw-node-device-architecture.md',
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
