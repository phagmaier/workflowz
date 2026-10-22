"""Local HTTP server for the browser application.

The foundation serves the shell, static assets and one read-only overview API.
Feature slices extend the same handler and remain on loopback by default.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from datetime import date
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from urllib.parse import parse_qs

from .db import open_database
from .report import build_report

WEB_ROOT = Path(__file__).with_name("web")

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
}


class LendingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], db_path: Path):
        self.db_path = db_path
        super().__init__(address, LendingRequestHandler)


class LendingRequestHandler(BaseHTTPRequestHandler):
    server: LendingHTTPServer
    server_version = "WorkshopLending/0.1"
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        path = unquote(parsed.path)
        if path == "/api/summary":
            self._send_summary()
            return
        if path in ("/api/equipment", "/api/borrowers"):
            self._send_records(path.rsplit("/", 1)[-1])
            return
        if path == "/":
            path = "/index.html"
        self._send_static(path)

    def do_POST(self) -> None:
        self._mutate("create")

    def do_PUT(self) -> None:
        self._mutate("update")

    def do_DELETE(self) -> None:
        self._mutate("delete")

    def _body(self) -> dict[str, object]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 65536:
                raise ValueError
            value = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError) as exc:
            raise ValueError("Send a valid JSON object.") from exc
        if not isinstance(value, dict):
            raise ValueError("Send a valid JSON object.")
        return value

    def _mutate(self, operation: str) -> None:
        parts = [part for part in unquote(urlsplit(self.path).path).split("/") if part]
        if len(parts) not in (2, 3) or parts[0] != "api" or parts[1] not in ("equipment", "borrowers"):
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found."})
            return
        kind = parts[1]
        record_id = None
        if len(parts) == 3:
            try:
                record_id = int(parts[2])
                if record_id < 1: raise ValueError
            except ValueError:
                self._send_json(HTTPStatus.NOT_FOUND, {"error": "Record not found."})
                return
        if operation == "create" and record_id is not None or operation != "create" and record_id is None:
            self._send_json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Method does not match this URL."})
            return
        try:
            payload = {} if operation == "delete" else self._body()
            conn = open_database(self.server.db_path, create=False)
            try:
                if operation == "delete":
                    cursor = conn.execute(f"DELETE FROM {kind} WHERE id = ?", (record_id,))
                    if not cursor.rowcount:
                        conn.rollback(); self._send_json(HTTPStatus.NOT_FOUND, {"error": "Record not found."}); return
                    conn.commit()
                    self._send_json(HTTPStatus.OK, {"deleted": True})
                    return
                row = _validated_record(kind, payload)
                columns = list(row)
                values = [row[key] for key in columns]
                if operation == "create":
                    cursor = conn.execute(f"INSERT INTO {kind} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})", values)
                    record_id = int(cursor.lastrowid)
                    status = HTTPStatus.CREATED
                else:
                    cursor = conn.execute(f"UPDATE {kind} SET " + ", ".join(f"{key} = ?" for key in columns) + " WHERE id = ?", values + [record_id])
                    if not cursor.rowcount:
                        conn.rollback(); self._send_json(HTTPStatus.NOT_FOUND, {"error": "Record not found."}); return
                    status = HTTPStatus.OK
                conn.commit()
                self._send_json(status, {"id": record_id})
            finally:
                conn.close()
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except sqlite3.IntegrityError as exc:
            message = "This asset tag is already in use." if kind == "equipment" and "equipment.asset_tag" in str(exc) else "This record is referenced by loan history and cannot be deleted."
            code = HTTPStatus.CONFLICT if operation == "delete" or "UNIQUE" in str(exc) else HTTPStatus.BAD_REQUEST
            self._send_json(code, {"error": message})
        except (OSError, sqlite3.Error) as exc:
            self.log_error("record mutation failed: %s", exc)
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Could not save this record."})

    def _send_records(self, kind: str) -> None:
        conn = open_database(self.server.db_path, create=False)
        try:
            if kind == "equipment":
                rows = conn.execute("""SELECT e.id, e.name, e.asset_tag, e.category, e.notes,
                    CASE WHEN l.id IS NULL THEN 0 ELSE 1 END AS on_loan
                    FROM equipment e LEFT JOIN loans l ON l.equipment_id=e.id AND l.returned_date IS NULL ORDER BY e.name COLLATE NOCASE, e.asset_tag""").fetchall()
            else:
                rows = conn.execute("SELECT id, name, email, notes FROM borrowers ORDER BY name COLLATE NOCASE, id").fetchall()
            self._send_json(HTTPStatus.OK, [dict(row) for row in rows])
        finally:
            conn.close()

    def do_HEAD(self) -> None:
        self._send_error(
            HTTPStatus.METHOD_NOT_ALLOWED, "Only GET is supported.", head=True
        )

    def _send_summary(self) -> None:
        try:
            connection = open_database(self.server.db_path, create=False)
            try:
                payload = build_report(connection, date.today().isoformat())
            finally:
                connection.close()
        except (OSError, sqlite3.Error) as exc:
            self.log_error("overview unavailable: %s", exc)
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "Could not read lending records."},
            )
            return
        self._send_json(HTTPStatus.OK, payload)

    def _send_static(self, requested: str) -> None:
        relative = requested.lstrip("/")
        candidate = (WEB_ROOT / relative).resolve()
        try:
            candidate.relative_to(WEB_ROOT.resolve())
        except ValueError:
            self._send_error(HTTPStatus.NOT_FOUND, "Not found.")
            return
        if not candidate.is_file():
            self._send_error(HTTPStatus.NOT_FOUND, "Not found.")
            return

        body = candidate.read_bytes()
        content_type = _CONTENT_TYPES.get(candidate.suffix, "application/octet-stream")
        headers = {"Content-Type": content_type}
        if candidate.suffix == ".html":
            headers["Content-Security-Policy"] = (
                "default-src 'self'; script-src 'self'; style-src 'self'; "
                "img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"
            )
        self._send_bytes(HTTPStatus.OK, body, headers)

    def _send_json(self, status: HTTPStatus, payload: object) -> None:
        body = (json.dumps(payload, indent=2) + "\n").encode("utf-8")
        self._send_bytes(
            status,
            body,
            {"Content-Type": "application/json; charset=utf-8"},
        )

    def _send_error(
        self, status: HTTPStatus, message: str, *, head: bool = False
    ) -> None:
        body = (message + "\n").encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _send_bytes(
        self, status: HTTPStatus, body: bytes, headers: dict[str, str]
    ) -> None:
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))


def create_server(
    db_path: str | Path, host: str = "127.0.0.1", port: int = 8765
) -> LendingHTTPServer:
    """Initialize the database and build a server without starting its loop."""
    path = Path(db_path).expanduser()
    connection = open_database(path, create=True)
    connection.close()
    return LendingHTTPServer((host, port), path)


def _validated_record(kind: str, payload: dict[str, object]) -> dict[str, str | None]:
    if kind == "equipment":
        fields = {key: str(payload.get(key, "")).strip() for key in ("name", "asset_tag", "category")}
        fields["notes"] = str(payload.get("notes", "")).strip() or None
        required = (("name", "Enter an equipment name."), ("asset_tag", "Enter an asset tag."), ("category", "Enter a category."))
    else:
        fields = {key: str(payload.get(key, "")).strip() for key in ("name", "email")}
        fields["notes"] = str(payload.get("notes", "")).strip() or None
        required = (("name", "Enter a borrower name."), ("email", "Enter an email address."))
    for key, message in required:
        if not fields[key]: raise ValueError(message)
    if kind == "borrowers":
        email = fields["email"] or ""
        if len(email) > 254 or email.count("@") != 1 or any(part.strip() == "" for part in email.split("@")) or "." not in email.rsplit("@", 1)[-1]:
            raise ValueError("Enter a valid email address, such as name@example.com.")
    return fields


def serve(db_path: str | Path, host: str = "127.0.0.1", port: int = 8765) -> None:
    httpd = create_server(db_path, host, port)
    bound_host, bound_port = httpd.server_address[:2]
    print(
        f"Workshop Lending listening on http://{bound_host}:{bound_port}/", flush=True
    )
    print(f"Database: {Path(db_path).expanduser().resolve()}", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
