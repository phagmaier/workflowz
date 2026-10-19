/** Read-only Markdown checklist parsing. Nesting is metadata, never a dependency or subgraph. */
export interface TaskImportSnapshot {
  readonly sourcePath: string;
  readonly markdown: string;
  readonly includeCompleted: boolean;
}
export interface ImportedTask {
  readonly sourceOrder: number;
  readonly sourceIdentity: string;
  readonly sourceLine: number;
  readonly sourceColumn: number;
  readonly sourceChecked: boolean;
  readonly sourceIndent: number;
  readonly title: string;
  readonly body: string;
  readonly headingPath: readonly string[];
}
export interface TaskImportPreview {
  readonly tasks: readonly ImportedTask[];
  readonly runnable: readonly ImportedTask[];
  readonly total: number;
  readonly prechecked: number;
  readonly runnableCount: number;
}

export function previewMarkdownTasks(snapshot: TaskImportSnapshot): TaskImportPreview {
  const tasks: ImportedTask[] = [];
  const headings: { level: number; title: string }[] = [];
  const lines = snapshot.markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  let fence: { char: string; length: number } | undefined;
  let listRootIndent: number | undefined;
  let current: { task: ImportedTask; lines: string[] } | undefined;
  const flush = () => {
    if (current)
      tasks.push({ ...current.task, body: current.lines.join("\n").replace(/^\n+|\n+$/g, "") });
    current = undefined;
  };
  const heading = (level: number, title: string) => {
    flush();
    listRootIndent = undefined;
    while ((headings.at(-1)?.level ?? 0) >= level) headings.pop();
    headings.push({ level, title });
  };
  const indent = (prefix: string) =>
    [...prefix].reduce((n, c) => (c === "\t" ? n + 4 - (n % 4) : n + 1), 0);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (current) current.lines.push(line);
      if (marker?.[1]?.[0] === fence.char && marker[1].length >= fence.length && !marker[2]?.trim())
        fence = undefined;
      continue;
    }
    if (marker?.[1]) {
      fence = { char: marker[1][0] ?? "`", length: marker[1].length };
      if (current) current.lines.push(line);
      continue;
    }
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
    if (atx) {
      heading(atx[1]?.length ?? 1, (atx[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim());
      continue;
    }
    if (
      line.trim() &&
      /^ {0,3}(?:=+|-+)\s*$/.test(lines[index + 1] ?? "") &&
      !/^\s*[-*]\s/.test(line)
    ) {
      heading((lines[index + 1] ?? "").trim()[0] === "=" ? 1 : 2, line.trim());
      index += 1;
      continue;
    }
    const checkbox = /^([ \t]*)[-*][ \t]+\[([ xX])\](?:[ \t]+(.*)|[ \t]*)$/.exec(line);
    if (
      checkbox &&
      (indent(checkbox[1] ?? "") < 4 ||
        (listRootIndent !== undefined && indent(checkbox[1] ?? "") > listRootIndent))
    ) {
      if (indent(checkbox[1] ?? "") < 4) listRootIndent = indent(checkbox[1] ?? "");
      const sourceOrder = tasks.length + (current ? 1 : 0);
      flush();
      current = {
        task: {
          sourceOrder,
          sourceIdentity: `${snapshot.sourcePath}:${index + 1}`,
          sourceLine: index + 1,
          sourceColumn: (checkbox[1]?.length ?? 0) + 1,
          sourceChecked: checkbox[2]?.toLowerCase() === "x",
          sourceIndent: indent(checkbox[1] ?? ""),
          title: checkbox[3] ?? "",
          body: "",
          headingPath: headings.map((h) => h.title),
        },
        lines: [],
      };
      continue;
    }
    if (current) {
      if (!line.trim() || indent(/^[ \t]*/.exec(line)?.[0] ?? "") > current.task.sourceIndent)
        current.lines.push(line);
      else {
        flush();
        listRootIndent = undefined;
      }
    }
  }
  flush();
  const runnable = tasks.filter((task) => snapshot.includeCompleted || !task.sourceChecked);
  return {
    tasks,
    runnable,
    total: tasks.length,
    prechecked: tasks.filter((task) => task.sourceChecked).length,
    runnableCount: runnable.length,
  };
}
