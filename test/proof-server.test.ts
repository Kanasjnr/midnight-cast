import { describe, expect, it, vi, afterEach } from "vitest";
import {
  fetchProofServerVersion,
  proofServerBaseUrl,
  proofServerVersionUrl,
} from "../src/clients/proof-server.js";

const integration = process.env.INTEGRATION === "1";

describe("proof-server client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds version URL from base", () => {
    expect(proofServerVersionUrl("https://proof-server.preprod.midnight.network"))
      .toBe("https://proof-server.preprod.midnight.network/version");
    expect(proofServerVersionUrl("https://example.com/")).toBe(
      "https://example.com/version",
    );
    expect(proofServerBaseUrl("https://example.com/")).toBe("https://example.com");
  });

  it("strips control chars from /version body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "8.0.3\u001b[31mSPOOFED\u0007",
      }),
    );

    const version = await fetchProofServerVersion("https://example.com");
    expect(version).toBe("8.0.3[31mSPOOFED");
  });

  it.skipIf(!integration)(
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
