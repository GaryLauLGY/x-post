#!/usr/bin/env python3
"""Scrape an X profile through bounded X search date windows."""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path


BEIJING = timezone(timedelta(hours=8))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--username", required=True)
    parser.add_argument(
        "--runtime-dir",
        default="",
        help="Playwright runtime. Default: workspace/gary-x-post-crawler/runtime.",
    )
    parser.add_argument(
        "--storage-state",
        default="",
        help="Primary Playwright storage state. Default: workspace/gary-x-post-crawler/storage-states/primary.json.",
    )
    parser.add_argument(
        "--fallback-storage-state",
        action="append",
        default=[],
        help="Additional storage state to rotate through when a search window fails. Repeatable.",
    )
    parser.add_argument(
        "--storage-state-dir",
        action="append",
        default=[],
        help="Dedicated directory of additional *.json storage states. Repeatable.",
    )
    parser.add_argument(
        "--output-dir",
        default="",
        help="Output directory. Default: outputs/x-post-crawler/<username>/.",
    )
    parser.add_argument("--limit", type=int, default=20000)
    parser.add_argument("--include-replies", action="store_true", help="Include replies in addition to original posts.")
    parser.add_argument("--only-replies", action="store_true", help="Search only replies using filter:replies.")
    parser.add_argument("--include-reposts", action="store_true", help="Include native reposts. Disabled by default.")
    parser.add_argument("--until-local-date", default="", help="Exclusive Beijing date, YYYY-MM-DD. Default: tomorrow.")
    parser.add_argument(
        "--min-local-date",
        default="",
        help="Explicit stop date, YYYY-MM-DD. Overrides the saved watermark for this run.",
    )
    parser.add_argument(
        "--initial-min-local-date",
        default="2023-06-01",
        help="First-run stop date when no watermark exists. Default: 2023-06-01.",
    )
    parser.add_argument(
        "--watermark-file",
        default="",
        help="Incremental watermark JSON. Default: <output-dir>/<username>_crawl_watermark.json.",
    )
    parser.add_argument(
        "--ignore-watermark",
        action="store_true",
        help="Ignore the saved watermark and use --min-local-date or --initial-min-local-date.",
    )
    parser.add_argument(
        "--watermark-overlap-days",
        type=int,
        default=0,
        help="Re-crawl this many days before the saved watermark. Default: 0.",
    )
    parser.add_argument(
        "--plan-only",
        action="store_true",
        help="Print resolved crawl/watermark boundaries without opening X or updating state.",
    )
    parser.add_argument("--window-days", type=int, default=5)
    parser.add_argument("--per-window-max-scrolls", type=int, default=300)
    parser.add_argument("--stop-after-stale-scrolls", type=int, default=25)
    parser.add_argument("--wait-ms", type=int, default=1000)
    parser.add_argument("--retry-error-windows", type=int, default=3)
    parser.add_argument("--error-sleep-seconds", type=int, default=180)
    parser.add_argument(
        "--accept-partial-search-errors",
        action="store_true",
        help=(
            "Treat an X UI error as recoverable when the page already returned articles; "
            "keep the final verification gate but do not advance the watermark."
        ),
    )
    parser.add_argument(
        "--profile-fallback-on-search-error",
        action="store_true",
        help=(
            "After a date-search error, fall back to the authenticated profile timeline "
            "with the existing seed before failing the window."
        ),
    )
    parser.add_argument(
        "--profile-fallback-max-scrolls",
        type=int,
        default=60,
        help="Maximum profile-timeline scrolls for the search-error fallback. Default: 60.",
    )
    parser.add_argument("--script", default="", help="Path to scrape_profile_to_csv.mjs.")
    parser.add_argument("--verification-script", default="", help="Path to verify_x_original_posts.mjs.")
    parser.add_argument("--verification-concurrency", type=int, default=4)
    parser.add_argument("--verification-delay-ms", type=int, default=300)
    parser.add_argument(
        "--summary-json",
        default="",
        help="Optional path for the resolved plan or final crawl summary JSON.",
    )
    parser.add_argument(
        "--skip-original-verification",
        action="store_true",
        help="Unsafe opt-out: skip the final author/reply verification gate.",
    )
    return parser.parse_args()


