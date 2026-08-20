---
name: gary-x-post-crawler
description: 使用 Playwright 从指定 X/Twitter 博主的主页或搜索时间线获取帖子，支持样本抓取、按北京日期窗口持续滚动、多个已授权 storage state 轮换、断点合并、增量水位线和严格原帖校验，并输出 CSV/JSON。用户要求“抓取某个 X 博主帖子”“按日期持续爬 X”“轮换两个 cookie/登录态”“增量获取 X 帖子”或只想把 X 帖子导出为结构化数据时使用。
---

# X 博主帖子抓取

只负责把指定博主的帖子获取并校验成结构化数据，不做热帖分析、图片下载、改写或发布。需要分析结果时，把最终 CSV 交给 `$gary-x-analytics`。

## 边界

- 只处理用户拥有或明确获授权使用的 X 登录态与数据范围。
- 打开 X 或读取 storage state 前，确认当前任务已明确指定目标博主、日期范围和授权登录态。
- 不绕过验证码、访问控制、限流、封禁或平台安全机制；X 要求人工验证时停止并交还用户。
- 不复制其他项目的 Cookie。所有 storage state、浏览器运行时、调试截图和抓取结果都写入 Git 忽略目录。
- 默认排除回复和原生转帖；只有用户明确要求诊断这些内容时才启用相应参数。
- 不使用 `--skip-original-verification` 生成下游正式输入；该参数只用于受控诊断。

## 默认路径

- Playwright 运行时：`workspace/gary-x-post-crawler/runtime/`
- 登录态：`workspace/gary-x-post-crawler/storage-states/`
- 输出：`outputs/x-post-crawler/<username>/`

## 工作流

### 1. 准备浏览器运行时

先检查本地依赖；缺少时再执行：

```bash
scripts/prepare_runtime.sh
```

该脚本会在忽略目录安装固定版本的 Playwright 和 Chromium。只查看计划时不需要安装。

### 2. 准备授权登录态

用户明确授权打开登录页并保存状态后，运行：

```bash
node scripts/save_x_storage_state.mjs \
  --runtime-dir workspace/gary-x-post-crawler/runtime \
  --storage-state workspace/gary-x-post-crawler/storage-states/primary.json
```

需要第二或更多账号/会话时，分别保存为 `secondary.json`、`third.json`。这里轮换的是完整 Playwright storage state，不是把 Cookie 值放入命令行。

### 3. 先生成抓取计划

```bash
python3 scripts/scrape_profile_time_windows.py \
  --username "<handle>" \
  --storage-state workspace/gary-x-post-crawler/storage-states/primary.json \
  --fallback-storage-state workspace/gary-x-post-crawler/storage-states/secondary.json \
  --until-local-date "<exclusive YYYY-MM-DD>" \
  --min-local-date "<YYYY-MM-DD>" \
  --plan-only
```

核对目标、起止日期、窗口天数、登录态数量、水位线来源和输出路径。`--min-local-date` 是本次显式历史边界；省略时优先使用已保存水位线，没有水位线则使用 `--initial-min-local-date`。

### 4. 执行持续抓取

确认计划后移除 `--plan-only`。默认行为：

1. 将北京日期范围切成 5 天窗口。
2. 为每个窗口构造 `from:<handle> -filter:replies since:... until:...` 的 X 最新搜索。
3. 在页面中持续滚动；连续 25 次没有发现新帖子或达到单窗口滚动上限后停止该窗口。
4. 按帖子 ID 合并已有 JSON，跨窗口去重并保留较新的帖子。
5. 默认搜索错误或空壳页时立即轮换下一份 storage state；所有状态各失败一次后才进入冷却。追踪任务如显式启用 `--accept-partial-search-errors`，可接受已经渲染出文章后的局部 UI 错误；如显式启用 `--profile-fallback-on-search-error`，还可用同一登录态的认证主页时间线做有限滚动 fallback。
6. 所有窗口成功后运行严格原帖校验，隔离回复、引用推文、其他作者和校验错误。
7. 只有覆盖完整、没有使用局部接受或主页 fallback 且严格校验成功时才原子更新水位线；fallback 结果会保留并校验，但不会伪装成完整水位线成功。

登录态轮换、日期窗口、水位线和输出协议详见 [references/crawl-protocol.md](references/crawl-protocol.md)。

### 5. 验收并交付

正式交付给分析 Skill 的 CSV 必须：

- 包含 `Post id`、`Date`、`Post text`、`Post Link`、`Impressions`。
- 包含精确的 `Published at`、每次真实看到帖子的 `Observed at` 和用于匹配的 `Media URLs`。
- 包含 `Verified author`、`In reply to status id`、`Original verification`。
- 包含 `Quoted status id`、`Is quote`；正式输入必须排除引用推文。
- 所有保留行的 `Original verification` 均为 `verified_original`。
- 有对应的 verification summary、quarantine CSV、JSONL 审计记录和水位线状态。

## 失败处理

- 任一日期窗口在全部登录态重试后仍失败：立即停止，不跳过窗口，不推进水位线。
- `--accept-partial-search-errors` 和 `--profile-fallback-on-search-error` 仅用于已明确授权的追踪任务；它们不会绕过验证码、访问控制或原创校验，并且会强制跳过水位线推进。
- 浏览器脚本异常退出：保留已写 CSV/JSON 和调试目录，报告窗口、登录态文件名与退出码。
- 原帖校验失败：保留 raw CSV 和审计记录，不把未校验 CSV 交给下游。
- 达到总条数上限且历史覆盖未完成：视为不完整，不推进水位线。

依赖、快速检查和输出文件说明见 [README.md](README.md)。
