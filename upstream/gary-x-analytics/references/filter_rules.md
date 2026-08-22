# Hot Post Processing Rules

## Fixed Loop

1. Analyze a user-confirmed official Analytics CSV directly, or consume the verified CSV produced by `$gary-x-post-crawler`.
2. Crawler data must already contain the strict original-post fields. Accept only target-author, non-reply, non-quote rows whose `Original verification` is `verified_original`; crawler quarantine remains outside this analysis workflow.
3. Analyze the verified CSV and keep every row whose `Impressions` is greater than the threshold.
4. Classify posts from CSV text only.
5. Filter out URL-only article/link posts plus CSV quote/video hints.
6. Classify remaining posts:
   - `image_text`: text plus one or more X-hosted media images.
   - `pure_text`: no image, no video, no quote, no external card/link.
   - `skipped`: quote, video, external card/link, or extraction error.
7. For `image_text`, use HTTP/oEmbed/X HTML to extract original text and download images. Do not use Playwright and do not screenshot graph-text posts.
8. For `pure_text`, use Playwright only to save an article screenshot.
9. Generate `rewrite_tasks.json`.
10. Use the agent/model to write `rewrites.json`.
11. Build two Markdown documents:
   - `交付文档/图文热帖.md`: link, publish time, impressions, original copy, rewritten copy, and processed images embedded.
   - `交付文档/纯文字热帖.md`: link, publish time, impressions, original copy, rewritten copy. Do not embed screenshots.
12. For pure-text screenshots, use `classify_pure_text_screenshots.py` to generate category tasks, let an agent/model choose one category per text, then use the script to copy screenshots into `纯文字截图_按分类/<category>/`.
13. If making repost-ready screenshot materials, use `compose_pure_text_materials.py` and paste the screenshot directly on the background after proportional resize only.
14. For crawler input, require a fail-closed verification summary before Typefully delivery and exclude every quarantined row.
15. Keep each blogger under the ignored project path `outputs/x-analytics/<x-author>/`, with run outputs in `样本检查/` or `完整采集/`. Use Chinese delivery folders: `交付文档/`, `图文图片/`, `纯文字截图/`, `纯文字截图_按分类/`, `可发素材/`, and `工作文件/`.

## Input provenance gate

This Skill does not open an X profile or own browser credentials. If no CSV exists, invoke `$gary-x-post-crawler` first.

- Official X Analytics exports may omit crawler verification columns; accept them only after the user confirms the export belongs to the account in scope.
- Crawled CSVs must include `Verified author`, `In reply to status id`, `Quoted status id`, `Is quote`, and `Original verification`.
- Treat missing or non-`verified_original` crawler decisions as fail-closed. Do not re-label them from text heuristics.
- Date-window coverage, storage-state rotation, quarantine, and incremental watermark behavior belong exclusively to `$gary-x-post-crawler`.

## CSV Classification Standards

Classify using CSV fields before any page access:

- `pure_text`: `Post text` contains no URL.
- `image_text`: `Post text` contains normal text plus a URL/t.co. Treat it as an image-text candidate.
- `excluded`: `Post text` is only a URL/t.co. Treat it as article/link, including X Article cards.
- `excluded`: `Post text` matches configured quote/video hint regex.

This is intentionally CSV-only. It cannot perfectly detect every video or quoted post because the analytics CSV does not expose media type. Do not use Playwright to correct classification unless the user explicitly changes the rule.

## HTTP Image-Text Collection

For image-text candidates, fetch the post URL and parse `pbs.twimg.com/media/...` image URLs from the HTML. Use oEmbed to clean text when available. This is HTTP-only and must not launch a browser.

If media URLs cannot be resolved, keep the row in the image-text manifest with `media_status=media_unresolved` rather than falling back to Playwright.

## Image Processing

Save original downloaded media under `工作文件/image_text_images/raw/`.

Save processed media under visible `图文图片/`.

Only process media that the user owns, has permission to reuse, or that is explicitly licensed for reuse. Pillow normalization:

- preserves the full image and original visual content
- strips metadata through re-encoding
- saves normalized output as optimized progressive JPEG
- retains the source URL, author, and post ID in the manifest for authorization review and attribution

If Pillow cannot decode an image, keep the original source record and report the failure. Do not alter assets to evade platform matching or provenance systems.

## Screenshot Standard

For pure text screenshots only:

