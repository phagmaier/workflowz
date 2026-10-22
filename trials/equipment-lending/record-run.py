"""Export allowlisted trial facts, never credentials, raw logs or session IDs."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
STATE = "/tmp/workflowz-equipment-trial-cdyf0bhm/state"
RUN = sys.argv[1]
NAME = sys.argv[2]
assert re.fullmatch(r"run_[a-z0-9-]+", RUN)
assert re.fullmatch(r"[a-z0-9-]+", NAME)


def read(*args):
    return json.loads(subprocess.check_output(
        [str(REPO / "bin/wf"), "--state-dir", STATE, "--json", "run", *args],
        cwd=REPO, text=True, timeout=20))


status = read("status", RUN)
events = []
after = 0
while True:
    page = read("events", RUN, "--after", str(after), "--limit", "1000")
    events.extend(page["events"])
    if not page["hasMore"]:
        break
    after = page["nextAfter"]

keys = {"stepId", "kind", "tasks", "total", "runnable", "prechecked", "invocation",
        "harnessVersion", "permissionMode", "exitCode", "timedOut", "failure", "outcome",
        "status", "detail", "from", "to", "decision", "reason", "category", "severity"}
public = []
for event in events:
    value = {k: event[k] for k in ["eventId", "revisionId", "runId", "attemptId", "type", "timestamp"]}
    value["data"] = {k: v for k, v in event["data"].items() if k in keys}
    session = event["data"].get("sessionId")
    if session:
        value["data"]["sessionFingerprint"] = hashlib.sha256(session.encode()).hexdigest()
    public.append(value)

out = {"note": "Allowlisted event facts; session identities hashed, private process/log data omitted.",
       "run": status["run"], "progress": status["progress"], "current": status.get("current"),
       "activeAttempt": status["activeAttempt"]["stepId"] if status["activeAttempt"] else None,
       "events": public}
(ROOT / "evidence" / f"{NAME}-events.json").write_text(json.dumps(out, indent=2) + "\n")
print(json.dumps({"status": status["run"]["status"], "step": status["run"]["cursorStepId"],
                  "progress": status["progress"], "active": out["activeAttempt"], "events": len(public)}))
