# 星际留白团队推文卡片工具

一个先本地运行的团队推文素材库与卡片制作网页。当前版本用于确认产品结构和制作体验，已经打通：

- 团队推文库浏览、搜索、按作者与分类筛选、选择并跳转 X 原贴
- 生产环境从服务器 API 动态载入全部 `approved` 素材及当前已配置作者；网页不提供贴文文件导入入口，素材由受控 crawler 流程更新
- 推文来源与发布账号分离
- 仅显示当前用户可用的发布账号（原型内存权限）
- 发布账号包含黄小木、Roland.W、AI最严厉的父亲和阿川，账号切换同步名称、ID、认证状态和名称标签
- 正文编辑、使用原推、10 张城市与风景背景（4 张既有素材与 6 张 3:4 精选图）、上传/网络图片
- 同步正文保留原始段落、空行、手动换行、连续空格与标点；回复、转推、点赞、书签在源数据存在时同步
- 左侧素材候选卡直接显示浏览、回复、转推、点赞和书签数据
- 五项候选数据固定保持单行；选中素材时自动带入原始数据，也可在右侧逐项修改当前卡片数据
- 背景压暗、拖动位置，以及在卡片右下角直接等比缩放
- 内部卡片按现有 X 截图的固定字号与比例重做：省略号、常规字重正文、日期/浏览量，以及回复、转推、点赞、书签、分享五个矢量图标
- 制作器、卡片与导出 PNG 统一使用直角版式
- 海报不添加底部团队水印
- 发布文案生成、复制与 1080 × 1440 PNG 下载

## 本地运行

网页运行需要 Node.js 22+ 与 pnpm。重新生成默认素材时还需要 macOS 自带的 Swift / Vision，用于从 rwayne 的现有 X 截图读取四项互动数据。

```bash
pnpm install
pnpm dev
```

默认地址：`http://localhost:3000`

验证：

```bash
pnpm build
pnpm test
pnpm lint
pnpm data:sync
pnpm data:high-exposure
```

`pnpm data:sync` 会从相邻 `Social` 工作区中 rwayne、黄小木的两份 `collection_manifest.json` 重新生成脱敏后的既有素材，并合并四位授权作者的严格抓取结果。AI 内容细分为 `AI工具`、`AI效率`、`AI实操`、`AI世界观`、`AI认知`、`AI商业`、`AI学习`；非 AI 内容保留原分类。网页只显示每条素材的实际分类，“纯文字”和“类别”都不作为界面类别或标签。输出只包含公开正文、来源、日期、链接、分类和公开指标，不复制 Cookie、凭据或源文件绝对路径。

项目级 Skill 位于 `.agents/skills/x-high-exposure-pure-text/`。它编排相邻 `gary-x-skills` 中的严格 X 原帖抓取与高曝光纯文字筛选，保留正文排版和五项公开数据。当前四位作者按 `Impressions > 5000` 入库；`pnpm data:high-exposure` 会过滤媒体、引用、回复及被 X 拆行隐藏的链接，再按复用意图分类并合并进默认素材。

## mini PC 服务器

服务器端包含 PostgreSQL 16、Fastify API、素材幂等迁移、媒体持久化、本地管理员登录、管理后台、备份和恢复冒烟测试。API 和数据库仍只监听 mini PC 的 loopback；公开访问保持同域 `/api/*`，经 Cloudflare Tunnel 到达 mini PC。

前端托管已经决定迁出 OpenAI Sites，目标是在 Gary 自己的 Cloudflare 账户中部署 vinext Worker，继续使用 `xpost.garylau.ai`。迁移从 Mac 项目目录执行；mini PC 继续只承担 PostgreSQL、API 和 crawler。当前生产在切换完成前仍经过 Sites，不能把“已决定迁移”写成“已经迁移完成”。权威方案、切换门禁和回滚顺序见 [前端托管迁移](./docs/frontend-hosting-migration.md)。

```bash
pnpm api:build
pnpm test:server
pnpm data:migrate:dry
```

远端部署与运维命令见 [服务器部署说明](./docs/deployment.md)、[运维说明](./docs/operations.md) 和 [回滚说明](./docs/rollback.md)。管理员入口为 `/admin`，使用无公开注册入口的本地 `admin` 账号。自动抓取由 Codex 定时任务通过 SSH 调用项目入口，mini PC 不另设 systemd timer；任务复用项目内固定版本的 `gary-x-post-crawler`，严格验证通过的新素材自动写为 `approved` 并进入制作台，被人工拒绝或归档的素材不会因后续抓取而恢复，并只在完整覆盖与数据库导入同时成功后推进水位线。

## 当前边界

网页本身不读取 X Cookie、不直接连接 X、也不自动发布。生产素材、管理员认证和服务端权限由 mini PC 的 Fastify API 与 PostgreSQL 提供；当前公开页面保留制作台和推文库，管理员入口为 `/admin`。项目级 Skill 只调用已经授权的受控采集进程；Cookie / storage state 仅保留在 mini PC 的 owner-only crawler 目录，只有严格校验通过的公开素材才能写入数据库。

开发方案、数据契约、后端模型、测试清单和 App 集成路线见 [开发文档](./docs/开发文档.md)。需要交给具备服务器 SSH 权限的项目 Agent 执行时，使用 [服务器端开发与部署清单](./docs/服务器端开发与部署清单.md)。新增免费背景的来源与使用记录见 [背景素材来源](./docs/背景素材来源.md)。Research Swarm 的执行状态、已核实结论和未核实缺口见 [调研记录](./docs/调研记录.md)。

仓库可以公开源代码，但 PostgreSQL 数据、备份、crawler 登录态和运行产物永远不进入 Git。公开边界与发布前检查见 [Public repository boundary](./docs/public-repository-boundary.md)。
