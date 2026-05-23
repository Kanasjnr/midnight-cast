export function computeDelta(rpcHeight: number, indexerHeight: number): number {
  return rpcHeight - indexerHeight;
}

export function tipExitCode(
  delta: number,
  threshold: number,
): number {
  return Math.abs(delta) >= threshold ? 1 : 0;
}
