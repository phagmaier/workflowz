// Offline fault injection for the existing synthetic CLIs; never used by production adapters.
export function probeReply(config, args, text) {
  const key = args.includes("--version")
    ? "version"
    : (args.find((a) => ["resume", "serve", "run", "session"].includes(a)) ?? "help");
  for (const marker of config.options.probe?.omit ?? []) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(?<!\\S)${escaped}(?=\\s|[=<,]|$)`, "g"), "");
  }
  process.stdout.write(`${text}\n`);
  if (config.options.probe?.oversize?.includes(key))
    process.stdout.write("x".repeat(5 * 1024 * 1024));
  // Flush oversized pipe output before exit so truncation is a real supervisor observation.
  process.stdout.write("", () => process.exit(config.options.probe?.fail?.[key] ?? 0));
}
