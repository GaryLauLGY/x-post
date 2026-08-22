# gary-x-analytics

用于消费官方 X Analytics CSV 或 `gary-x-post-crawler` 的已校验 CSV，完成热帖分类、素材整理和本地交付。博主帖子抓取、登录态轮换、日期窗口和增量水位线已经拆到独立 Skill。

## 依赖

- Python 3.10+
- Node.js 与 npm
- Pillow
- Playwright（由 `run_pipeline.sh` 安装到本次 Git 忽略的运行目录）

可选集成：

- Typefully CLI
- `lark-cli`
- Discord 推送脚本

飞书表默认使用“改写稿”字段；已有旧表可通过进程级 `X_REWRITE_FIELD` 指定原字段名。

可选集成只在用户明确授权外部写入后使用，且必须显式提供工具路径、目标和所需环境变量。

## 本地数据

默认运行结果位于 `outputs/x-analytics/`，并被 `.gitignore` 排除。

本 Skill 不保存或读取 X Cookie、Playwright storage state 和抓取水位线。相关能力由 `gary-x-post-crawler` 独立负责。

## 快速检查

```bash
scripts/run_pipeline.sh --help
python3 -m unittest discover -s tests -v
```

测试使用合成 CSV 和图片，不访问 X、不写飞书、不创建 Typefully 草稿，也不发送 Discord。
