// Synthetic leaks only, deliberately independent of the production redactor's implementation.
export async function boundaryEvidence(config) {
  if (!config.options.boundary) return;
  const values = Object.entries(process.env)
    .filter(([name]) => /KEY|TOKEN|PASSWORD|SECRET/.test(name))
    .map(([, value]) => value);
  const provider = Object.entries(process.env).find(
    ([name]) => name !== "WF_REPORT_TOKEN" && /KEY|TOKEN/.test(name),
  )?.[1];
  if (provider && process.env.WF_REPORT_ENDPOINT) {
    const response = await fetch(process.env.WF_REPORT_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WF_REPORT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        outcome: "complete",
        summary: Buffer.from(provider).toString("base64"),
      }),
    });
    await response.arrayBuffer();
    if (response.status !== 422)
      throw new Error("injected credential was not rejected in report content");
    process.stderr.write("credential submission rejected: 422\n");
  }
  values.push(...(config.options.retiredSecrets ?? []));
  if (process.env.OPENCODE_PASSWORD)
    values.push(Buffer.from(`opencode:${process.env.OPENCODE_PASSWORD}`).toString("base64"));
  process.stderr.write("offline boundary diagnostic: retained🙂\n");
  for (const value of values) {
    const forms = [
      value,
      encodeURIComponent(value),
      Buffer.from(value).toString("base64"),
      Buffer.from(value).toString("base64url"),
      `Bearer ${value}`,
    ];
    for (const form of forms) {
      const line = Buffer.from(`${JSON.stringify({ type: "boundary_evidence", text: form })}\n`);
      process.stdout.write(line.subarray(0, 17));
      process.stderr.write(line.subarray(0, 23));
      await new Promise((resolve) => setImmediate(resolve));
      process.stdout.write(line.subarray(17));
      process.stderr.write(line.subarray(23));
    }
  }
  if (config.options.boundaryLarge) {
    process.stderr.write("diagnostic padding\n".repeat(5000));
    process.stdout.write(
      `${JSON.stringify({ type: "boundary_evidence", text: "x".repeat(70000) })}\n`,
    );
  }
}
