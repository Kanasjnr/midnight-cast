import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadDataJson<T>(filename: string): T {
  const dir = dirname(fileURLToPath(import.meta.url));
  const path = join(dir, "..", "data", filename);
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