def local_midnight(date_text: str) -> datetime:
    return datetime.fromisoformat(date_text).replace(tzinfo=BEIJING)


def timestamp_for_local_date(date_text: str) -> int:
    return int(local_midnight(date_text).timestamp())


def date_text(dt: datetime) -> str:
    return dt.astimezone(BEIJING).date().isoformat()


def utc_query_dates(since_dt: datetime, until_dt: datetime) -> tuple[str, str]:
    """Widen Beijing-midnight boundaries to complete UTC dates for X search."""
    since_query_date = since_dt.astimezone(timezone.utc).date().isoformat()
    until_query_date = (
        until_dt.astimezone(timezone.utc).date() + timedelta(days=1)
    ).isoformat()
    return since_query_date, until_query_date


def build_search_query(
    username: str,
    since_dt: datetime,
    until_dt: datetime,
    *,
    include_replies: bool,
    only_replies: bool,
    include_reposts: bool,
) -> str:
    since_query_date, until_query_date = utc_query_dates(since_dt, until_dt)
    if only_replies:
        reply_filter = " filter:replies"
    elif include_replies:
        reply_filter = ""
    else:
        reply_filter = " -filter:replies"
    repost_filter = " include:nativeretweets" if include_reposts else ""
    return (
        f"from:{username}{repost_filter}{reply_filter} "
        f"since:{since_query_date} until:{until_query_date}"
    )


def choose_storage_state(
    storage_states: list[Path],
    window_index: int,
    attempt: int,
) -> Path:
    """Rotate states across attempts and shift the starting state per window."""
    if not storage_states:
        raise ValueError("at least one storage state is required")
    return storage_states[(window_index + attempt) % len(storage_states)]


def load_count(path: Path) -> int:
    if not path.exists():
        return 0
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        count = data.get("count")
        if count is not None:
            return int(count)
        return len(data.get("rows") or [])
    except Exception:
        return 0


def load_csv_count(path: Path) -> int:
    if not path.exists():
        return 0
    try:
        with path.open(newline="", encoding="utf-8-sig") as f:
            return sum(1 for _ in csv.DictReader(f))
    except Exception:
        return 0


def load_csv_date_range(path: Path) -> tuple[str, str]:
    if not path.exists():
        return "", ""
    try:
        with path.open(newline="", encoding="utf-8-sig") as f:
            dates = [str(row.get("Date") or row.get("date_iso") or "")[:10] for row in csv.DictReader(f)]
        dates = sorted(value for value in dates if value)
        return (dates[0], dates[-1]) if dates else ("", "")
    except Exception:
        return "", ""


