"""Evaluator-owned bounded command checks; contains no sample application implementation."""
import json
import contextlib
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def run(*args):
    result = subprocess.run(args, check=False, text=True, capture_output=True, timeout=75)
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    if result.stdout:
        print(result.stdout, end="")
    result.check_returncode()
    return result.stdout


def main():
    stage = sys.argv[1]
    assert stage in ("foundation", "slice", "acceptance")
    assert Path("tests").is_dir(), "tests/ must exist"
    import unittest
    suite = unittest.defaultTestLoader.discover("tests")
    assert suite.countTestCases() > 0, "zero tests is not a passing check"
    run(sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v")
    if stage == "slice":
        return
    Path("var").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="command-check-", dir="var") as temporary:
        db = os.environ.get("LENDING_DEMO_DB") if stage == "acceptance" else None
        db = db or str(Path(temporary) / "check.sqlite")
        run(sys.executable, "-m", "lending", "seed", "--db", db)
        args = (sys.executable, "-m", "lending", "report", "--db", db,
                "--as-of", os.environ.get("LENDING_AS_OF", "2026-10-22"), "--format", "json")
        first = json.loads(run(*args))
        run(sys.executable, "-m", "lending", "seed", "--db", db)
        assert first == json.loads(run(*args)), "repeated seed changed fixed-date report"
        assert first.get("as_of") == "2026-10-22", "report as_of missing or incorrect"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        proc = subprocess.Popen([sys.executable, "-m", "lending", "serve", "--db", db,
                                 "--host", "127.0.0.1", "--port", str(port)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 12
            while True:
                assert proc.poll() is None, "sample server exited before readiness"
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as response:
                        assert response.status == 200
                        assert response.read(1048576), "empty browser entry point"
                    break
                except (urllib.error.URLError, TimeoutError):
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(.15)
            print("serve: HTTP 200; repeat seed/report: stable")
        finally:
            if proc.poll() is None:
                proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
        if stage == "acceptance":
            Path("artifacts").mkdir(exist_ok=True)
            Path("artifacts/acceptance-report.json").write_text(json.dumps(first, indent=2) + "\n")


if __name__ == "__main__":
    import traceback
    class Tee:
        def __init__(self, stream, file):
            self.stream, self.file = stream, file
        def write(self, value):
            self.stream.write(value)
            self.file.write(value)
            self.file.flush()
        def flush(self):
            self.stream.flush()
            self.file.flush()
    Path("artifacts").mkdir(exist_ok=True)
    stage = sys.argv[1] if len(sys.argv) == 2 else "invalid"
    assert stage in ("foundation", "slice", "acceptance")
    with Path(f"artifacts/command-{stage}.log").open("w") as log:
        with contextlib.redirect_stdout(Tee(sys.stdout, log)), contextlib.redirect_stderr(Tee(sys.stderr, log)):
            try:
                main()
            except Exception:
                traceback.print_exc()
                sys.exit(1)
