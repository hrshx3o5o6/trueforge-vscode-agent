/**
 * run_terminal_command tool: approval-gated, same as propose_edit. Runs
 * in the workspace root, captures stdout/stderr, bounded by a timeout so
 * a hung command can't block a turn forever (B3/A3 resilience concerns).
 */
import { spawn } from "node:child_process";
import { getWorkspaceRoot } from "../workspace.js";

export const COMMAND_TIMEOUT_MS = 30_000;
export const COMMAND_OUTPUT_MAX_CHARS = 4000;

export interface CommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function runTerminalCommand(command: string): Promise<CommandResult> {
  const cwd = getWorkspaceRoot();
  return new Promise((resolve) => {
    const proc = spawn(command, { cwd, shell: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, COMMAND_TIMEOUT_MS);

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: code,
        stdout: stdout.slice(0, COMMAND_OUTPUT_MAX_CHARS),
        stderr: stderr.slice(0, COMMAND_OUTPUT_MAX_CHARS),
        timedOut,
      });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ command, exitCode: null, stdout, stderr: String(err), timedOut: false });
    });
  });
}
