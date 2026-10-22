"""Independent checks of the partial artifact; does not implement or repair app code."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date
import json
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT / "project"
RESULTS = {}


def cli(*args, check=True):
    p = subprocess.run([sys.executable, "-m", "lending", *args], cwd=PROJECT,
                       text=True, capture_output=True, timeout=20)
    if check:
        p.check_returncode()
    return p


def launch(db):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    p = subprocess.Popen([sys.executable, "-m", "lending", "serve", "--db", str(db),
                          "--host", "127.0.0.1", "--port", str(port)], cwd=PROJECT,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 8
        while True:
            assert p.poll() is None
            try:
                with urlopen(base, timeout=1) as r:
                    assert r.status == 200
                return p, base
            except (URLError, TimeoutError):
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.1)
    except BaseException:
        stop(p)
        raise


def stop(p):
    p.terminate()
    try:
        p.wait(timeout=5)
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait(timeout=5)


def report(db):
    return json.loads(cli("report", "--db", str(db), "--as-of", "2026-10-22",
                          "--format", "json").stdout)


def main():
    (PROJECT / "var").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="independent-", dir=PROJECT / "var") as temp:
        db = Path(temp) / "trial.sqlite"
        cli("seed", "--db", str(db))
        c = sqlite3.connect(db)
        c.execute("PRAGMA foreign_keys=ON")
        before = list(c.iterdump())
        first = report(db)
        cli("seed", "--db", str(db))
        assert list(c.iterdump()) == before
        assert report(db) == first
        RESULTS["seed_repeat_identical_database"] = True
        total = c.execute("SELECT count(*) FROM equipment").fetchone()[0]
        active = c.execute("SELECT count(*) FROM loans WHERE returned_date IS NULL").fetchone()[0]
        returned = c.execute("SELECT count(*) FROM loans WHERE returned_date IS NOT NULL").fetchone()[0]
        borrowers = c.execute("SELECT count(*) FROM borrowers").fetchone()[0]
        overdue = c.execute("""SELECT e.asset_tag,b.name,l.due_date FROM loans l
            JOIN equipment e ON e.id=l.equipment_id JOIN borrowers b ON b.id=l.borrower_id
            WHERE l.returned_date IS NULL AND l.due_date<'2026-10-22'
            ORDER BY l.due_date,e.asset_tag""").fetchall()
        expected = {"as_of": "2026-10-22", "equipment": {"total": total,
                    "available": total-active, "on_loan": active}, "borrowers": borrowers,
                    "loans": {"active": active,"overdue": len(overdue),"returned": returned},
                    "overdue_loans": [{"asset_tag": tag,"borrower_name": name,"due_date": due,
                    "days_overdue": (date(2026,10,22)-date.fromisoformat(due)).days}
                    for tag,name,due in overdue]}
        assert first == expected
        RESULTS["fixed_report_matches_independent_sql"] = expected
        assert c.execute("SELECT count(*) FROM loans WHERE returned_date IS NULL AND due_date='2026-10-22'").fetchone()[0] == 1
        RESULTS["due_today_excluded_from_overdue"] = True
        invalid = cli("report", "--db", str(db), "--as-of", "2026-02-30", "--format", "json", check=False)
        assert invalid.returncode != 0 and invalid.stderr and not invalid.stdout
        RESULTS["invalid_report_date_rejected"] = {"exit": invalid.returncode, "stderr": invalid.stderr.strip()}
        item = c.execute("INSERT INTO equipment(name,asset_tag,category) VALUES('Evaluator drill','EVAL-1','Tools')").lastrowid
        c.commit()
        cli("seed", "--db", str(db))
        assert report(db)["equipment"]["total"] == total+1
        RESULTS["seed_preserves_custom_record_report_is_dynamic"] = True
        barrier = threading.Barrier(2)
        def checkout():
            con=sqlite3.connect(db, timeout=5)
            con.execute("PRAGMA foreign_keys=ON")
            barrier.wait(timeout=3)
            try:
                con.execute("INSERT INTO loans(equipment_id,borrower_id,checkout_date,due_date) VALUES(?,1,'2026-10-22','2026-10-29')",(item,))
                con.commit()
                return "inserted"
            except sqlite3.IntegrityError:
                con.rollback()
                return "conflict"
            finally:
                con.close()
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures=[executor.submit(checkout) for _ in range(2)]
            outcomes=sorted(f.result() for f in futures)
        assert outcomes == ["conflict", "inserted"]
        RESULTS["concurrent_checkout_storage_only"] = outcomes
        for table,column in [("equipment","equipment_id"),("borrowers","borrower_id")]:
            referenced=c.execute(f"SELECT {column} FROM loans WHERE returned_date IS NOT NULL LIMIT 1").fetchone()[0]
            try:
                c.execute(f"DELETE FROM {table} WHERE id=?",(referenced,))
                raise AssertionError("historical reference deletion succeeded")
            except sqlite3.IntegrityError:
                c.rollback()
        RESULTS["history_deletion_guard_storage_only"] = True
        # Probe NULL-valued SQLite date checks; roll back whether accepted or refused.
        try:
            c.execute("INSERT INTO loans(equipment_id,borrower_id,checkout_date,due_date) VALUES((SELECT id FROM equipment WHERE asset_tag='PT-004'),1,'2026-13-01','2026-14-01')")
            RESULTS["invalid_month_storage_rejected"] = False
        except sqlite3.IntegrityError:
            RESULTS["invalid_month_storage_rejected"] = True
        finally:
            c.rollback()
        p,base=launch(db)
        try:
            with urlopen(base+"/api/summary", timeout=3) as response:
                initial_summary=json.load(response)
            for method,url in [("GET","/api/equipment"),("POST","/api/equipment")]:
                try:
                    with urlopen(Request(base+url,method=method,data=b'{}' if method=="POST" else None),timeout=3) as response:
                        status=response.status
                except HTTPError as error:
                    status=error.code
                    error.close()
                RESULTS[f"{method} {url}"] = status
        finally:
            stop(p)
        p,base=launch(db)
        try:
            with urlopen(base+"/api/summary",timeout=3) as response:
                assert json.load(response) == initial_summary
            RESULTS["persistence_across_actual_process_restart"] = True
        finally:
            stop(p)
        c.close()
    (ROOT/"evidence"/"independent-partial.json").write_text(json.dumps(RESULTS,indent=2)+"\n")
    print(json.dumps(RESULTS,indent=2))


if __name__ == "__main__":
    main()
