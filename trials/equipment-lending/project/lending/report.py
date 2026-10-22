"""Database-derived reports and counts.

The report always reads real rows. Overdue means active and strictly before the
explicit as-of date; a loan due today is therefore not overdue.
"""

from __future__ import annotations

import re
import sqlite3
from datetime import date

_DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")


def parse_as_of(value: str) -> date:
    """Parse the report's explicit local calendar date, rejecting loose forms."""
    if not isinstance(value, str) or not _DATE_PATTERN.fullmatch(value):
        raise ValueError("as-of date must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"as-of date is not a real calendar date: {value}") from exc


def build_report(connection: sqlite3.Connection, as_of: str) -> dict[str, object]:
    """Build the deterministic JSON-ready overview for an ISO as-of date."""
    as_of_date = parse_as_of(as_of)

    equipment_total = connection.execute("SELECT count(*) FROM equipment").fetchone()[0]
    equipment_available = connection.execute(
        """
        SELECT count(*) FROM equipment AS e
        WHERE NOT EXISTS (
            SELECT 1 FROM loans AS l
            WHERE l.equipment_id = e.id AND l.returned_date IS NULL
        )
        """
    ).fetchone()[0]
    equipment_on_loan = connection.execute(
        """
        SELECT count(DISTINCT equipment_id) FROM loans
        WHERE returned_date IS NULL
        """
    ).fetchone()[0]
    borrower_total = connection.execute("SELECT count(*) FROM borrowers").fetchone()[0]

    active_loans = connection.execute(
        "SELECT count(*) FROM loans WHERE returned_date IS NULL"
    ).fetchone()[0]
    returned_loans = connection.execute(
        "SELECT count(*) FROM loans WHERE returned_date IS NOT NULL"
    ).fetchone()[0]
    overdue_loans = connection.execute(
        """
        SELECT count(*) FROM loans
        WHERE returned_date IS NULL AND due_date < ?
        """,
        (as_of,),
    ).fetchone()[0]

    overdue_rows = connection.execute(
        """
        SELECT e.asset_tag, b.name AS borrower_name, l.due_date
        FROM loans AS l
        JOIN equipment AS e ON e.id = l.equipment_id
        JOIN borrowers AS b ON b.id = l.borrower_id
        WHERE l.returned_date IS NULL AND l.due_date < ?
        ORDER BY l.due_date, e.asset_tag, l.id
        """,
        (as_of,),
    ).fetchall()

    overdue_details = [
        {
            "asset_tag": row["asset_tag"],
            "borrower_name": row["borrower_name"],
            "due_date": row["due_date"],
            "days_overdue": (as_of_date - date.fromisoformat(row["due_date"])).days,
        }
        for row in overdue_rows
    ]

    return {
        "as_of": as_of,
        "equipment": {
            "total": equipment_total,
            "available": equipment_available,
            "on_loan": equipment_on_loan,
        },
        "borrowers": borrower_total,
        "loans": {
            "active": active_loans,
            "overdue": overdue_loans,
            "returned": returned_loans,
        },
        "overdue_loans": overdue_details,
    }
