export function computeDelta(rpcHeight: number, indexerHeight: number): number {
  return rpcHeight - indexerHeight;
}

export function tipExitCode(
  delta: number,
  threshold: number,
  failOnLag = false,
): number {
  if (!failOnLag) return 0;
  return Math.abs(delta) >= threshold ? 1 : 0;
}
