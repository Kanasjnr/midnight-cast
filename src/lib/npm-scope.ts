import { loadDataJson } from "./data-path.js";

export const OLD_SCOPE = "@midnight-ntwrk/";
export const NEW_SCOPE = "@midnightntwrk/";

interface ScopeData {
  checked: string;
  migrated: string[];
}

export function isMidnightPackage(name: string): boolean {
  return name.startsWith(OLD_SCOPE) || name.startsWith(NEW_SCOPE);
}

export function packageBaseName(name: string): string | undefined {
  if (name.startsWith(OLD_SCOPE)) return name.slice(OLD_SCOPE.length);
  if (name.startsWith(NEW_SCOPE)) return name.slice(NEW_SCOPE.length);
  return undefined;
}

export function loadMigratedPackages(): Set<string> {
  return new Set(loadDataJson<ScopeData>("npm-scope.json").migrated);
}
