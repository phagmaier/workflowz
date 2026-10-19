/** Same selection at both owned boundaries: runner -> bridge -> private server. */
import { childEnvironment } from "./environment.js";

const NAMES = [
  "XDG_CACHE_HOME",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_CONFIG",
  "OPENCODE_DB",
  "OPENCODE_DISABLE_MODELS_FETCH",
  "OPENCODE_MODELS_PATH",
  "OPENCODE_CONFIG_PROJECT_DISABLE",
  "OPENCODE_DISABLE_CLAUDE_CODE",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

export function openCodeEnvironment(
  source: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  const selected: Record<string, string> = {};
  for (const name of NAMES) if (source[name] !== undefined) selected[name] = source[name];
  return childEnvironment({ ...selected, ...overrides }, source);
}
