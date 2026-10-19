/** Prints the installed-harness compatibility table. Informational: always exits 0. */
import { probeHarnesses } from "./probe.js";

const results = await probeHarnesses();
const rows = results.map((result) => ({
  harness: result.id,
  installed: result.installed ? "yes" : "no",
  version: result.version ?? "-",
  help:
    result.installed && result.missingMarkers.length === 0
      ? "all markers present"
      : (result.problem ?? "-"),
}));

const widths = {
  harness: Math.max("harness".length, ...rows.map((row) => row.harness.length)),
  installed: Math.max("installed".length, ...rows.map((row) => row.installed.length)),
  version: Math.max("version".length, ...rows.map((row) => row.version.length)),
};
const line = (row: { harness: string; installed: string; version: string; help: string }) =>
  `${row.harness.padEnd(widths.harness)}  ${row.installed.padEnd(widths.installed)}  ${row.version.padEnd(widths.version)}  ${row.help}`;

console.log(
  line({ harness: "harness", installed: "installed", version: "version", help: "help probe" }),
);
for (const row of rows) {
  console.log(line(row));
}
