# X profile crawl protocol

## Data flow

1. `save_x_storage_state.mjs` 在人工登录成功后保存 Playwright storage state。
2. `scrape_profile_time_windows.py` 解析日期边界、水位线和登录态集合。
3. 每个日期窗口调用 `scrape_profile_to_csv.mjs` 打开 X 最新搜索并滚动采集。
4. 低层脚本把新行与现有 seed JSON 按帖子 ID 合并，持续覆盖写 CSV/JSON。
5. 所有窗口完成后，`verify_x_original_posts.mjs` 从结构化公开数据确认作者、回复与引用字段。
6. 通过校验的行写入最终 CSV，其他行写入 quarantine；完整成功后更新水位线。

## Date windows

- 所有用户边界都按 `Asia/Shanghai` 的本地午夜解释。
- `--until-local-date` 是排他的上界；未提供时使用北京时区的明天。
- `--min-local-date` 优先级最高，用于显式历史抓取。
- 没有显式下界时，使用水位线 `last_successful_until_local_date`；首次运行使用 `--initial-min-local-date`。
- X 搜索的日期操作符按 UTC 日期工作。每个北京日期窗口会向外扩到包含它的完整 UTC 日期，重叠行由帖子 ID 去重。
- 默认窗口为 5 天，可通过 `--window-days` 调整。

## Browser scrolling

- 每次打开 `f=live` 最新搜索。
- 每一轮读取页面中全部 `article`，以时间戳所在的 `/status/<id>` 链接识别当前帖子。
- 只收集目标作者，忽略缺少 ID 或正文的卡片。
- 每轮向下滚动 1600 像素并等待 `--wait-ms`。
- 已存在的帖子再次出现时刷新互动指标、媒体 URL 和 `Observed at`；本轮未再次看到的 seed 行保留原观测时间，不伪装成新快照。
- 遇到新页面 ID 时重置 stale 计数，即使该 ID 已存在于 seed。
- 达到 `--stop-after-stale-scrolls` 或 `--per-window-max-scrolls` 后结束当前窗口。

## Storage-state rotation

- `--storage-state` 是主状态。
- `--fallback-storage-state` 可重复传入。
- `--storage-state-dir` 可重复传入，读取其中所有 `*.json`。
- 路径去重后形成有序集合。第 `window_index` 个窗口从对应偏移状态开始，重试时 round-robin。
- X 明确报错、空白壳页或搜索时间线未加载时，立即换下一状态。
- 所有状态各尝试一次后才等待 `--error-sleep-seconds`，然后进入下一轮。
- 登录态轮换只用于覆盖和恢复，不得降低严格原帖校验标准。

## Original-post gate

搜索过滤器和作者页面不是最终证据。每行必须通过结构化校验：

- 返回作者与目标 handle 大小写不敏感一致。
- `in_reply_to_status_id_str` 为空。
- 不一致作者进入 `foreign_author`。
- 非空回复目标进入 `reply`。
- 结构化引用目标或页面引用卡片进入 `quote`。
- 空响应、HTTP 错误或解析错误进入 `verification_error`。

校验失败时 fail closed，不能把该行当作原创内容。

## Watermark

默认文件为 `<output-dir>/<username>_crawl_watermark.json`。

- 边界语义：排他的北京本地日期。
- `--watermark-overlap-days` 可向前重叠复查延迟索引内容。
- 显式 `--min-local-date` 不依赖水位线；`--ignore-watermark` 回到初始边界。
- 只有全部日期窗口完成、没有提前因总条数上限停止、且严格原帖校验成功时才推进。
- 回复/转帖诊断模式或 `--skip-original-verification` 模式永不推进。
- 使用临时文件替换的方式原子写入，并保留最近 20 次成功运行记录。

## Outputs

以默认 `limit=20000` 为例：

- `<username>_profile_posts_20000.csv`：严格校验后的正式输入；排除回复、引用推文和其他作者。
- CSV 中 `Published at` 保留 X 的精确发布时间，`Observed at` 表示当次确实观测到该帖子的时间，`Media URLs` 是 JSON 数组。
- `<username>_profile_posts_20000.raw.csv`：校验前快照。
- `<username>_profile_posts_20000.json`：滚动采集 seed 与断点数据。
- `<username>_profile_posts_20000.quarantine.csv`：回复、其他作者和校验错误。
- `<username>_profile_posts_20000.verification.jsonl`：逐帖审计账本。
- `<username>_profile_posts_20000.verification_summary.json`：校验汇总。
- `<username>_crawl_watermark.json`：增量边界与历史。
- `debug_time_windows/`：各日期窗口的页面信息与调试截图。
