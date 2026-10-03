export function computeDelta(rpcHeight: number, indexerHeight: number): number {
  return rpcHeight - indexerHeight;
}

export function describeLag(delta: number, threshold: number): string {
  const direction = delta > 0 ? "behind" : "ahead of";
  return `Indexer is ${Math.abs(delta)} blocks ${direction} the node (threshold ${threshold})`;
}

export function tipExitCode(
  delta: number,
  threshold: number,
  failOnLag = false,
): number {
  if (!failOnLag) return 0;
  return Math.abs(delta) >= threshold ? 1 : 0;
}
