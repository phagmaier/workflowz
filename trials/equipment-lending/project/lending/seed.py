"""Repeat-safe fictional demo data for the workshop desk.

The fixed demo date is 2026-10-22. Loan dates are chosen around it so seeded
reports are reproducible even when the application is opened later.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

DEMO_DATE = "2026-10-22"
SEED_KEY = "demo_seed"
SEED_VERSION = "equipment-lending-demo-v1"

# name, asset tag, category, notes
EQUIPMENT = (
    (
        "Cordless Drill",
        "PT-001",
        "Power Tools",
        "18 V, two batteries; chuck key in the case.",
    ),
    (
        "Angle Grinder",
        "PT-002",
        "Power Tools",
        "125 mm discs; spares live in the tool crib.",
    ),
    ("Circular Saw", "PT-003", "Power Tools", "Blade guard checked 2026-09-30."),
    ("Orbital Sander", "PT-004", "Power Tools", None),
    ("Socket Wrench Set", "HT-001", "Hand Tools", "Metric and imperial sockets."),
    ("Claw Hammer", "HT-002", "Hand Tools", None),
    ("Screwdriver Set", "HT-003", "Hand Tools", "Phillips, flat and square tips."),
    ("Safety Goggles", "SF-001", "Safety", "Anti-fog coating; clean before returning."),
    ("Hearing Protection", "SF-002", "Safety", None),
    ("First Aid Kit", "SF-003", "Safety", "Check consumables monthly."),
)

# name, email, notes
BORROWERS = (
    ("Maya Chen", "maya.chen@example.com", "Weekend woodworking volunteer."),
    ("Daniel Okafor", "daniel.okafor@example.com", "Shop steward."),
    ("Priya Raman", "priya.raman@example.com", None),
    ("Sam Rivera", "sam.rivera@example.com", "New member; onboarding complete."),
)

# asset tag, borrower email, checkout, due, returned
LOANS = (
    ("PT-001", "maya.chen@example.com", "2026-10-01", "2026-10-15", None),
    ("PT-002", "daniel.okafor@example.com", "2026-10-08", "2026-10-22", None),
    ("PT-003", "priya.raman@example.com", "2026-10-20", "2026-10-29", None),
    ("HT-002", "maya.chen@example.com", "2026-09-20", "2026-10-04", "2026-10-02"),
    ("SF-001", "sam.rivera@example.com", "2026-09-12", "2026-09-26", "2026-09-25"),
)


@dataclass(frozen=True)
class SeedResult:
    seeded: bool
    equipment: int = 0
    borrowers: int = 0
    loans: int = 0


def already_seeded(connection: sqlite3.Connection) -> bool:
    row = connection.execute(
        "SELECT 1 FROM app_meta WHERE key = ?", (SEED_KEY,)
    ).fetchone()
    return row is not None


def seed_demo_data(connection: sqlite3.Connection) -> SeedResult:
    """Insert the demo set once, atomically.

    A marker in ``app_meta`` makes repeated seeding a no-op, so an existing demo
    database is neither erased nor duplicated. A fresh seed is one transaction.
    """
    connection.execute("BEGIN IMMEDIATE")
    try:
        if already_seeded(connection):
            connection.rollback()
            return SeedResult(seeded=False)

        equipment_ids: dict[str, int] = {}
        for name, asset_tag, category, notes in EQUIPMENT:
            cursor = connection.execute(
                "INSERT INTO equipment (name, asset_tag, category, notes) VALUES (?, ?, ?, ?)",
                (name, asset_tag, category, notes),
            )
            equipment_ids[asset_tag] = int(cursor.lastrowid)

        borrower_ids: dict[str, int] = {}
        for name, email, notes in BORROWERS:
            cursor = connection.execute(
                "INSERT INTO borrowers (name, email, notes) VALUES (?, ?, ?)",
                (name, email, notes),
            )
            borrower_ids[email] = int(cursor.lastrowid)

        for asset_tag, email, checkout, due, returned in LOANS:
            connection.execute(
                """
                INSERT INTO loans
                    (equipment_id, borrower_id, checkout_date, due_date, returned_date)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    equipment_ids[asset_tag],
                    borrower_ids[email],
                    checkout,
                    due,
                    returned,
                ),
            )

        connection.execute(
            "INSERT INTO app_meta (key, value) VALUES (?, ?)",
            (SEED_KEY, SEED_VERSION),
        )
        connection.commit()
    except BaseException:
        connection.rollback()
        raise

    return SeedResult(
        seeded=True,
        equipment=len(EQUIPMENT),
        borrowers=len(BORROWERS),
        loans=len(LOANS),
    )
