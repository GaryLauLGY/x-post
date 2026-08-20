import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = SKILL_ROOT / "scripts" / "scrape_profile_time_windows.py"
SPEC = importlib.util.spec_from_file_location("x_post_crawler", SCRIPT)
CRAWLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CRAWLER)


class CrawlLogicTests(unittest.TestCase):
    def test_two_storage_states_rotate_across_attempts_and_windows(self):
        states = [Path("primary.json"), Path("secondary.json")]
        self.assertEqual(
            [CRAWLER.choose_storage_state(states, 0, attempt).name for attempt in range(4)],
            ["primary.json", "secondary.json", "primary.json", "secondary.json"],
        )
        self.assertEqual(
            [CRAWLER.choose_storage_state(states, 1, attempt).name for attempt in range(4)],
            ["secondary.json", "primary.json", "secondary.json", "primary.json"],
        )

    def test_beijing_window_builds_widened_utc_date_query(self):
        since = CRAWLER.local_midnight("2026-07-01")
        until = CRAWLER.local_midnight("2026-07-06")
        query = CRAWLER.build_search_query(
            "example",
            since,
            until,
            include_replies=False,
            only_replies=False,
            include_reposts=False,
        )
        self.assertEqual(
            query,
            "from:example -filter:replies since:2026-06-30 until:2026-07-06",
        )

    def test_blank_shell_is_an_error_but_valid_empty_results_are_not(self):
        with tempfile.TemporaryDirectory() as temporary:
            debug = Path(temporary)
            page_info = debug / "profile_page.json"
            page_info.write_text(
                json.dumps(
                    {
                        "title": "X",
                        "body_text_head": "Home",
                        "article_count": 0,
                        "seen_this_run_count": 0,
                    }
                ),
                encoding="utf-8",
            )
            self.assertTrue(CRAWLER.search_error(debug))
            page_info.write_text(
                json.dumps(
                    {
                        "title": "Search / X",
                        "body_text_head": "No results for this query",
                        "article_count": 0,
                        "seen_this_run_count": 0,
                    }
                ),
                encoding="utf-8",
            )
            self.assertFalse(CRAWLER.search_error(debug))

    def test_explicit_x_error_fails_even_after_partial_results(self):
        with tempfile.TemporaryDirectory() as temporary:
            debug = Path(temporary)
            (debug / "profile_page.json").write_text(
                json.dumps(
                    {
                        "title": "Search / X",
                        "body_text_head": "Something went wrong. Try reloading.",
                        "article_count": 4,
                        "seen_this_run_count": 4,
                    }
                ),
                encoding="utf-8",
            )
            self.assertTrue(CRAWLER.search_error(debug))

    def test_partial_search_error_is_identified_for_explicit_opt_in(self):
        with tempfile.TemporaryDirectory() as temporary:
            debug = Path(temporary)
            (debug / "profile_page.json").write_text(
                json.dumps(
                    {
                        "title": "Search / X",
                        "body_text_head": "Something went wrong. Try reloading.",
                        "article_count": 4,
                        "seen_this_run_count": 4,
                    }
                ),
                encoding="utf-8",
            )
            self.assertTrue(CRAWLER.partial_search_error(debug))
            (debug / "profile_page.json").write_text(
                json.dumps(
                    {
                        "title": "Search / X",
                        "body_text_head": "Something went wrong. Try reloading.",
                        "article_count": 4,
                        "seen_this_run_count": 0,
                    }
                ),
                encoding="utf-8",
            )
            self.assertTrue(CRAWLER.partial_search_error(debug))

    def test_plan_only_uses_watermark_overlap_and_counts_states(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            primary = root / "primary.json"
            secondary = root / "secondary.json"
            primary.write_text("{}\n", encoding="utf-8")
            secondary.write_text("{}\n", encoding="utf-8")
            output = root / "output"
            output.mkdir()
            watermark = output / "example_crawl_watermark.json"
            watermark.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "username": "example",
                        "last_successful_until_local_date": "2026-07-20",
                    }
                ),
                encoding="utf-8",
            )
            completed = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--username",
                    "example",
                    "--storage-state",
                    str(primary),
                    "--fallback-storage-state",
                    str(secondary),
                    "--output-dir",
                    str(output),
                    "--until-local-date",
                    "2026-08-01",
                    "--watermark-overlap-days",
                    "2",
                    "--plan-only",
                ],
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        plan = json.loads(completed.stdout)
        self.assertEqual(plan["stop_source"], "saved_watermark")
        self.assertEqual(plan["stop_at_local_date"], "2026-07-18")
        self.assertEqual(plan["storage_state_count"], 2)
        self.assertTrue(plan["strict_original_verification"])


if __name__ == "__main__":
    unittest.main()
