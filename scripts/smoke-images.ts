// Builds the images the binary smokes run in, from the first mirror of Docker's official
// images that answers: each one rate-limits the pulls of shared CI runners now and then.
//
//   tsx scripts/smoke-images.ts <name>...
//
// Builds .github/smoke/<name>.Dockerfile as midnight-cast-<name>. Exit 0 built, 1 every mirror failed, 2 usage.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const smoke = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "smoke");
// AWS's mirror of Docker's library, then Google's.
const REGISTRIES = ["public.ecr.aws/docker", "mirror.gcr.io"];
const PAUSE_MS = 5_000;

function build(name: string, registry: string): boolean {
  const args = ["build", "--build-arg", `REGISTRY=${registry}`, "-t", `midnight-cast-${name}`, "-f", join(smoke, `${name}.Dockerfile`), smoke];
  return spawnSync("docker", args, { stdio: "inherit" }).status === 0;
}

async function buildFromAnyMirror(name: string): Promise<boolean> {
  for (const [i, registry] of REGISTRIES.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    if (build(name, registry)) return true;
    console.error(`midnight-cast-${name}: building from ${registry} failed`);
  }
  return false;
}

const names = process.argv.slice(2);
if (!names.length) {
  console.error("Usage: tsx scripts/smoke-images.ts <name>...");
  process.exitCode = 2;
} else {
  for (const name of names) {
    if (!(await buildFromAnyMirror(name))) {
      process.exitCode = 1;
      break;
    }
  }
}
