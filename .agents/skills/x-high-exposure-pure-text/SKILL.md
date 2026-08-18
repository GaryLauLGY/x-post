---
name: x-high-exposure-pure-text
description: 严格抓取、筛选并同步授权 X 作者的高曝光纯文字原创帖。用户要求抓取高曝光纯文字帖、刷新本项目素材库、同步 X 互动数据，或为推文卡片补充候选素材时使用。
---

# X 高曝光纯文字帖

把现有 `$gary-x-post-crawler` 与 `$gary-x-analytics` 编排成一个项目内工作流。必须保留原文段落、空行、手动换行和互动数据；不得复制或提交 Cookie、storage state。

## 边界

- 只抓取用户在当前任务明确授权的公开作者和日期范围。
- 登录态继续由 `gary-x-post-crawler` 在其 Git 忽略工作区管理；本项目只接收严格校验后的 CSV 和分析结果。
- 不绕过验证码、访问控制或限流，不使用 `--skip-original-verification`。
- 默认高曝光阈值为 `100000`，沿用 `gary-x-analytics` 的严格 `Impressions > threshold` 规则。
- 只收 `verified_original`、目标作者一致、回复目标为空、无 URL、无媒体的纯文字帖。
- 本 Skill 只生成本地数据并同步当前网页素材库，不发布、不发送消息、不部署。

## 工作流

### 1. 定位工具与状态

从项目根目录开始，优先使用相邻的 `../gary-x-skills/`。如不存在，停止并报告缺少的工具仓库，不自行安装或复制用户级 Skill。

检查以下内容，但不要输出登录态文件内容：

- `gary-x-post-crawler/SKILL.md` 与抓取协议
- `gary-x-analytics/SKILL.md` 与 `references/filter_rules.md`
- storage state 的文件名、权限、大小和修改时间
- 目标作者的水位线与最终 CSV 验证摘要

### 2. 先生成抓取计划

在 `gary-x-skills` 根目录运行 `scrape_profile_time_windows.py --plan-only`。有水位线时按水位线增量；无水位线时必须由当前任务给出首次日期范围，或明确说明采用的合理默认范围。

确认计划满足：

- `reply_mode=exclude`
- `include_reposts=false`
- `strict_original_verification=true`
- 至少一个可用 storage state

### 3. 抓取并验证

使用计划中的同一组参数执行真实抓取。不得添加 `--skip-original-verification`。若搜索窗口不完整或使用 fallback：

- 可保留已严格验证的数据；
- 必须标记覆盖不完整；
- 不得推进水位线。

接受最终 CSV 前，检查验证摘要、quarantine 数量、作者字段、回复字段和 `Original verification`。

### 4. 复用分析 Skill 筛选

对每位作者运行：

```bash
python3 gary-x-analytics/scripts/analyze_csv.py \
  --csv "<verified.csv>" \
  --output-dir "<project>/outputs/x-high-exposure-pure-text/<author>" \
  --min-impressions 100000 \
  --expected-author "<handle>"
```

只将生成的 `pure_text_candidates.json` 交给本 Skill 的确定性转换脚本：

```bash
python3 .agents/skills/x-high-exposure-pure-text/scripts/build_materials_from_candidates.py \
  --candidates "<pure_text_candidates.json>" \
  --author "<handle>" \
  --label "<网页显示作者>" \
  --min-date "<本次抓取起始日>" \
  --until-date "<本次抓取排他结束日>" \
  --output "<author>-materials.json"
```

输出结构见 [references/output-schema.md](references/output-schema.md)。

### 5. 分类并同步网页

为每个新帖子按主要复用意图指定真实类别。类别沿用网页现有分类，不得写成“纯文字”或“类别”。AI 内容优先在 `AI工具`、`AI效率`、`AI实操`、`AI世界观`、`AI认知`、`AI商业`、`AI学习` 中细分；非 AI 内容保留其真实非 AI 类别。

同步时以 X post id 去重：

- 新抓取文本和换行是正文真源；
- 新抓取互动数据覆盖旧互动数据；
- 已有人工分类优先于默认 `其他`；
- 保留原帖链接和作者。

### 6. 验证

至少验证：

- 每条记录严格原创、目标作者一致、不是回复；
- 每条正文不含 URL、媒体字段为空；
- 文本换行未被折叠；
- 浏览、回复、转推、点赞、书签均为非负整数；
- 素材候选卡显示互动数据；
- 网页构建和数据测试通过。

## 失败处理

- 登录失效、验证码或访问限制：停止该作者抓取并报告，不尝试绕过。
- 覆盖不完整：保留严格结果和原水位线，明确说明缺口。
- 分析输入缺失验证列：拒绝同步，不把爬取 CSV 冒充官方导出。
- 新帖无法可靠分类：保留在本地待审结果，不静默写入错误类别。
