/** Discovery is private local authority, never an environment variable inherited by attempts. */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { daemonAccessSchema } from "../contracts/management.js";

export function stateDirectory(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  const selected =
    explicit ??
    env["WF_STATE_DIR"] ??
    path.join(env["XDG_STATE_HOME"] || path.join(homedir(), ".local", "state"), "workflowz");
  if (!selected.trim()) throw new Error("state directory must not be blank");
  return path.resolve(selected);
}

export function privateStateDirectory(directory: string, create = false): string {
  if (create) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const resolved = realpathSync(directory);
  const stats = lstatSync(resolved);
  if (!stats.isDirectory() || stats.uid !== process.getuid?.() || (stats.mode & 0o077) !== 0)
    throw new Error("state directory must be owned by the current user with mode 0700");
  return resolved;
}

export function readDaemonAccess(directory: string) {
  const dir = privateStateDirectory(directory);
  const fd = openSync(path.join(dir, "daemon.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = fstatSync(fd);
    if (
      !stats.isFile() ||
      stats.uid !== process.getuid?.() ||
      (stats.mode & 0o077) !== 0 ||
      stats.size > 4096
    )
      throw new Error("daemon discovery must be an owner-only regular file");
    return daemonAccessSchema.parse(JSON.parse(readFileSync(fd, "utf8")));
  } finally {
    closeSync(fd);
  }
}
