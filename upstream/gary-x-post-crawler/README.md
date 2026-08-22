# gary-x-post-crawler

从 `gary-x-analytics` 拆出的单一博主帖子获取能力。它负责授权登录态保存、浏览器滚动、按日期窗口搜索、多登录态轮换、增量水位线和严格原帖校验；不负责内容分析或发布。

## 依赖

- Python 3.10+
- Node.js 与 npm
- Playwright 及 Chromium

运行时默认安装到 `workspace/gary-x-post-crawler/runtime/`，登录态默认放在 `workspace/gary-x-post-crawler/storage-states/`，输出默认写入 `outputs/x-post-crawler/`。这些目录均被仓库忽略。

## 快速检查

以下命令不会访问 X：

```bash
scripts/prepare_runtime.sh --help
python3 scripts/scrape_profile_time_windows.py --help
node --check scripts/save_x_storage_state.mjs
node --check scripts/scrape_profile_to_csv.mjs
node --check scripts/verify_x_original_posts.mjs
python3 -m unittest discover -s tests -v
```

真实抓取会打开 X、读取用户授权的 storage state，并访问 X 搜索页与公开校验接口；执行前遵循 `SKILL.md` 的授权与计划检查。
