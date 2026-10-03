import { describe, expect, it } from "vitest";
import { compare, deployedNodeTag, hasDrift, parseCodeTable } from "../scripts/error-code-parity.js";

const NODE_SOURCE = `
  LedgerApiError::Deserialization(error) => match error {
    DeserializationError::NetworkId => 0,
    DeserializationError::LedgerState => 2,
  },
  MalformedError::NotNormalized => 117,
  InvalidError::ReplayProtectionViolation(rpv) => 193,
  MalformedError::Zswap(z) => match z {
    MalformedZswapErrorCode::Unknown => 127,
  },
`;

const expert = (code: string, name: string, description = "") => ({ code, name, source: "midnight-node", description });

describe("error code parity", () => {
  it("reads the node's LedgerApiError table", () => {
    expect([...parseCodeTable(NODE_SOURCE)]).toEqual([
      [0, ["NetworkId"]],
      [2, ["LedgerState"]],
      [117, ["NotNormalized"]],
      [193, ["ReplayProtectionViolation"]],
      [127, ["Unknown"]],
    ]);
  });

  it("accepts the type name for a prefixed (de)serialization variant", () => {
    const node = new Map([[2, ["DeserializationLedgerState"]]]);
    expect(hasDrift(compare({ "2": { name: "LedgerState" } }, node, [], "node-1"))).toBe(false);
  });

  it("reports codes missing from the map, extra codes and renames", () => {
    const node = new Map([
      [0, ["NetworkId"]],
      [117, ["NotNormalized"]],
    ]);
    const report = compare({ "0": { name: "NetworkIdentifier" }, "5": { name: "Gone" } }, node, [], "node-1");
    expect(report.missing).toEqual([{ code: 117, names: ["NotNormalized"] }]);
    expect(report.extra).toEqual([{ code: 5, name: "Gone" }]);
    expect(report.renamed).toEqual([{ code: 0, ours: "NetworkIdentifier", node: ["NetworkId"] }]);
    expect(hasDrift(report)).toBe(true);
  });

  it("fails on a Midnight Expert name conflict but only notes retired and undeployed codes", () => {
    const node = new Map([
      [117, ["NotNormalized"]],
      [193, ["ReplayProtectionViolation"]],
    ]);
    const ours = { "117": { name: "NotNormalized" }, "193": { name: "ReplayProtectionViolation" } };
    const notes = compare(
      ours,
      node,
      [expert("193", "ReplayProtectionViolation", "[RETIRED in current ledger] ..."), expert("242", "IntentTtlExpired")],
      "node-1",
    );
    expect(notes.expertRetiredButLive).toEqual([193]);
    expect(notes.expertNotDeployed).toEqual([242]);
    expect(hasDrift(notes)).toBe(false);

    const conflict = compare(ours, node, [expert("117", "NotNormalised")], "node-1");
    expect(conflict.expertConflicts).toEqual([{ code: 117, ours: "NotNormalized", expert: "NotNormalised" }]);
    expect(hasDrift(conflict)).toBe(true);
  });

  it("derives one node tag from the support matrix", () => {
    const network = (minNode: string) => ({ minNode }) as never;
    expect(deployedNodeTag({ networks: { preview: network("1.0.300"), preprod: network("1.0.300") } } as never)).toBe(
      "node-1.0.300",
    );
    expect(() => deployedNodeTag({ networks: { preview: network("2.0.0"), preprod: network("1.0.300") } } as never)).toThrow(
      /different node versions/,
    );
  });
});
