import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCommand, parseCommand } from "./command-line.ts";

test("command entry groups quoted arguments, escapes spaces, and preserves empty arguments", () => {
  assert.deepEqual(parseCommand("node --version"), { argv: ["node", "--version"], error: null });
  assert.deepEqual(parseCommand(`node 'some file.js' "hello world" one\\ two '' pre"fix"`), {
    argv: ["node", "some file.js", "hello world", "one two", "", "prefix"],
    error: null,
  });
  assert.deepEqual(parseCommand('echo "C:\\tools\\file"'), {
    argv: ["echo", "C:\\tools\\file"],
    error: null,
  });
  assert.deepEqual(parseCommand("echo one\\\ntwo"), { argv: ["echo", "onetwo"], error: null });
});

test("command formatting round trips arbitrary argument content without expansion", () => {
  const argv = [
    "node",
    "",
    "with spaces",
    "apostrophe's",
    'a"b',
    "a\\b",
    "$HOME",
    "$(echo danger)",
    "|",
    "&&",
    ";",
    "#literal",
    "{{task.text}}",
    "line\nbreak",
    "tabs\there",
    "文 unicode",
    "trailing\\",
    "'\"\\",
  ];
  assert.deepEqual(parseCommand(formatCommand(argv)), { argv, error: null });
  assert.equal(formatCommand(["node", "--version"]), "node --version");
  assert.deepEqual(parseCommand(""), { argv: [], error: null });
  assert.deepEqual(parseCommand("echo $HOME"), { argv: ["echo", "$HOME"], error: null });
});

test("incomplete command entry and implicit shell operators are rejected without guessing arguments", () => {
  for (const text of [
    "node 'unfinished",
    'node "unfinished',
    "node final\\",
    "npm test && npm run build",
    "cat | sort",
    "echo > file",
    "echo ; echo",
  ]) {
    const parsed = parseCommand(text);
    assert.equal(parsed.argv, null, text);
    assert.ok(parsed.error, text);
  }
  assert.deepEqual(parseCommand("sh -c 'npm test && npm run build'"), {
    argv: ["sh", "-c", "npm test && npm run build"],
    error: null,
  });
});
