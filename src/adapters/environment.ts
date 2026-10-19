/**
 * The only environment a child process inherits (spec §2.4, architecture §4). Everything else in
 * the runner's environment, including credentials and harness-specific variables, is withheld.
 * Workflow `env` entries are added on top of this base and nothing else.
 */
const BASE_NAMES = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "USER",
  "LOGNAME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
] as const;

export function childEnvironment(
  overrides: Readonly<Record<string, string>> = {},
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of BASE_NAMES) {
    const value = source[name];
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return { ...env, ...overrides };
}
