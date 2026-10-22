"""Command-line entry points: serve, seed and report."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

from .db import open_database
from .report import build_report, parse_as_of
from .seed import seed_demo_data
from .server import serve


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python3 -m lending",
        description="Workshop equipment lending local application.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    serve_parser = commands.add_parser("serve", help="run the local browser app")
    serve_parser.add_argument("--db", required=True, help="path to the SQLite database")
    serve_parser.add_argument("--host", default="127.0.0.1", help="bind address")
    serve_parser.add_argument("--port", type=int, default=8765, help="bind port")

    seed_parser = commands.add_parser(
        "seed", help="insert the fictional demo data once"
    )
    seed_parser.add_argument("--db", required=True, help="path to the SQLite database")

    report_parser = commands.add_parser("report", help="print database overview counts")
    report_parser.add_argument(
        "--db", required=True, help="path to the SQLite database"
    )
    report_parser.add_argument(
        "--as-of", required=True, dest="as_of", help="overdue cut-off date (YYYY-MM-DD)"
    )
    report_parser.add_argument(
        "--format", choices=("json",), default="json", help="output format"
    )
    return parser


def _run_seed(db_path: str) -> int:
    try:
        connection = open_database(db_path, create=True)
        try:
            result = seed_demo_data(connection)
        finally:
            connection.close()
    except sqlite3.Error as exc:
        print(f"error: could not seed database: {exc}", file=sys.stderr)
        return 1

    if result.seeded:
        print(
            f"Seeded {result.equipment} equipment items, {result.borrowers} borrowers "
            f"and {result.loans} loans."
        )
    else:
        print("Demo data already present; no records changed.")
    return 0


def _run_report(db_path: str, as_of: str, output_format: str) -> int:
    try:
        parse_as_of(as_of)
        connection = open_database(db_path, create=False)
        try:
            report = build_report(connection, as_of)
        finally:
            connection.close()
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except sqlite3.Error as exc:
        print(f"error: could not read database: {exc}", file=sys.stderr)
        return 1

    if output_format != "json":
        print(f"error: unsupported format: {output_format}", file=sys.stderr)
        return 2
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.command == "serve":
        try:
            serve(Path(args.db), args.host, args.port)
        except OSError as exc:
            print(f"error: could not start server: {exc}", file=sys.stderr)
            return 1
        return 0

    if args.command == "seed":
        return _run_seed(args.db)

    if args.command == "report":
        return _run_report(args.db, args.as_of, args.format)

    print("error: no command given", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
