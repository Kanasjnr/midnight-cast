export function normalizeArgv(argv: readonly string[]): string[] {
  const args = [...argv];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "jsonrpc") continue;
    const next = args[i + 1];
    if (next !== undefined && /^-\d+$/.test(next)) {
      args.splice(i + 1, 1, `--code=${next}`);
    }
    break;
  }
  return args;
}
