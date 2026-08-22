#!/usr/bin/env python3
"""Analyze X analytics CSVs and classify high-impression posts without Playwright."""

from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any


URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
URL_ONLY_RE = re.compile(r"^\s*(https?://\S+|www\.\S+)\s*$", re.I)
QUOTE_HINT_RE = re.compile(r"(转发|引用|quote|quoted|RT\s*@)", re.I)
VIDEO_HINT_RE = re.compile(r"(视频|video|直播|回放|短视频|小游戏)", re.I)
DATE_FORMATS = ("%a, %b %d, %Y", "%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y")
REQUIRED_COLUMNS = ("Post id", "Date", "Post text", "Post Link", "Impressions")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", required=True, help="Path to X analytics CSV.")
    parser.add_argument("--output-dir", required=True, help="Directory for analysis outputs.")
    parser.add_argument("--min-impressions", type=int, default=100000)
    parser.add_argument(
        "--expected-author",
        default="",
        help="Optional target handle. When verification columns exist, exclude a different verified author.",
    )
    parser.add_argument(
        "--video-hint-regex",
        default=VIDEO_HINT_RE.pattern,
        help="CSV-only regex for probable video posts.",
    )
    parser.add_argument(
        "--quote-hint-regex",
        default=QUOTE_HINT_RE.pattern,
        help="CSV-only regex for probable quote posts.",
    )
    return parser.parse_args()


def parse_number(value: str | None) -> int:
    try:
        return int(float(str(value or "").replace(",", "").strip()))
    except ValueError:
        return 0


def parse_date(value: str | None) -> datetime | None:
    text = str(value or "").strip()
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def read_rows(csv_path: Path) -> list[dict[str, str]]:
    with csv_path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        missing = [col for col in REQUIRED_COLUMNS if col not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"CSV missing required columns: {', '.join(missing)}")
        return list(reader)


def classify_row(
    row: dict[str, str],
    video_re: re.Pattern[str],
    quote_re: re.Pattern[str],
    expected_author: str,
) -> tuple[str, str]:
    verification = str(row.get("Original verification") or "").strip()
    verified_author = str(row.get("Verified author") or "").strip()
    reply_to = str(row.get("In reply to status id") or "").strip()
    if verification and verification != "verified_original":
        return "excluded", f"original_verification_{verification}"
    if reply_to:
        return "excluded", "verified_reply"
    if expected_author and verified_author and verified_author.lower() != expected_author.lower().lstrip("@"):
        return "excluded", "verified_foreign_author"
    text = str(row.get("Post text") or "").strip()
    if quote_re.search(text):
        return "excluded", "quote_hint"
    if video_re.search(text):
        return "excluded", "video_hint"
    if URL_ONLY_RE.search(text):
        return "excluded", "url_only_article_or_link"
    if URL_RE.search(text):
        return "image_text", "text_with_url_media_candidate"
    return "pure_text", "no_url"


def normalize_row(
    row: dict[str, str],
    video_re: re.Pattern[str],
    quote_re: re.Pattern[str],
    expected_author: str,
) -> dict[str, Any]:
    date = parse_date(row.get("Date"))
    category, reason = classify_row(row, video_re, quote_re, expected_author)
    normalized: dict[str, Any] = dict(row)
    normalized["impressions_number"] = parse_number(row.get("Impressions"))
    normalized["date_iso"] = date.date().isoformat() if date else ""
    normalized["category"] = category
    normalized["classification_reason"] = reason
    return normalized


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    headers = [
        "Post id",
        "Date",
        "date_iso",
        "Post text",
        "Post Link",
        "Impressions",
        "impressions_number",
        "category",
        "classification_reason",
        "Verified author",
        "In reply to status id",
        "Original verification",
    ]
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    args = parse_args()
    csv_path = Path(args.csv).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    video_re = re.compile(args.video_hint_regex, re.I)
    quote_re = re.compile(args.quote_hint_regex, re.I)

    rows = [normalize_row(row, video_re, quote_re, args.expected_author) for row in read_rows(csv_path)]
    dates = [parse_date(row.get("Date")) for row in rows]
    dates = [date for date in dates if date is not None]

    high_impression = sorted(
        [row for row in rows if row["impressions_number"] > args.min_impressions],
        key=lambda row: row["impressions_number"],
        reverse=True,
    )
    image_text = [row for row in high_impression if row["category"] == "image_text"]
    pure_text = [row for row in high_impression if row["category"] == "pure_text"]
    excluded = [row for row in high_impression if row["category"] == "excluded"]

    summary = {
        "csv": str(csv_path),
        "row_count": len(rows),
        "date_min": min(dates).date().isoformat() if dates else "",
        "date_max": max(dates).date().isoformat() if dates else "",
        "min_impressions": args.min_impressions,
        "high_impression_count": len(high_impression),
        "image_text_count": len(image_text),
        "pure_text_count": len(pure_text),
        "excluded_count": len(excluded),
        "high_impression_json": str(output_dir / "high_impression_posts.json"),
        "high_impression_csv": str(output_dir / "high_impression_posts.csv"),
        "image_text_json": str(output_dir / "image_text_candidates.json"),
        "pure_text_json": str(output_dir / "pure_text_candidates.json"),
        "excluded_csv": str(output_dir / "excluded_posts.csv"),
        "classification_rule": "CSV-only: no URL=pure_text; text+URL=image_text candidate; URL-only=excluded article/link; quote/video hints excluded.",
        "original_verification_gate": "When verification columns are present: only verified_original, empty reply target, and expected author are accepted.",
    }

    (output_dir / "high_impression_posts.json").write_text(
        json.dumps(high_impression, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output_dir / "image_text_candidates.json").write_text(
        json.dumps(image_text, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output_dir / "pure_text_candidates.json").write_text(
        json.dumps(pure_text, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (output_dir / "analysis_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    write_csv(output_dir / "high_impression_posts.csv", high_impression)
    write_csv(output_dir / "image_text_candidates.csv", image_text)
    write_csv(output_dir / "pure_text_candidates.csv", pure_text)
    write_csv(output_dir / "excluded_posts.csv", excluded)

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
