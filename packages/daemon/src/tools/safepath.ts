import { resolve, relative } from "path";

/**
 * Resolves a file path and ensures it stays within the allowed workDir.
 * Throws if the resolved path escapes the sandbox.
 */
export function resolveSafePath(filePath: string, workDir: string): string {
  const resolved = resolve(workDir, filePath);
  const rel = relative(workDir, resolved);

  if (rel.startsWith("..") || resolve(workDir, rel) !== resolved) {
    throw new Error(`Path "${filePath}" escapes the working directory`);
  }

  return resolved;
}
