import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isCliEntrypoint(moduleUrl: string, argvPath = process.argv[1]): boolean {
  if (!argvPath) return false;

  try {
    const modulePath = realpathSync(fileURLToPath(moduleUrl));
    const invokedPath = realpathSync(resolve(argvPath));
    return modulePath === invokedPath;
  } catch {
    return false;
  }
}
