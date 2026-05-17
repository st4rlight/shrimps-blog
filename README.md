# st4rlight.github.io

基于 `VuePress 2` 和 `vuepress-theme-plume` 的个人博客。

## 本地开发

```bash
npm install
npm run docs:dev
```

## 构建

```bash
npm run docs:build
```

## GitHub Pages

- 用户主页仓库使用 `st4rlight.github.io`
- 当前站点已配置 `base: /`，适合用户主页仓库
- 当前站点地址为 `https://st4rlight.github.io`
- 已内置 GitHub Actions 工作流：推送到 `main` 后可自动部署
- 也可以本地手动执行：

```bash
npm run deploy
```

## 启用步骤

1. 在 GitHub 创建 `st4rlight.github.io` 仓库
2. 把本项目推送到该仓库的 `main` 分支
3. 在仓库 `Settings -> Pages` 中选择 `Build and deployment: GitHub Actions`
4. 之后每次推送到 `main` 都会自动更新站点
