"""Foundation tests: schema integrity, seed safety, reports and HTTP shell."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import threading
import unittest
from datetime import date
from io import StringIO
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import urlopen
from urllib.request import Request

from lending import cli
from lending.db import open_database
from lending.report import build_report, parse_as_of
from lending.seed import DEMO_DATE, seed_demo_data
from lending.server import create_server


class LendingDatabaseTest(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory(prefix="lending-test-")
        self.addCleanup(self._temporary.cleanup)
        self.db_path = Path(self._temporary.name) / "test.sqlite"
        self.conn = open_database(self.db_path, create=True)
        self.addCleanup(self.conn.close)

    def add_equipment(
        self, asset_tag: str, name: str = "Test tool", category: str = "Test"
    ) -> int:
        cursor = self.conn.execute(
            "INSERT INTO equipment (name, asset_tag, category) VALUES (?, ?, ?)",
            (name, asset_tag, category),
        )
        self.conn.commit()
        return int(cursor.lastrowid)

    def add_borrower(self, email: str, name: str = "Test Borrower") -> int:
        cursor = self.conn.execute(
            "INSERT INTO borrowers (name, email) VALUES (?, ?)", (name, email)
        )
        self.conn.commit()
        return int(cursor.lastrowid)

    def add_loan(
        self,
        equipment_id: int,
        borrower_id: int,
        checkout: str,
        due: str,
        returned: str | None = None,
    ) -> int:
        cursor = self.conn.execute(
            """
            INSERT INTO loans
                (equipment_id, borrower_id, checkout_date, due_date, returned_date)
            VALUES (?, ?, ?, ?, ?)
            """,
            (equipment_id, borrower_id, checkout, due, returned),
        )
        self.conn.commit()
        return int(cursor.lastrowid)

    def row_counts(self) -> dict[str, int]:
        return {
            table: self.conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            for table in ("equipment", "borrowers", "loans")
        }


class SeedAndReportTests(LendingDatabaseTest):
    def test_seed_report_agreement_and_repeat_safety(self) -> None:
        result = seed_demo_data(self.conn)
        self.assertTrue(result.seeded)
        self.assertEqual((result.equipment, result.borrowers, result.loans), (10, 4, 5))

        report = build_report(self.conn, DEMO_DATE)
        self.assertEqual(report["as_of"], "2026-10-22")
        self.assertEqual(
            report["equipment"], {"total": 10, "available": 7, "on_loan": 3}
        )
        self.assertEqual(report["borrowers"], 4)
        self.assertEqual(report["loans"], {"active": 3, "overdue": 1, "returned": 2})
        self.assertEqual(
            report["overdue_loans"],
            [
                {
                    "asset_tag": "PT-001",
                    "borrower_name": "Maya Chen",
                    "due_date": "2026-10-15",
                    "days_overdue": 7,
                }
            ],
        )

        counts_before = self.row_counts()
        second = seed_demo_data(self.conn)
        self.assertFalse(second.seeded)
        self.assertEqual(self.row_counts(), counts_before)
        self.assertEqual(build_report(self.conn, DEMO_DATE), report)

    def test_seed_keeps_existing_local_records(self) -> None:
        self.add_equipment("LOCAL-1", name="Member's own mallet", category="Hand Tools")
        self.add_borrower("member@example.com", name="Existing Member")

        seed_demo_data(self.conn)
        seed_demo_data(self.conn)

        self.assertEqual(
            self.row_counts(), {"equipment": 11, "borrowers": 5, "loans": 5}
        )
        remaining = self.conn.execute(
            "SELECT name FROM equipment WHERE asset_tag = 'LOCAL-1'"
        ).fetchone()
        self.assertEqual(remaining["name"], "Member's own mallet")
        self.assertEqual(build_report(self.conn, DEMO_DATE)["equipment"]["total"], 11)

    def test_overdue_boundary_and_deterministic_order(self) -> None:
        borrower_id = self.add_borrower("case@example.com", "Case Tester")

        later_id = self.add_equipment("ZZ-200", "Later item")
        earlier_id = self.add_equipment("AA-100", "Earlier item")
        today_id = self.add_equipment("MM-150", "Due today item")
        returned_id = self.add_equipment("BB-050", "Returned item")

        self.add_loan(later_id, borrower_id, "2026-10-01", "2026-10-20")
        self.add_loan(earlier_id, borrower_id, "2026-10-01", "2026-10-15")
        self.add_loan(today_id, borrower_id, "2026-10-20", "2026-10-22")
        self.add_loan(
            returned_id, borrower_id, "2026-09-01", "2026-09-10", "2026-09-09"
        )

        report = build_report(self.conn, "2026-10-22")
        self.assertEqual(report["loans"], {"active": 3, "overdue": 2, "returned": 1})
        self.assertEqual(
            [
                (item["asset_tag"], item["days_overdue"])
                for item in report["overdue_loans"]
            ],
            [("AA-100", 7), ("ZZ-200", 2)],
        )

        next_day = build_report(self.conn, "2026-10-23")
        self.assertEqual(next_day["loans"]["overdue"], 3)
        self.assertEqual(
            [item["asset_tag"] for item in next_day["overdue_loans"]],
            ["AA-100", "ZZ-200", "MM-150"],
        )

    def test_report_uses_real_rows_not_seed_totals(self) -> None:
        seed_demo_data(self.conn)
        self.conn.execute("DELETE FROM loans WHERE returned_date IS NOT NULL")
        self.conn.execute("DELETE FROM equipment WHERE asset_tag = 'PT-004'")
        self.conn.commit()

        report = build_report(self.conn, DEMO_DATE)
        self.assertEqual(report["equipment"]["total"], 9)
        self.assertEqual(report["loans"]["returned"], 0)
        self.assertEqual(report["loans"]["active"], 3)

    def test_report_rejects_loose_or_impossible_dates(self) -> None:
        for invalid in ("22-10-2026", "2026-2-03", "2026-02-30", "", "today"):
            with self.subTest(value=invalid):
                with self.assertRaises(ValueError):
                    parse_as_of(invalid)
        self.assertEqual(str(parse_as_of("2026-10-22")), "2026-10-22")


class IntegrityTests(LendingDatabaseTest):
    def test_required_fields_and_unique_asset_tags(self) -> None:
        self.add_equipment("TAG-1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_equipment("tag-1")
        self.conn.rollback()

        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                "INSERT INTO equipment (name, asset_tag, category) VALUES ('  ', 'X-1', 'Test')"
            )
        self.conn.rollback()

        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute(
                "INSERT INTO borrowers (name, email) VALUES ('No Email', '   ')"
            )
        self.conn.rollback()

    def test_one_active_loan_per_item_but_history_is_allowed(self) -> None:
        equipment_id = self.add_equipment("LOAN-1")
        borrower_id = self.add_borrower("first@example.com")
        second_borrower_id = self.add_borrower("second@example.com")

        self.add_loan(equipment_id, borrower_id, "2026-10-01", "2026-10-15")
        with self.assertRaises(sqlite3.IntegrityError):
            self.add_loan(equipment_id, second_borrower_id, "2026-10-02", "2026-10-16")
        self.conn.rollback()

        self.conn.execute(
            "UPDATE loans SET returned_date = '2026-10-14' WHERE equipment_id = ?",
            (equipment_id,),
        )
        self.conn.commit()
        self.add_loan(equipment_id, second_borrower_id, "2026-10-20", "2026-10-27")

        rows = self.conn.execute(
            "SELECT returned_date FROM loans WHERE equipment_id = ? ORDER BY id",
            (equipment_id,),
        ).fetchall()
        self.assertEqual([row["returned_date"] for row in rows], ["2026-10-14", None])

    def test_invalid_loan_dates_are_rejected(self) -> None:
        equipment_id = self.add_equipment("DATE-1")
        borrower_id = self.add_borrower("dates@example.com")

        with self.assertRaises(sqlite3.IntegrityError):
            self.add_loan(equipment_id, borrower_id, "2026-10-20", "2026-10-19")
        self.conn.rollback()

        with self.assertRaises(sqlite3.IntegrityError):
            self.add_loan(
                equipment_id, borrower_id, "2026-10-20", "2026-10-27", "2026-10-19"
            )
        self.conn.rollback()

        with self.assertRaises(sqlite3.IntegrityError):
            self.add_loan(equipment_id, borrower_id, "2026-02-30", "2026-03-05")
        self.conn.rollback()

        with self.assertRaises(sqlite3.IntegrityError):
            self.add_loan(
                equipment_id, borrower_id, "2026-10-20", "2026-10-27", "2026-02-31"
            )
        self.conn.rollback()

        self.assertEqual(self.row_counts()["loans"], 0)

    def test_referenced_records_cannot_be_deleted(self) -> None:
        seed_demo_data(self.conn)
        equipment_id = self.conn.execute(
            "SELECT id FROM equipment WHERE asset_tag = 'PT-001'"
        ).fetchone()["id"]
        borrower_id = self.conn.execute(
            "SELECT id FROM borrowers WHERE name = 'Maya Chen'"
        ).fetchone()["id"]

        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("DELETE FROM equipment WHERE id = ?", (equipment_id,))
        self.conn.rollback()

        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("DELETE FROM borrowers WHERE id = ?", (borrower_id,))
        self.conn.rollback()

        unused_id = self.add_equipment("UNUSED-1")
        self.conn.execute("DELETE FROM equipment WHERE id = ?", (unused_id,))
        self.conn.commit()
        self.assertIsNone(
            self.conn.execute(
                "SELECT 1 FROM equipment WHERE id = ?", (unused_id,)
            ).fetchone()
        )


class CommandAndServerTests(LendingDatabaseTest):
    def test_equipment_and_borrower_crud_validation_and_history_conflicts(self) -> None:
        httpd = create_server(self.db_path, "127.0.0.1", 0)
        thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 5)
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)
        base = f"http://127.0.0.1:{httpd.server_address[1]}"

        def call(method: str, path: str, data: dict | None = None) -> tuple[int, dict | list]:
            body = None if data is None else json.dumps(data).encode()
            request = Request(base + path, data=body, method=method, headers={"Content-Type": "application/json"})
            try:
                response = urlopen(request, timeout=5)
            except HTTPError as error:
                response = error
            with response:
                return response.status, json.load(response)

        status, equipment = call("POST", "/api/equipment", {"name": "  Cordless Drill ", "asset_tag": " DR-9 ", "category": " Power ", "notes": "  test note "})
        self.assertEqual(status, 201)
        equipment_id = equipment["id"]
        row = self.conn.execute("SELECT name, asset_tag, category, notes FROM equipment WHERE id=?", (equipment_id,)).fetchone()
        self.assertEqual(tuple(row), ("Cordless Drill", "DR-9", "Power", "test note"))
        self.assertEqual(call("GET", "/api/equipment")[1][0]["on_loan"], 0)

        status, error = call("POST", "/api/equipment", {"name": "Duplicate", "asset_tag": "dr-9", "category": "Power"})
        self.assertEqual(status, 409)
        self.assertIn("already in use", error["error"])
        status, error = call("POST", "/api/equipment", {"name": "  ", "asset_tag": "NEW", "category": "Power"})
        self.assertEqual(status, 400)
        self.assertIn("equipment name", error["error"])
        self.assertEqual(self.conn.execute("SELECT count(*) FROM equipment").fetchone()[0], 1)

        status, borrower = call("POST", "/api/borrowers", {"name": "  Jamie Rivera ", "email": " jamie@example.org ", "notes": " member "})
        self.assertEqual(status, 201)
        borrower_id = borrower["id"]
        status, error = call("POST", "/api/borrowers", {"name": "Bad Email", "email": "not-an-email"})
        self.assertEqual(status, 400)
        self.assertIn("valid email", error["error"])
        status, error = call("POST", "/api/borrowers", {"name": "", "email": "x@example.org"})
        self.assertEqual(status, 400)
        self.assertIn("borrower name", error["error"])

        status, _ = call("PUT", f"/api/equipment/{equipment_id}", {"name": "Bench Drill", "asset_tag": "DR-9", "category": "Power", "notes": "updated"})
        self.assertEqual(status, 200)
        status, _ = call("PUT", f"/api/borrowers/{borrower_id}", {"name": "Jamie R.", "email": "jamie.r@example.org", "notes": "updated"})
        self.assertEqual(status, 200)
        self.assertEqual(self.conn.execute("SELECT name FROM equipment").fetchone()[0], "Bench Drill")
        self.assertEqual(self.conn.execute("SELECT name FROM borrowers").fetchone()[0], "Jamie R.")

        status, _ = call("DELETE", f"/api/equipment/{equipment_id}")
        self.assertEqual(status, 200)
        status, _ = call("DELETE", f"/api/borrowers/{borrower_id}")
        self.assertEqual(status, 200)

        seed_demo_data(self.conn)
        status, error = call("DELETE", "/api/equipment/1")
        self.assertEqual(status, 409)
        self.assertIn("loan history", error["error"])
        status, error = call("DELETE", "/api/borrowers/1")
        self.assertEqual(status, 409)
        self.assertIn("loan history", error["error"])
        self.assertEqual(self.conn.execute("SELECT count(*) FROM loans").fetchone()[0], 5)

    def test_cli_seed_and_report_entry_points(self) -> None:
        seed_output = StringIO()
        with mock.patch("sys.stdout", seed_output):
            self.assertEqual(cli.main(["seed", "--db", str(self.db_path)]), 0)
        self.assertIn("Seeded 10 equipment items", seed_output.getvalue())

        report_output = StringIO()
        with mock.patch("sys.stdout", report_output):
            self.assertEqual(
                cli.main(
                    [
                        "report",
                        "--db",
                        str(self.db_path),
                        "--as-of",
                        DEMO_DATE,
                        "--format",
                        "json",
                    ]
                ),
                0,
            )
        payload = json.loads(report_output.getvalue())
        self.assertEqual(payload["as_of"], DEMO_DATE)
        self.assertEqual(payload["equipment"]["total"], 10)

        error_output = StringIO()
        with mock.patch("sys.stderr", error_output):
            self.assertEqual(
                cli.main(
                    [
                        "report",
                        "--db",
                        str(Path(self._temporary.name) / "missing.sqlite"),
                        "--as-of",
                        DEMO_DATE,
                        "--format",
                        "json",
                    ]
                ),
                1,
            )
        self.assertIn("database not found", error_output.getvalue())

    def test_browser_shell_and_summary_api(self) -> None:
        seed_demo_data(self.conn)
        httpd = create_server(self.db_path, "127.0.0.1", 0)
        thread = threading.Thread(
            target=httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        thread.start()
        self.addCleanup(thread.join, 5)
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)

        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        with urlopen(base + "/", timeout=5) as response:
            self.assertEqual(response.status, 200)
            page = response.read().decode("utf-8")
        self.assertIn("Workshop Lending", page)
        self.assertIn('src="/app.js"', page)
        self.assertIn("Equipment", page)

        with urlopen(base + "/api/summary", timeout=5) as response:
            self.assertEqual(response.status, 200)
            summary = json.load(response)
        expected = build_report(self.conn, date.today().isoformat())
        self.assertEqual(summary, expected)
        self.assertEqual(summary["equipment"]["total"], 10)

        with self.assertRaises(HTTPError) as caught:
            urlopen(base + "/api/not-a-route", timeout=5)
        self.assertEqual(caught.exception.code, 404)
        caught.exception.close()

        with self.assertRaises(HTTPError) as caught:
            urlopen(base + "/%2e%2e/README.md", timeout=5)
        self.assertEqual(caught.exception.code, 404)
        caught.exception.close()


if __name__ == "__main__":
    unittest.main()
