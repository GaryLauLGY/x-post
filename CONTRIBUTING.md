# Contributing to x-post

感谢参与 星际留白推文卡片工具。仓库接受前端交互、视觉图层、响应式布局、背景素材、测试和文档改进。

## 开发流程

1. Fork 仓库，从最新 `main` 创建功能分支。
2. 使用 Node.js 22+ 和仓库声明的 pnpm 版本安装依赖：`pnpm install --frozen-lockfile`。
3. 只修改当前需求所需的文件，不提交构建产物、运行数据或本地配置。
4. 运行 `pnpm lint`、`pnpm api:build`、`pnpm test` 和 `pnpm test:server`。
5. 推送功能分支并创建 Pull Request，说明改动、验证方法和用户可见影响。

## 前端协作范围

常见前端改动位于：

- `app/page.tsx`、`app/globals.css` 和前端组件。
- `public/backgrounds/`、`public/avatars/`、`public/brand/` 等公开资源。
- `tests/rendered-html.test.mjs` 及相关前端测试。

涉及以下区域的 Pull Request 需要仓库维护者专门审核：

- `worker/`、`wrangler.jsonc` 和 `.github/workflows/`。
- `apps/api/`、`packages/database/`、`deploy/`、`scripts/` 和 `app/admin/`。
- 身份验证、权限、数据库迁移、crawler 或生产部署配置。

协作者不需要生产数据库、mini PC SSH、Cloudflare、管理员账号或任何密钥。生产只读数据通过同源 `/api/v1/*` 载入；写入和管理操作仍由服务端认证保护。

## 背景与视觉素材

- 优先提交仓库内同源图片，不依赖可能失效或阻止 Canvas 导出的第三方图片 URL。
- 文件名使用稳定、易读的小写英文和连字符；避免提交重复或超大文件。
- 在 `docs/背景素材来源.md` 记录来源、作者、许可和用途。只提交明确允许项目使用和再分发的素材。
- Pull Request 中提供卡片预览；涉及布局或手势时同时提供桌面端与移动端验证。

## 安全边界

不得提交 `.env`、Cookie、storage state、数据库导出、备份、日志、crawler 运行产物、管理员密码、Token 或私有路径。完整边界见 [docs/public-repository-boundary.md](./docs/public-repository-boundary.md)。

Fork Pull Request 的自动化不会获得仓库或生产环境密钥。不要为了预览改动而放宽 Origin、CSRF、Cookie 或管理员认证策略。

## 合并与发布

`main` 通过分支保护接收 Pull Request。CI 通过和代码审核完成后，由维护者合并并执行 Cloudflare Worker 发布；普通前端改动不会修改 mini PC 数据库或 crawler。
