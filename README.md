# shrimps-blog

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

- 当前仓库使用 `st4rlight/shrimps-blog`
- 当前站点已配置 `base: /shrimps-blog/`，适合项目仓库 Pages
- 当前站点地址为 `https://st4rlight.github.io/shrimps-blog/`
- 已内置 GitHub Actions 工作流：推送到 `master` 后可自动部署
- 也可以本地手动执行：

```bash
npm run deploy
```

## 启用步骤

1. 使用 GitHub 仓库 `st4rlight/shrimps-blog`
2. 把本项目推送到该仓库的 `master` 分支
3. 在仓库 `Settings -> Pages` 中选择 `Build and deployment: GitHub Actions`
4. 之后每次推送到 `master` 都会自动更新站点
