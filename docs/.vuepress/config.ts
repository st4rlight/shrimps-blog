import { viteBundler } from '@vuepress/bundler-vite'
import { defineUserConfig } from 'vuepress'
import { plumeTheme } from 'vuepress-theme-plume'

export default defineUserConfig({
  base: '/shrimps-blog/',
  lang: 'zh-CN',
  title: 'st4rlight',
  description: '记录技术、想法与生活碎片',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/shrimps-blog/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#8b5cf6' }],
  ],
  bundler: viteBundler({
    viteOptions: {
      build: {
        rolldownOptions: {
          onLog(level, log, handler) {
            // 过滤第三方库 @vueuse/core 的 PURE 注释位置警告
            if (log.code === 'INVALID_ANNOTATION') return
            handler(level, log)
          },
        },
      },
    },
  }),
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
      description: "愿你有得偿所愿的际遇，也有失而复得的幸运",
      circle: true,
      layout: 'right',
    },
    social: [
      { icon: 'github', link: 'https://github.com/st4rlight' },
    ],
    navbar: [
      { text: '首页', link: '/', icon: 'mdi:home' },
      { text: '时间轴', link: '/changelog/', icon: 'mdi:timeline-clock-outline' },
      // { text: '存卿偶寄', link: '/blog/', icon: 'mdi:feather' },
      // { text: '思考领悟', link: '/thoughts/', icon: 'mdi:lightbulb-outline' },
      { text: 'st4rlight-code', link: '/st4rlight-code/', icon: 'mdi:code-tags' },
      { text: 'AI学习', link: '/ai-study/', icon: 'mdi:robot-outline' },
      { text: 'AI源码', link: '/ai-source/', icon: 'mdi:code-braces' },
      { text: '智能客服体系', link: '/ai-cs/', icon: 'mdi:headset' },
      { text: '商业技术体系', link: '/commercial-tech/', icon: 'mdi:briefcase' },
      { text: '拾遗补阙', link: '/notes/', icon: 'mdi:puzzle-outline' },
      // { text: '归档', link: '/blog/archives/', icon: 'mdi:archive-outline' },
      // { text: '标签', link: '/blog/tags/', icon: 'mdi:tag-outline' },
      // { text: '关于', link: '/about/', icon: 'mdi:account-outline' },
    ],
    collections: [
      // {
      //   type: 'post',
      //   dir: 'blog',
      //   title: '存卿偶寄',
      // },
      {
        type: 'doc',
        dir: 'ai-cs',
        title: '智能客服体系',
        sidebar: [
          {
            text: '周边生态工具',
            link: '/ai-cs/',
            collapsed: false,
            items: [
              'ecosystem-tools/akka-introduction.md',
              'ecosystem-tools/fsm-introduction.md',
            ],
          },
          {
            text: '流程编排引擎',
            link: '/ai-cs/',
            collapsed: false,
            items: [
              'flow-orchestration/flow-orchestration-engine.md',
              'flow-orchestration/flowlong-analysis.md',
            ],
          },
          {
            text: '表达式引擎',
            link: '/ai-cs/',
            collapsed: false,
            items: [
              'expression-engine/qlexpress-study-notes.md',
            ],
          },
        ],
      },
      {
        type: 'doc',
        dir: 'commercial-tech',
        title: '商业技术体系',
        sidebar: [
          {
            text: '报表技术体系',
            link: '/commercial-tech/',
            collapsed: false,
            items: [
              'report-tech/report-middle-platform.md',
            ],
          },
          {
            text: '搜广推系统',
            link: '/commercial-tech/',
            collapsed: false,
            items: [
              'search-ads-recommend/search-ads-recommend-pipeline.md',
            ],
          },
        ],
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
              'ai-infra/loop-engineering.md',
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
            text: 'AI周边生态',
            link: '/ai-study/',
            collapsed: false,
            items: [
              'ai-ecosystem/ag-ui-study-notes.md',
              'ai-ecosystem/a2ui-study-notes.md',
              'ai-ecosystem/codegraph-introduction.md',
              'ai-ecosystem/graphrag-introduction.md',
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
      {
        type: 'doc',
        dir: 'st4rlight-code',
        title: 'st4rlight-code构建笔记',
        sidebar: [
          {
            text: '一、总览',
            link: '/st4rlight-code/',
            collapsed: false,
            items: [
              '01-project-overview.md',
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
