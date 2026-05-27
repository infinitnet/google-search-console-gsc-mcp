import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isCliEntrypoint } from "../entrypoint.js";

test("CLI entrypoint detection accepts symlinked npm bin paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "gsc-mcp-entrypoint-"));
  const realModulePath = fileURLToPath(import.meta.url);
  const linkedBinPath = join(dir, "gsc-mcp");

  try {
    symlinkSync(realModulePath, linkedBinPath);
    assert.equal(isCliEntrypoint(import.meta.url, linkedBinPath), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI entrypoint detection rejects unrelated argv paths", () => {
  assert.equal(isCliEntrypoint(import.meta.url, process.execPath), false);
});

test("published bin target starts through a symlink instead of exiting early", async () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { bin: Record<string, string> };
  const binTarget = packageJson.bin["gsc-mcp"];
  assert.equal(binTarget, "dist/index.js");

  const dir = mkdtempSync(join(tmpdir(), "gsc-mcp-bin-"));
  const realBinPath = join(process.cwd(), binTarget);
  const linkedBinPath = join(dir, "gsc-mcp");

  try {
    symlinkSync(realBinPath, linkedBinPath);
    await assertProcessKeepsRunning("real bin target", realBinPath);
    await assertProcessKeepsRunning("symlinked bin target", linkedBinPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function assertProcessKeepsRunning(label: string, scriptPath: string): Promise<void> {
  const child = spawn(process.execPath, [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });
  let exited = false;
  let exitCode: number | null = null;

  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  const exitedEarly = exited;
  const earlyExitCode = exitCode;

  if (!exitedEarly) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("close", resolve));
  }

  assert.equal(exitedEarly, false, `${label} exited early with code ${earlyExitCode ?? "null"}`);
}
