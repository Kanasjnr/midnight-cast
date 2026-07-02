import { describe, expect, it } from "vitest";
import {
  fetchProofServerVersion,
  proofServerBaseUrl,
  proofServerVersionUrl,
} from "../src/clients/proof-server.js";

describe("proof-server client", () => {
  it("builds version URL from base", () => {
    expect(proofServerVersionUrl("https://proof-server.preprod.midnight.network"))
      .toBe("https://proof-server.preprod.midnight.network/version");
    expect(proofServerVersionUrl("https://example.com/")).toBe(
      "https://example.com/version",
    );
    expect(proofServerBaseUrl("https://example.com/")).toBe("https://example.com");
  });

  it(
    "reads live version from preprod proof server",
    async () => {
      const version = await fetchProofServerVersion(
        "https://proof-server.preprod.midnight.network",
      );
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    },
    15000,
  );
});
