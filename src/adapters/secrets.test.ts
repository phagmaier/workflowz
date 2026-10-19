import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { environmentSecrets, SecretFilter, scrubSecrets } from "./secrets.js";

function filtered(input: Buffer, secrets: readonly string[], cuts: readonly number[]): Buffer {
  const chunks: Buffer[] = [];
  const filter = new SecretFilter(secrets, (chunk) => chunks.push(chunk));
  let start = 0;
  for (const end of [...cuts, input.length]) {
    filter.push(input.subarray(start, end));
    start = end;
  }
  filter.end();
  return Buffer.concat(chunks);
}

describe("known-secret scrubbing", () => {
  const secret = 'synthetic-"key\\/ +🙂';
  const basic = Buffer.from(`opencode:${secret}`).toString("base64");
  const forms = [
    secret,
    JSON.stringify(secret).slice(1, -1),
    encodeURIComponent(secret),
    encodeURIComponent(secret).replace(/%[A-F0-9]{2}/g, (v) => v.toLowerCase()),
    new URLSearchParams({ v: secret }).toString().slice(2),
    Buffer.from(secret).toString("base64"),
    Buffer.from(secret).toString("base64url"),
    `Basic ${basic}`,
    `Bearer ${secret}`,
  ];
  for (const [index, form] of forms.entries()) {
    it(`scrubs credential representation ${index} across every byte boundary`, () => {
      const input = Buffer.from(`before🙂 ${form} after🙂`);
      const expected = Buffer.from(
        `before🙂 ${form.startsWith("Basic ") ? "Basic " : form.startsWith("Bearer ") ? "Bearer " : ""}[redacted] after🙂`,
      );
      for (let cut = 0; cut <= input.length; cut++)
        assert.deepEqual(filtered(input, [secret, basic], [cut]), expected);
      assert.deepEqual(filtered(input, [secret, basic], Array.from(input.keys())), expected);
    });
  }

  it("masks overlapping values in either order without matching replacements", () => {
    const input = Buffer.from("safe abcdef safe redacted safe");
    for (const secrets of [
      ["abc", "bcdef", "redacted"],
      ["redacted", "bcdef", "abc"],
    ])
      assert.equal(
        filtered(input, secrets, Array.from(input.keys())).toString(),
        "safe [redacted] safe [redacted] safe",
      );
  });

  it("preserves arbitrary evidence bytes and UTF-8 when a retained suffix splits a code point", () => {
    const input = Buffer.concat([Buffer.from("🙂 visible 🙂"), Buffer.from([0xff, 0, 0xfe])]);
    assert.deepEqual(filtered(input, ["unrelated"], Array.from(input.keys())), input);
    assert.deepEqual(filtered(input, [""], [1, 3]), input);
  });

  it("emits whole UTF-8 code points before streams can be multiplexed", () => {
    const input = Buffer.from("🙂 safe 🙂 words 🙂 credential 🙂");
    const chunks: Buffer[] = [];
    const filter = new SecretFilter(["credential"], (chunk) => {
      new TextDecoder("utf8", { fatal: true }).decode(chunk);
      chunks.push(chunk);
    });
    for (const byte of input) filter.push(Buffer.from([byte]));
    filter.end();
    assert.equal(Buffer.concat(chunks).toString(), "🙂 safe 🙂 words 🙂 [redacted] 🙂");
  });

  it("keeps harmless prefixes and incomplete credentials at EOF", () => {
    assert.equal(
      scrubSecrets("safe synthetic-cred", ["synthetic-credential"]),
      "safe synthetic-cred",
    );
  });

  it("selects injected credentials and URL authorization without treating configuration paths as secrets", () => {
    const secrets = environmentSecrets({
      OPENAI_API_KEY: "synthetic-key",
      WF_REPORT_TOKEN: "synthetic-token",
      OMP_AUTH_BROKER_URL: "https://user:p%40ss@example.test",
      OPENCODE_CONFIG: "/config/settings.json",
    });
    for (const value of ["synthetic-key", "synthetic-token", "p%40ss", "p@ss"])
      assert.ok(secrets.includes(value));
    assert.ok(!secrets.includes("user"));
    assert.ok(!secrets.includes("/config/settings.json"));
    const basic = Buffer.from("user:p@ss").toString("base64");
    assert.equal(
      scrubSecrets(`Authorization: Basic ${basic}`, secrets),
      "Authorization: Basic [redacted]",
    );
  });
});
