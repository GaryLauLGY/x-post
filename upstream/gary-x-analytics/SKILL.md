---
name: gary-x-analytics
description: 分析用户自己的 X/Twitter Analytics CSV 或由 gary-x-post-crawler 生成的已校验帖子 CSV，按曝光阈值区分图文与纯文字，收集授权媒体、截图、生成改写任务与 Markdown 交付，并可按明确授权衔接 Typefully、飞书多维表格或 Discord。用户要求“分析 X 数据”“找 X 高曝光帖子”“做 X 热帖对照/改写/素材整理”时使用；只要求抓取博主帖子时不要使用。
---

# X 内容分析与交付

先读 [references/filter_rules.md](references/filter_rules.md)，再改变过滤、分类、原帖校验、改写或交付逻辑。

## 边界

- 只处理用户拥有、公开或明确获授权的数据与媒体。
- 默认只分析并生成本地文件，不创建 Typefully 草稿，不写飞书，不发送 Discord。
- 本 Skill 不抓取博主时间线、不保存或读取 X 登录态；需要获取帖子时改用 `$gary-x-post-crawler`。
- 不提交 CSV、Cookie、storage state、图片、截图、改写稿或运行结果。
- 所有外部发送、发布和飞书写入都要求用户在当前任务中明确指定目标与动作。

## 输出

默认根目录为 `outputs/x-analytics/<author>/`：

- 样本：`样本检查/`
- 全量：`完整采集/`
- 可见交付：`交付文档/`、`图文图片/`、`纯文字截图/`
- 中间文件、原始图片、运行时与审计记录：`工作文件/`

## 工作流

### 1. 确认输入

确认 CSV 路径、来源、目标作者、曝光阈值和样本/全量模式。

- 用户自己的官方 X Analytics 导出：明确确认来源后使用 `--trusted-official-export`。
- 博主页面抓取数据：先调用 `$gary-x-post-crawler`，只接收它严格校验后的最终 CSV。
- 没有 CSV 时停止分析，不在本 Skill 内打开 X 或读取 Cookie。

### 2. 严格原帖校验

所有爬取行必须由 `$gary-x-post-crawler` 提供以下校验字段：

- 作者必须与目标 handle 一致。
- `in_reply_to_status_id_str` 必须为空。
- 回复、引用推文、其他作者、转发来源和验证错误全部进入 quarantine。
- `Original verification` 必须为 `verified_original`；校验失败行只能留在 crawler 的 quarantine。

不得用提及符号、页面标签或文本长度代替结构化校验。

### 3. 先跑样本

除非用户明确要求跳过，先执行：

```bash
scripts/run_pipeline.sh \
  --csv "<crawler-verified.csv>" \
  --author "<handle>" \
  --min-impressions 100000 \
  --limit 3
```

用户自己的官方 Analytics 导出没有 `Original verification` 列时，在确认来源后额外添加 `--trusted-official-export`。

检查样本的分类、图片、截图和审计摘要，再将 `--limit` 改为 `0` 运行全量。

### 4. 分析、采集与合并

机械流程依次执行：

1. `analyze_csv.py`
2. `collect_image_text_http.py`
3. `screenshot_posts.mjs`
4. `merge_collection.py`
5. `validate_outputs.py`

图片只做格式归一化与元数据清理，不把处理描述为原创证明或规避平台识别。纯文字帖子才使用 Playwright 截图。

### 5. 改写与本地交付

读取 `工作文件/rewrite_tasks.json`，为每个 `post_id` 生成一个 `rewritten_text`：

- 保留事实、句序、段落和主要语气。
- 不编造信息，不添加原文没有的结论。
- 删除媒体短链。
- 仅处理用户有权复用的内容；保留来源 URL。

将结果保存为 `工作文件/rewrites.json`，再运行：

```bash
python3 scripts/build_deliverables.py \
  --collection "<工作文件>/collection_manifest.json" \
  --rewrites "<工作文件>/rewrites.json" \
  --output-dir "<运行目录>/交付文档" \
  --summary-dir "<工作文件>"
```

`create_rewrite_stub.py` 仅用于机械冒烟测试，不得作为最终交付。

### 6. 可选整理

- 纯文字分类：`classify_pure_text_screenshots.py`
- 背景素材合成：`compose_pure_text_materials.py`
- Typefully 本地清单：`build_typefully_deliverables.py`

这些步骤仍是本地写入。

### 7. 可选外部集成

仅在用户当前任务明确授权后执行：

- Typefully 草稿：`push_typefully_drafts.py`
- 飞书多维表格同步：`sync_feishu_base.py`
- 飞书到 Discord 到期发送：`push_feishu_due_to_discord.py`

先执行对应 `--dry-run`。凭据和 Base 标识通过最小范围环境变量提供，不写进仓库。发送失败时保留本地账本，不把失败记录标记为成功。

## 失败处理

- 报告失败脚本、命令、输入路径与隔离输出。
- 单帖采集或截图失败时保留其他结果。
- 改写缺失时只补缺失 `post_id`，不重跑采集。
- 输入是未校验爬取 CSV 时停止并交还 `$gary-x-post-crawler`；不要把它当作官方 Analytics 导出绕过。

依赖和迁移说明见 [README.md](README.md)。
