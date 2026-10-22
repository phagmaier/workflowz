/** Quote an explicit argument vector for editing. No expansion or shell execution is involved. */
export function formatCommand(argv: readonly string[]): string {
  return argv
    .map((arg) =>
      /^[a-zA-Z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`,
    )
    .join(" ");
}

/** Shell-style grouping and escaping, without expansion. Shell operators need an explicit shell. */
export function parseCommand(
  text: string,
): { argv: string[]; error: null } | { argv: null; error: string } {
  const argv: string[] = [];
  let token = "";
  let started = false;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    if (quote === "'") {
      if (char === "'") quote = "";
      else token += char;
      continue;
    }
    if (char === "\\") {
      const next = text[++i];
      if (next === undefined)
        return { argv: null, error: "Finish the escape after the final backslash." };
      if (next === "\n") continue;
      token += quote === '"' && !['"', "\\", "$", "`"].includes(next) ? `\\${next}` : next;
      started = true;
    } else if (quote === '"') {
      if (char === '"') quote = "";
      else token += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) argv.push(token);
      token = "";
      started = false;
    } else if (/[|&;<>]/.test(char)) {
      return {
        argv: null,
        error:
          "Shell operators need an explicit shell. Use sh -c 'your script', or quote a literal argument.",
      };
    } else {
      token += char;
      started = true;
    }
  }
  if (quote)
    return { argv: null, error: `Close the ${quote === "'" ? "single" : "double"} quote.` };
  if (started) argv.push(token);
  return { argv, error: null };
}
