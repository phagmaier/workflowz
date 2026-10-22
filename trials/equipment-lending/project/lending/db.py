"""SQLite connection and schema setup."""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_VERSION = 1
_SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def connect(db_path: str | Path, *, create: bool = False) -> sqlite3.Connection:
    """Open a connection with lending integrity pragmas enabled.

    ``create`` allows a missing database file. The service and seed commands use
    it; read-only callers should not silently create an empty database.
    """
    path = Path(db_path).expanduser()
    if create:
        path.parent.mkdir(parents=True, exist_ok=True)
    elif not path.is_file():
        raise FileNotFoundError(
            f"database not found: {path} (run the seed command first)"
        )

    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def initialize(connection: sqlite3.Connection) -> None:
    """Create missing tables and indexes; safe to call on every start."""
    schema = _SCHEMA_PATH.read_text(encoding="utf-8")
    connection.executescript(schema)
    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    connection.commit()


def open_database(db_path: str | Path, *, create: bool = False) -> sqlite3.Connection:
    """Open and, when requested, initialize a database in one step."""
    connection = connect(db_path, create=create)
    if create:
        initialize(connection)
    return connection