def load_watermark(path: Path, username: str) -> dict[str, object] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise SystemExit(f"Invalid watermark JSON {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit(f"Invalid watermark JSON object: {path}")
    stored_username = str(data.get("username") or "")
    if stored_username and stored_username.lower() != username.lower():
        raise SystemExit(
            f"Watermark username mismatch: expected {username}, found {stored_username} in {path}"
        )
    boundary = str(data.get("last_successful_until_local_date") or "")
    if boundary:
        try:
            local_midnight(boundary)
        except ValueError as exc:
            raise SystemExit(f"Invalid watermark date {boundary!r} in {path}") from exc
    return data


def write_watermark(path: Path, data: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def search_error(debug_dir: Path) -> bool:
    page_json = debug_dir / "profile_page.json"
    if not page_json.exists():
        return False
    try:
        data = json.loads(page_json.read_text(encoding="utf-8"))
    except Exception:
        return False
    text = str(data.get("body_text_head") or "")
    title = str(data.get("title") or "")
    articles = int(data.get("article_count") or 0)
    seen_this_run = int(data.get("seen_this_run_count") or 0)
    explicit_error = "出错了" in text or "Something went wrong" in text or "Try reloading" in text
    empty_result = any(
        marker in text
        for marker in (
            "没有找到任何结果",
            "没有搜索到任何结果",
            "没有关于\u201c",
            "No results for",
            "Try searching for something else",
        )
    )
    search_timeline_loaded = (
        "搜索时间线" in text
        or "Search timeline" in text
        or ("热门\n最新\n用户\n媒体\n列表" in text and "搜索过滤" in text)
        or ("Top\nLatest\nPeople\nMedia\nLists" in text and "Search filters" in text)
        or "搜索 / X" in title
        or "Search / X" in title
    )
    blank_shell = not empty_result and not search_timeline_loaded
    # A search can render some articles and then fail while scrolling. Treat
    # any explicit X error as a failed window; otherwise a partial page whose
    # visible rows were already present in the seed can be mistaken for a
    # successfully exhausted window and create a silent coverage gap.
    return explicit_error or (articles == 0 and seen_this_run == 0 and blank_shell)


def partial_search_error(debug_dir: Path) -> bool:
    """Return whether X errored after rendering at least one article."""
    page_json = debug_dir / "profile_page.json"
    if not page_json.exists():
        return False
    try:
        data = json.loads(page_json.read_text(encoding="utf-8"))
    except Exception:
        return False
    return search_error(debug_dir) and int(data.get("article_count") or 0) > 0


def main() -> None:
    args = parse_args()
    args.username = args.username.lstrip("@")
    if not args.username:
        raise SystemExit("--username must not be empty")
    if args.include_replies and args.only_replies:
        raise SystemExit("--include-replies and --only-replies are mutually exclusive")
    if args.watermark_overlap_days < 0:
        raise SystemExit("--watermark-overlap-days must be >= 0")
    if args.window_days < 1:
        raise SystemExit("--window-days must be >= 1")
    if args.limit < 1:
        raise SystemExit("--limit must be >= 1")
    if args.per_window_max_scrolls < 0 or args.stop_after_stale_scrolls < 1:
        raise SystemExit("scroll limits must be non-negative and stale scrolls must be >= 1")
    if args.retry_error_windows < 0 or args.error_sleep_seconds < 0 or args.profile_fallback_max_scrolls < 1:
        raise SystemExit("retry count, sleep seconds, and profile fallback scrolls must be valid")
    project_root = Path(__file__).resolve().parents[2]
    workspace_root = project_root / "workspace" / "gary-x-post-crawler"
    output_dir = (
        Path(args.output_dir).expanduser().resolve()
        if args.output_dir
        else project_root / "outputs" / "x-post-crawler" / args.username.lstrip("@").lower()
    )
    runtime_dir = (
        Path(args.runtime_dir).expanduser().resolve()
        if args.runtime_dir
        else workspace_root / "runtime"
    )
    primary_storage_state = (
        Path(args.storage_state).expanduser().resolve()
        if args.storage_state
        else workspace_root / "storage-states" / "primary.json"
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    script = (
        Path(args.script).expanduser().resolve()
        if args.script
        else Path(__file__).with_name("scrape_profile_to_csv.mjs")
    )
    verification_script = (
        Path(args.verification_script).expanduser().resolve()
        if args.verification_script
        else Path(__file__).with_name("verify_x_original_posts.mjs")
    )
    output_csv = output_dir / f"{args.username}_profile_posts_{args.limit}.csv"
    raw_output_csv = output_dir / f"{args.username}_profile_posts_{args.limit}.raw.csv"
    output_json = output_dir / f"{args.username}_profile_posts_{args.limit}.json"
    quarantine_csv = output_dir / f"{args.username}_profile_posts_{args.limit}.quarantine.csv"
    verification_audit = output_dir / f"{args.username}_profile_posts_{args.limit}.verification.jsonl"
    verification_summary = output_dir / f"{args.username}_profile_posts_{args.limit}.verification_summary.json"
    watermark_path = (
        Path(args.watermark_file).expanduser().resolve()
        if args.watermark_file
        else output_dir / f"{args.username}_crawl_watermark.json"
    )
    debug_root = output_dir / "debug_time_windows"
    debug_root.mkdir(parents=True, exist_ok=True)

    run_started_at = datetime.now(timezone.utc)
    if args.until_local_date:
        until_dt = local_midnight(args.until_local_date)
    else:
        now_bj = datetime.now(BEIJING)
        until_dt = datetime(now_bj.year, now_bj.month, now_bj.day, tzinfo=BEIJING) + timedelta(days=1)
    run_until_dt = until_dt
    saved_watermark = load_watermark(watermark_path, args.username)
    previous_boundary = str((saved_watermark or {}).get("last_successful_until_local_date") or "")
    if args.min_local_date:
        min_dt = local_midnight(args.min_local_date)
        stop_source = "explicit_min_local_date"
    elif previous_boundary and not args.ignore_watermark:
        min_dt = local_midnight(previous_boundary) - timedelta(days=args.watermark_overlap_days)
        stop_source = "saved_watermark"
    else:
        min_dt = local_midnight(args.initial_min_local_date)
        stop_source = "initial_min_local_date" if not args.ignore_watermark else "watermark_ignored"
    if min_dt > run_until_dt:
        raise SystemExit(
            f"Resolved stop date {date_text(min_dt)} is after crawl start boundary {date_text(run_until_dt)}"
        )
    incremental_mode = stop_source == "saved_watermark"
    window = timedelta(days=args.window_days)
    storage_states = [primary_storage_state]
    storage_states.extend(Path(value).expanduser().resolve() for value in args.fallback_storage_state)
    for directory in args.storage_state_dir:
        state_dir = Path(directory).expanduser().resolve()
        if not state_dir.is_dir():
            raise SystemExit(f"Storage state directory not found: {state_dir}")
        storage_states.extend(sorted(state_dir.glob("*.json")))
    storage_states = list(dict.fromkeys(storage_states))
    missing_storage_states = [str(value) for value in storage_states if not value.exists()]
    if missing_storage_states:
        raise SystemExit("Storage state files not found:\n" + "\n".join(missing_storage_states))

    plan = {
        "username": args.username,
        "runtime_dir": str(runtime_dir),
        "output_csv": str(output_csv),
        "output_json": str(output_json),
        "limit": args.limit,
        "crawl_from_local_date": date_text(run_until_dt),
        "stop_at_local_date": date_text(min_dt),
        "stop_source": stop_source,
        "watermark_file": str(watermark_path),
        "previous_watermark_local_date": previous_boundary,
        "watermark_overlap_days": args.watermark_overlap_days,
        "watermark_will_advance_to": date_text(run_until_dt),
        "window_days": args.window_days,
        "seed_count": load_count(output_json),
        "storage_state_count": len(storage_states),
        "storage_state_files": [value.name for value in storage_states],
        "reply_mode": "only" if args.only_replies else ("include" if args.include_replies else "exclude"),
        "include_reposts": args.include_reposts,
        "strict_original_verification": not args.skip_original_verification,
        "accept_partial_search_errors": args.accept_partial_search_errors,
        "profile_fallback_on_search_error": args.profile_fallback_on_search_error,
        "profile_fallback_max_scrolls": args.profile_fallback_max_scrolls,
        "incremental_mode": incremental_mode,
        "plan_only": args.plan_only,
    }
    print(json.dumps(plan, ensure_ascii=False, indent=2), flush=True)
    if args.plan_only:
        if args.summary_json:
            summary_path = Path(args.summary_json).expanduser().resolve()
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return
    if not (runtime_dir / "node_modules" / "playwright").is_dir():
        raise SystemExit(
            f"Playwright runtime not found: {runtime_dir}. "
            "Run scripts/prepare_runtime.sh before crawling."
        )
    for required_script in (script, verification_script):
        if not required_script.is_file():
            raise SystemExit(f"Required script not found: {required_script}")

    window_index = 0
    partial_search_error_seen = False
    profile_fallback_used = False
    while until_dt > min_dt:
        before_count = load_count(output_json)
        if before_count >= args.limit and not incremental_mode:
            print(f"done: count={before_count} limit={args.limit}", flush=True)
            break

        since_dt = max(min_dt, until_dt - window)
        since_ts = int(since_dt.timestamp())
        until_ts = int(until_dt.timestamp())
        # X's web search currently returns an empty shell for historical
        # since_time/until_time queries even though equivalent since/until
        # date queries return posts. Date operators are UTC-day based, while
        # our crawl boundaries are Beijing midnights, so widen each query to
        # the containing UTC dates. Post-ID deduplication removes overlap.
        since_query_date, until_query_date = utc_query_dates(since_dt, until_dt)
        query = build_search_query(
            args.username,
            since_dt,
            until_dt,
            include_replies=args.include_replies,
            only_replies=args.only_replies,
            include_reposts=args.include_reposts,
        )
        url = "https://x.com/search?q=" + urllib.parse.quote(query, safe="") + "&f=live"
        debug_dir = debug_root / f"{window_index:04d}_{date_text(since_dt)}_{date_text(until_dt)}"

        after_count = before_count
        code = 0
        last_debug_dir = debug_dir
        attempt_count = max(args.retry_error_windows + 1, len(storage_states))
        for attempt in range(attempt_count):
            attempt_debug_dir = debug_dir if attempt == 0 else debug_root / f"{debug_dir.name}_retry{attempt}"
            last_debug_dir = attempt_debug_dir
            storage_state = choose_storage_state(storage_states, window_index, attempt)
            print(
                f"window={window_index} attempt={attempt} {date_text(since_dt)}..{date_text(until_dt)} "
                f"since={since_query_date} until={until_query_date} "
                f"since_time={since_ts} until_time={until_ts} before={before_count} "
                f"storage_state={storage_state.name}",
                flush=True,
            )
            cmd = [
                "node",
                str(script),
                "--profile-url",
                url,
                "--username",
                args.username,
                "--runtime-dir",
                str(runtime_dir),
                "--output-csv",
                str(output_csv),
                "--output-json",
                str(output_json),
                "--storage-state",
                str(storage_state),
                "--debug-dir",
                str(attempt_debug_dir),
                "--limit",
                str(args.limit),
                "--max-scrolls",
                str(args.per_window_max_scrolls),
                "--stop-after-stale-scrolls",
                str(args.stop_after_stale_scrolls),
                "--wait-ms",
                str(args.wait_ms),
                "--headless",
            ]
            if output_json.exists():
                cmd.extend(["--seed-json", str(output_json)])
            if incremental_mode:
                cmd.append("--ignore-limit-for-scroll-stop")

            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            assert process.stdout is not None
            for line in process.stdout:
                print(line, end="", flush=True)
            code = process.wait()
            after_count = load_count(output_json)
            if code != 0:
                break
            if not search_error(attempt_debug_dir):
                break
            if args.accept_partial_search_errors and partial_search_error(attempt_debug_dir):
                partial_search_error_seen = True
                print(
                    f"warning: accepting partial X search window={window_index}; "
                    "rows were returned before the page error; watermark will not advance",
                    flush=True,
                )
                break
            if args.profile_fallback_on_search_error:
                print(
                    f"warning: date search failed for window={window_index}; "
                    "trying authenticated profile timeline fallback",
                    flush=True,
                )
                break
            if attempt < attempt_count - 1:
                next_state = choose_storage_state(storage_states, window_index, attempt + 1)
                completed_state_cycle = (attempt + 1) % len(storage_states) == 0
                if completed_state_cycle:
                    print(
                        f"search_error window={window_index}; all {len(storage_states)} storage states tried; "
                        f"sleeping {args.error_sleep_seconds}s before next cycle",
                        flush=True,
                    )
                    import time

                    time.sleep(args.error_sleep_seconds)
                else:
                    print(
                        f"search_error window={window_index}; rotating immediately to storage_state={next_state.name}",
                        flush=True,
                    )

        print(
            f"window_done={window_index} exit={code} after={after_count} added={after_count - before_count}",
            flush=True,
        )
        if code != 0:
            raise SystemExit(code)
        if search_error(last_debug_dir):
            if args.accept_partial_search_errors and partial_search_error(last_debug_dir):
                partial_search_error_seen = True
                print(
                    f"warning: accepting partial X search window={window_index} after retries; "
                    "watermark will not advance",
                    flush=True,
                )
            elif args.profile_fallback_on_search_error:
                fallback_debug_dir = debug_root / f"{debug_dir.name}_profile_fallback"
                fallback_state = choose_storage_state(storage_states, window_index, 0)
                fallback_cmd = [
                    "node",
                    str(script),
                    "--profile-url",
                    f"https://x.com/{args.username}",
                    "--username",
                    args.username,
                    "--runtime-dir",
                    str(runtime_dir),
                    "--output-csv",
                    str(output_csv),
                    "--output-json",
                    str(output_json),
                    "--storage-state",
                    str(fallback_state),
                    "--debug-dir",
                    str(fallback_debug_dir),
                    "--limit",
                    str(args.limit),
                    "--max-scrolls",
                    str(args.profile_fallback_max_scrolls),
                    "--stop-after-stale-scrolls",
                    str(args.stop_after_stale_scrolls),
                    "--wait-ms",
                    str(args.wait_ms),
                    "--headless",
                ]
                if output_json.exists():
                    fallback_cmd.extend(["--seed-json", str(output_json)])
                if incremental_mode:
                    fallback_cmd.append("--ignore-limit-for-scroll-stop")
                print(
                    f"profile_fallback window={window_index} storage_state={fallback_state.name}",
                    flush=True,
                )
                fallback_process = subprocess.Popen(
                    fallback_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                )
                assert fallback_process.stdout is not None
                for line in fallback_process.stdout:
                    print(line, end="", flush=True)
                fallback_code = fallback_process.wait()
                after_count = load_count(output_json)
                fallback_failed = search_error(fallback_debug_dir)
                fallback_partial = partial_search_error(fallback_debug_dir)
                if fallback_code != 0 or (fallback_failed and not (args.accept_partial_search_errors and fallback_partial)):
                    raise SystemExit(
                        f"window_failed={window_index} {date_text(since_dt)}..{date_text(until_dt)} "
                        "X date search and authenticated profile fallback both failed"
                    )
                profile_fallback_used = True
                if fallback_failed:
                    partial_search_error_seen = True
                print(
                    f"warning: profile fallback accepted for window={window_index}; "
                    "watermark will not advance",
                    flush=True,
                )
            else:
                raise SystemExit(
                    f"window_failed={window_index} {date_text(since_dt)}..{date_text(until_dt)} "
                    "X search returned an error after all retries; refusing to skip this window"
                )

        # The authenticated profile fallback scans the account timeline from
        # the top, so it replaces the remaining date windows for this run.
        until_dt = min_dt if profile_fallback_used else since_dt
        window_index += 1

    raw_count = load_count(output_json)
    final_count = raw_count
    if not args.skip_original_verification:
        if not output_csv.exists():
            raise SystemExit(f"raw scrape CSV missing: {output_csv}")
        shutil.copy2(output_csv, raw_output_csv)
        verify_cmd = [
            "node",
            str(verification_script),
            "--csv",
            str(raw_output_csv),
            "--author",
            args.username,
            "--output-csv",
            str(output_csv),
            "--quarantine-csv",
            str(quarantine_csv),
            "--audit-jsonl",
            str(verification_audit),
            "--summary-json",
            str(verification_summary),
            "--concurrency",
            str(args.verification_concurrency),
            "--delay-ms",
            str(args.verification_delay_ms),
        ]
        print("running strict original-post verification gate", flush=True)
        verified = subprocess.run(verify_cmd, check=False)
        if verified.returncode != 0:
            raise SystemExit(verified.returncode)
        final_count = load_csv_count(output_csv)
    date_range_complete = until_dt <= min_dt
    coverage_complete = date_range_complete and not partial_search_error_seen and not profile_fallback_used
    diagnostic_mode = args.include_replies or args.only_replies or args.include_reposts
    watermark_updated = False
    watermark_skip_reason = ""
    next_boundary = previous_boundary
    verified_date_min, verified_date_max = load_csv_date_range(output_csv)
    if args.skip_original_verification:
        watermark_skip_reason = "original_verification_skipped"
    elif diagnostic_mode:
        watermark_skip_reason = "diagnostic_reply_or_repost_mode"
    elif partial_search_error_seen:
        watermark_skip_reason = "partial_search_error"
    elif profile_fallback_used:
        watermark_skip_reason = "profile_fallback_on_search_error"
    elif not date_range_complete:
        watermark_skip_reason = "crawl_stopped_before_watermark"
    else:
        completed_at = datetime.now(timezone.utc)
        previous_history = (saved_watermark or {}).get("history") or []
        if not isinstance(previous_history, list):
            previous_history = []
        previous_boundary_dt = local_midnight(previous_boundary) if previous_boundary else None
        advanced_boundary_dt = run_until_dt
        if previous_boundary_dt and previous_boundary_dt > advanced_boundary_dt:
            advanced_boundary_dt = previous_boundary_dt
        run_record = {
            "started_at": run_started_at.isoformat(),
            "completed_at": completed_at.isoformat(),
            "crawl_from_local_date": date_text(run_until_dt),
            "stop_at_local_date": date_text(min_dt),
            "stop_source": stop_source,
            "windows": window_index,
            "raw_count": raw_count,
            "verified_original_count": final_count,
            "verified_post_date_min": verified_date_min,
            "verified_post_date_max": verified_date_max,
        }
        watermark_data: dict[str, object] = {
            "version": 1,
            "username": args.username,
            "timezone": "Asia/Shanghai",
            "boundary_semantics": "exclusive Beijing local date; next run crawls backward to this date and stops",
            "last_successful_until_local_date": date_text(advanced_boundary_dt),
            "updated_at": completed_at.isoformat(),
            "last_run": run_record,
            "history": [*previous_history, run_record][-20:],
        }
        write_watermark(watermark_path, watermark_data)
        watermark_updated = True
        next_boundary = date_text(advanced_boundary_dt)
    summary = {
        "output_csv": str(output_csv),
        "raw_output_csv": str(raw_output_csv) if not args.skip_original_verification else "",
        "output_json": str(output_json),
        "count": final_count,
        "raw_count": raw_count,
        "quarantine_csv": str(quarantine_csv) if not args.skip_original_verification else "",
        "verification_summary": str(verification_summary) if not args.skip_original_verification else "",
        "original_verification": not args.skip_original_verification,
        "coverage_complete": coverage_complete,
        "partial_search_error": partial_search_error_seen,
        "profile_fallback_used": profile_fallback_used,
        "watermark_file": str(watermark_path),
        "watermark_updated": watermark_updated,
        "watermark_skip_reason": watermark_skip_reason,
        "next_incremental_stop_local_date": next_boundary,
        "complete": final_count >= args.limit,
        "windows": window_index,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    if args.summary_json:
        summary_path = Path(args.summary_json).expanduser().resolve()
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
