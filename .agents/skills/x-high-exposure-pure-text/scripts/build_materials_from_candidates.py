#!/usr/bin/env python3
"""Convert gary-x-analytics pure-text candidates into app material records."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidates", required=True, help="pure_text_candidates.json from gary-x-analytics")
    parser.add_argument("--author", required=True, help="Expected X handle, with or without @")
    parser.add_argument("--label", required=True, help="Author label shown in the web app")
    parser.add_argument("--output", required=True, help="Output JSON path")
    parser.add_argument("--min-impressions", type=int, default=100000)
    parser.add_argument("--min-date", default="", help="Optional inclusive YYYY-MM-DD lower bound")
    parser.add_argument("--until-date", default="", help="Optional exclusive YYYY-MM-DD upper bound")
    return parser.parse_args()


def number(value: Any) -> int:
    try:
        return max(0, int(float(str(value or "0").replace(",", "").strip())))
    except ValueError:
        return 0


def normalized_date(row: dict[str, Any]) -> str:
    value = str(row.get("Published at") or row.get("date_iso") or row.get("Date") or "").strip()
    match = re.match(r"^(\d{4}-\d{2}-\d{2})", value)
    return match.group(1) if match else value


def media_is_empty(value: Any) -> bool:
    return str(value or "").strip().lower() in {"", "[]", "null", "none"}


def main() -> None:
    args = parse_args()
    candidate_path = Path(args.candidates).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    expected_author = args.author.lower().lstrip("@")
    rows = json.loads(candidate_path.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise SystemExit("Candidates JSON must contain a list")

    items_by_id: dict[str, dict[str, Any]] = {}
    rejected: dict[str, int] = {}

    def reject(reason: str) -> None:
        rejected[reason] = rejected.get(reason, 0) + 1

    for row in rows:
        post_id = str(row.get("Post id") or "").strip()
        text = str(row.get("Post text") or "").replace("\r\n", "\n").replace("\r", "\n")
        verified_author = str(row.get("Verified author") or "").lower().lstrip("@").strip()
        impressions = number(row.get("Impressions") or row.get("impressions_number"))
        date = normalized_date(row)
        if not post_id:
            reject("missing_post_id")
        elif row.get("category") != "pure_text":
            reject("not_pure_text")
        elif str(row.get("Original verification") or "").strip() != "verified_original":
            reject("not_verified_original")
        elif verified_author != expected_author:
            reject("foreign_author")
        elif str(row.get("In reply to status id") or "").strip():
            reject("reply")
        elif impressions <= args.min_impressions:
            reject("below_threshold")
        elif args.min_date and (not date or date < args.min_date):
            reject("before_min_date")
        elif args.until_date and (not date or date >= args.until_date):
            reject("at_or_after_until_date")
        elif not text.strip():
            reject("empty_text")
        elif URL_RE.search(text):
            reject("text_contains_url")
        elif not media_is_empty(row.get("Media URLs")):
            reject("has_media")
        else:
            item = {
                "id": f"crawl-{expected_author}-{post_id}",
                "postId": post_id,
                "text": text,
                "source": args.label,
                "date": date,
                "publishedAt": str(row.get("Published at") or "").strip(),
                "observedAt": str(row.get("Observed at") or "").strip(),
                "link": str(row.get("Post Link") or f"https://x.com/{expected_author}/status/{post_id}"),
                "category": "其他",
                "tags": ["其他", args.label],
                "note": "严格抓取的高曝光纯文字原创帖；同步前需确认语义分类",
                "metrics": {
                    "replies": number(row.get("Replies")),
                    "reposts": number(row.get("Reposts")),
                    "likes": number(row.get("Likes")),
                    "bookmarks": number(row.get("Bookmarks")),
                    "views": impressions,
                },
            }
            previous = items_by_id.get(post_id)
            if previous is None or item["metrics"]["views"] >= previous["metrics"]["views"]:
                items_by_id[post_id] = item

    items = sorted(items_by_id.values(), key=lambda item: (-item["metrics"]["views"], item["postId"]))
    payload = {
        "schema": "x-high-exposure-pure-text/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "author": expected_author,
        "label": args.label,
        "sourceCandidates": str(candidate_path),
        "thresholdRule": f"Impressions > {args.min_impressions}",
        "items": items,
        "rejected": rejected,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output_path), "items": len(items), "rejected": rejected}, ensure_ascii=False))


if __name__ == "__main__":
    main()
