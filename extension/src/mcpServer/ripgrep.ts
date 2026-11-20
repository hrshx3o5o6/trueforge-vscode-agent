/**
 * Locates a ripgrep binary. VS Code ships its own copy (used by its
 * search view), so we prefer that over whatever is on PATH: a judge's
 * machine is not guaranteed to have `rg` installed, and a shell alias
 * named `rg` is invisible to child_process.spawn.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

let cachedPath: string | undefined;

function candidatePaths(): string[] {
  const exe = process.platform === "win32" ? "rg.exe" : "rg";
  const out: string[] = [];
  try {
    const vscode = require("vscode") as typeof import("vscode");
    const root = vscode.env.appRoot;
    const platformDir = `${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;
    for (const modules of ["node_modules.asar.unpacked", "node_modules"]) {
      // Newer VS Code builds ship a multi-arch package with per-platform dirs.
      out.push(path.join(root, modules, "@vscode/ripgrep-universal", "bin", platformDir, exe));
      for (const pkg of ["@vscode/ripgrep", "vscode-ripgrep"]) {
        out.push(path.join(root, modules, pkg, "bin", exe));
      }
    }
  } catch {
    // Not running inside VS Code (e.g. a unit test) — PATH lookup only.
  }
  return out;
}

export function ripgrepPath(): string {
  if (cachedPath) {return cachedPath;}
  cachedPath = candidatePaths().find((p) => fs.existsSync(p)) ?? "rg";
  return cachedPath;
}

/** Runs ripgrep and resolves with stdout. Exit code 1 (no matches) is not an error. */
export function runRipgrep(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ripgrepPath(), args, { cwd });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) =>
      reject(new Error(`ripgrep could not be started (${ripgrepPath()}): ${err.message}`)),
    );
    proc.on("close", (code) => {
      if (code === 0 || code === 1) {resolve(stdout);}
      else {reject(new Error(stderr || `ripgrep exited with code ${code}`));}
    });
  });
}
