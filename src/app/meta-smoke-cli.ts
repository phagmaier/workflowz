import {
  MetaCredentialError,
  metaSmokePlan,
  parseMetaSmokeSelection,
  runMetaSmoke,
} from "./meta-smoke.js";

if (process.argv.slice(2).includes("--help")) {
  console.log(`Opt-in Meta Contributor smoke; provider usage is billed and content may be used for training.
Usage: npm run smoke:meta -- --harness <omp|opencode> --scenario <report|correction> --timeout-seconds <1..300> --artifacts-dir <absolute-parent> [--execute]
Pinned account selection: meta/muse-spark-1.3-contributor, low reasoning.
Credential: MUSE_SPARK_API_KEY literal assignment in ~/.config/secrets.zsh (owner-only file). Only this assignment is loaded, without sourcing shell code or displaying the key. It is mapped to MODEL_API_KEY for the selected adapter, never argv/configuration.
Without --execute: plan only; no secret reads, probes, authentication checks, provider calls or smoke artifacts. npm still builds first.
Execution reuses smoke:harnesses acknowledgment, exact-session correction, settlement, SQLite reopen, interruption and cleanup assertions. Originals use the selected timeout; corrections at most 30 seconds. No runner retries or enforceable dollar cap.
OpenCode gets a credential-free Meta Responses provider in the disposable target only. Normal HOME/config/resources and unrestricted permissions remain enabled; this is NOT isolation. Private logs/SQLite/evidence remain; do not publish raw artifacts. Global configuration is unchanged.`);
} else {
  const controller = new AbortController();
  const stop = () => controller.abort();
  try {
    const selection = parseMetaSmokeSelection(process.argv.slice(2));
    if (!selection.execute) console.log(JSON.stringify(metaSmokePlan(selection), null, 2));
    else {
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      const evidence = await runMetaSmoke(selection, { signal: controller.signal });
      console.log(JSON.stringify(evidence, null, 2));
      process.exitCode = evidence.category === "passed" ? 0 : 1;
    }
  } catch (error) {
    console.error(
      error instanceof MetaCredentialError
        ? error.message
        : "Meta smoke admission or artifact I/O failed; see --help. No successful live verification is claimed.",
    );
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}
