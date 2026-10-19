import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "../test-support/paths.js";
import { previewMarkdownTasks } from "./task-import.js";

function preview(markdown: string, includeCompleted = false) {
  return previewMarkdownTasks({ sourcePath: "/project/todo.md", markdown, includeCompleted });
}

describe("Markdown checklist snapshot", () => {
  it("preserves source order, nested tasks, heading ancestry and original positions", () => {
    const result = preview(
      "# Project\n\n## Work\n- [ ] parent\n  continuation **text**\n    - [ ] child one\n    * [x] child two\n\n### Later\n* [X] already done\n* [ ] last\n",
    );
    assert.deepEqual(
      result.tasks.map((t) => [
        t.title,
        t.sourceLine,
        t.sourceColumn,
        t.sourceIndent,
        t.sourceChecked,
      ]),
      [
        ["parent", 4, 1, 0, false],
        ["child one", 6, 5, 4, false],
        ["child two", 7, 5, 4, true],
        ["already done", 10, 1, 0, true],
        ["last", 11, 1, 0, false],
      ],
    );
    assert.deepEqual(
      result.runnable.map((t) => t.sourceOrder),
      [0, 1, 4],
    );
    assert.deepEqual(result.tasks[0]?.headingPath, ["Project", "Work"]);
    assert.deepEqual(result.tasks[4]?.headingPath, ["Project", "Work", "Later"]);
    assert.equal(result.tasks[0]?.body, "  continuation **text**");
    assert.equal(result.tasks[1]?.sourceIdentity, "/project/todo.md:6");
    assert.deepEqual([result.total, result.prechecked, result.runnableCount], [5, 2, 3]);
  });

  it("explicitly includes prechecked tasks as runnable without losing original completion state", () => {
    const result = preview("- [x] checked\n- [ ] open", true);
    assert.equal(result.runnableCount, 2);
    assert.equal(result.runnable[0]?.sourceChecked, true);
  });

  it("ignores fenced and standalone indented code, and preserves task code in the body", () => {
    const result = preview(
      "```md\n- [ ] fenced\n```\n    - [ ] indented code\n\n- [ ] real\n  ~~~md\n  - [ ] code in task\n  ~~~\n- [ ] another\n",
    );
    assert.deepEqual(
      result.tasks.map((t) => t.title),
      ["real", "another"],
    );
    assert.match(result.tasks[0]?.body ?? "", /code in task/);
  });

  it("supports CRLF, tabs, setext headings and heading replacement without mutating the input", () => {
    const markdown =
      "\uFEFFProject\r\n=======\r\n\r\nWork\r\n----\r\n- [ ] **first**\r\n\t- [ ] nested\r\n# Other\r\n- [ ] last\r\n";
    const result = preview(markdown);
    assert.deepEqual(result.tasks[0]?.headingPath, ["Project", "Work"]);
    assert.equal(result.tasks[1]?.sourceIndent, 4);
    assert.deepEqual(result.tasks[2]?.headingPath, ["Other"]);
    assert.equal(preview(markdown).tasks[0]?.title, "**first**");
  });

  it("does not interpret plain bullets or non-checkbox syntax as tasks", () => {
    assert.equal(preview("# Title\n- bullet\n- [yes] no\ntext\n").total, 0);
    assert.equal(preview("").runnableCount, 0);
  });

  it("imports the shipped task example with one prechecked item excluded", () => {
    const result = preview(readFileSync(path.join(REPO_ROOT, "examples", "tasks.md"), "utf8"));
    assert.deepEqual([result.total, result.prechecked, result.runnableCount], [8, 1, 7]);
    assert.deepEqual(result.tasks[0]?.headingPath, ["Example Web App Tasks", "Foundation"]);
  });
});
