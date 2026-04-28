import { describe, expect, it } from "bun:test";
import { tryExtractChallenge } from "../../src/x402/parse.ts";
import { realFetchTransport } from "../../src/mcp/transport.ts";

const shouldRun = process.env.RUN_E2E === "1";

describe.skipIf(!shouldRun)("transit402.dev (read-only e2e, no payment)", () => {
  it("returns a 402 with a parseable x402 v2 challenge", async () => {
    const resp = await realFetchTransport({
      url: "https://transit402.dev/subway/nearest?lat=40.7172&lng=-73.9567&limit=1",
    });
    expect(resp.status).toBe(402);
    const challenge = tryExtractChallenge(resp);
    expect(challenge).toBeDefined();
    if (!challenge) throw new Error("unreachable");
    expect(challenge.accepts.length).toBeGreaterThan(0);
    const baseAccept = challenge.accepts.find((a) => a.chainId === 8453);
    expect(baseAccept).toBeDefined();
    if (!baseAccept) throw new Error("unreachable");
    expect(baseAccept.amount).toBe(20000n);
    expect(baseAccept.extra.name).toBe("USD Coin");
  }, 15000);
});
