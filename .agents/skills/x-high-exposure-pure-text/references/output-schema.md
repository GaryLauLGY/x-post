# 输出结构

`build_materials_from_candidates.py` 输出一个 JSON 对象，正文保留原始换行，互动数据均为非负整数。`category=其他` 只表示尚未完成语义分类；同步到网页前必须为新帖指定真实类别，已有帖子继续沿用人工分类。

```json
{
  "schema": "x-high-exposure-pure-text/v1",
  "author": "rwayne",
  "label": "Roland.W",
  "thresholdRule": "Impressions > 100000",
  "items": [
    {
      "id": "crawl-rwayne-123",
      "postId": "123",
      "text": "保留原始段落与\n手动换行",
      "source": "Roland.W",
      "date": "2026-08-18",
      "publishedAt": "2026-08-18T06:12:34.000Z",
      "observedAt": "2026-08-20T03:20:10.000Z",
      "link": "https://x.com/rwayne/status/123",
      "category": "其他",
      "tags": ["其他", "Roland.W"],
      "metrics": { "replies": 0, "reposts": 0, "likes": 0, "bookmarks": 0, "views": 100001 }
    }
  ]
}
```
