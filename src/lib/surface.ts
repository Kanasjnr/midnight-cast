import { AsyncLocalStorage } from "node:async_hooks";

// Messages that name CLI flags read differently to an agent calling MCP tools, which has none.
const mcpCall = new AsyncLocalStorage<true>();

export function runAsMcpCall<T>(work: () => T): T {
  return mcpCall.run(true, work);
}

export function inMcpCall(): boolean {
  return mcpCall.getStore() === true;
}
