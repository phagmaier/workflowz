import { parseSmokeSelection, runHarnessSmoke, smokePlan } from "./harness-smoke.js";

if (process.argv.slice(2).includes("--help")) {
  console.log(`Opt-in authenticated harness smoke (may incur provider charges).
Usage: npm run smoke:harnesses -- --harness <codex|pi|claude|opencode|omp> --model <explicit-selector> --scenario <report|correction> --timeout-seconds <1..300> --artifacts-dir <absolute-parent> [--reasoning-effort <level>] [--execute]
Without --execute: prints the plan only; no probes, authentication checks or provider calls.
report: one invocation, no automatic correction. correction: deliberately omit the first report, then one exact-session follow-up (maximum 30 seconds).
Normal HOME/config/auth/resource discovery and existing unrestricted permission modes are preserved. This is NOT isolation. No reliable dollar cap. Logs/SQLite/evidence remain under a unique artifact directory; settled target projects are removed. Harness-owned state is not rewritten or removed.
SIGINT/SIGTERM request stop through RunService and await process settlement. Uncertain cleanup preserves the target project for inspection.`);
} else {
  const controller = new AbortController();
  const stop = () => controller.abort();
  try {
    const selection = parseSmokeSelection(process.argv.slice(2));
    if (!selection.execute) console.log(JSON.stringify(smokePlan(selection), null, 2));
    else {
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      const evidence = await runHarnessSmoke(selection, { signal: controller.signal });
      console.log(JSON.stringify(evidence, null, 2));
      process.exitCode = evidence.category === "passed" ? 0 : 1;
    }
  } catch {
    console.error(
      "Smoke admission or artifact I/O failed; see --help. No successful live verification is claimed.",
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