- wait after `domcontentloaded`, default 4000 ms
- wait for article images to load so the avatar is not a grey placeholder
- hide buttons whose text matches `Read .* replies`
- add left/right padding and white background
- screenshot only the first `article`
- store screenshots in visible `纯文字截图/`

## Pure-Text Category Standard

Create category decisions from the pure-text copy, not from screenshot OCR. Use the text in `pure_text_category_tasks.json`, which is generated from `collection_manifest.json` and corresponds to `纯文字截图/`.

Allowed default categories:

- `AI工具`
- `AI学习`
- `认知提升`
- `赚钱副业`
- `职场裁员`
- `社会观察`
- `平台产品`
- `生活冷知识`
- `情绪八卦`
- `其他`

Choose the category by reuse intent, not by keyword alone. For example, a post about a specific AI coding tool belongs to `AI工具`; a post about selling a document-conversion service belongs to `赚钱副业`; a post about layoffs or age pressure belongs to `职场裁员`.

Do not move original screenshots out of `纯文字截图/`. Copy or hardlink them into category folders so the original screenshot-to-MD correspondence remains intact.

## Pure-Text Material Composition

When putting pure-text screenshots onto backgrounds:

- use high-quality city/landscape backgrounds from a local background folder
- resize the screenshot proportionally only
- paste the screenshot directly; do not crop it
- do not add screenshot borders, rounded masks, shadows, source watermarks, or decorative frames
- place the screenshot in the middle-upper area, default top `y=220` on a `1080x1440` canvas

## Rewrite Rules

Do not hard-code final rewrites with scripts. The rewrite step is a model/agent step because it depends on meaning, style, and audience fit.

Only rewrite content the user owns, has permission to adapt, or may lawfully quote. Rewrite in two passes:

1. Rewrite pass: lightly rewrite the copy while preserving the original sentence pattern, paragraph breaks, line breaks, punctuation rhythm, and approximate character count.
2. Naturalness pass: review the draft for natural wording, factual consistency, and the requested personal tone without changing the structure established in pass 1.

Produce `rewrites.json` from `rewrite_tasks.json` with this shape:

```json
{
  "items": [
    {
      "post_id": "123",
      "category": "pure_text",
      "rewritten_text": "..."
    }
  ]
}
```

Rewrites should preserve useful information and the requested layout without fabricating facts. Keep source attribution and do not present another author's work as original. Add claims not present in the source only when the user explicitly asks for expansion and they can be supported.

Specific rewrite constraints:

- Keep line breaks and paragraph count the same unless the original is a single overlong line that must be split for readability.
- Keep the rewritten text roughly the same length as the original, normally within +/- 20%.
- Keep the original sentence order and rhetorical structure where possible.
- Preserve list formatting, numbering, emoji placement style, and short/long sentence rhythm.
- Remove `pic.twitter.com/...`, `t.co/...`, and bare media links from rewritten text.
- Avoid AI-style polishing: no grand summaries, no generic value judgments, no formulaic three-part expansion.
- Prefer natural spoken Chinese over mechanical compression. It is allowed to add small function words such as `在`, `花`, `想问`, `要怎么` when they make the sentence smoother and keep the original meaning.
- Preserve the original hook and intent, but make the phrase read like a person wrote it. For example:
  - `冷知识: 闲鱼3块钱可以抹掉vx的地区和性别。` -> `冷知识：在闲鱼花3块钱就能把 vx 的地区和性别抹掉。`
  - `既然语言墙通了， 问日区的兄弟们一个问题， 怎么去日本当男优？？？` -> `既然语言墙打通了，想问日区兄弟们一个问题：要怎么到日本当男优？？？`
- If these examples conflict with earlier rewrite guidance, follow these examples.

Use `create_rewrite_stub.py` only for smoke tests. Never use smoke-test rewrites for a final user deliverable.

## Failure Reporting

If `analyze_csv.py` fails, report the CSV path and missing columns or parse error.

If `collect_image_text_http.py` fails for one image-text post, keep going and write it to `工作文件/image_text_manifest.json`. If the whole script fails, report the candidates JSON path and HTTP error.

If `screenshot_posts.mjs` fails for one pure-text post, keep going and write it to `工作文件/screenshot_manifest.json`. If the whole script fails, report the pure-text candidates JSON path, runtime directory, and Playwright error.

If rewrite generation is incomplete, report missing `post_id` values and do not build final Markdown.

If `build_deliverables.py` fails, report the collection manifest path, rewrites path, and missing field.
