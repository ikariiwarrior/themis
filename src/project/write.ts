import { chmod, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export async function atomicWrite(path: string, contents: string, fallbackMode?: number): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let mode = fallbackMode;
  try {
    mode = (await stat(path)).mode;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || mode === undefined) throw error;
  }
  try {
    await writeFile(temporary, contents, "utf8");
    await chmod(temporary, mode ?? 0o600);
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
