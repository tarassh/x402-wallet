import { describe, expect, it } from "bun:test";
import { formatAmount, formatUsdAtomic, summarizeForPrompt } from "../../src/approvers/format.ts";
import type { ApprovalRequest } from "../../src/approvers/types.ts";

const req = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  origin: "https://transit402.dev",
  url: "https://transit402.dev/subway/nearest",
  method: "GET",
  amount: 20000n,
  assetName: "USD Coin",
  assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  network: "eip155:8453",
  chainId: 8453,
  payTo: "0x687E3217668DDe7c32478A3F2613750c8Bd505E9",
  signerLabel: "keychain:main",
  ...overrides,
});

describe("formatUsdAtomic", () => {
  it("renders whole-dollar amounts", () => {
    expect(formatUsdAtomic(1_000_000n, 6)).toBe("1");
    expect(formatUsdAtomic(25_000_000n, 6)).toBe("25");
  });

  it("renders fractional amounts and trims trailing zeros", () => {
    expect(formatUsdAtomic(20_000n, 6)).toBe("0.02");
    expect(formatUsdAtomic(100_000n, 6)).toBe("0.1");
    expect(formatUsdAtomic(1_234_500n, 6)).toBe("1.2345");
  });

  it("handles zero", () => {
    expect(formatUsdAtomic(0n, 6)).toBe("0");
  });
});

describe("formatAmount", () => {
  it("prefixes with $ and suffixes with asset name", () => {
    expect(formatAmount(req({ amount: 20000n }))).toBe("$0.02 USD Coin");
    expect(formatAmount(req({ amount: 1_500_000n }))).toBe("$1.5 USD Coin");
  });
});

describe("summarizeForPrompt", () => {
  it("includes the key fields", () => {
    const s = summarizeForPrompt(req());
    expect(s).toContain("$0.02 USD Coin");
    expect(s).toContain("eip155:8453");
    expect(s).toContain("transit402.dev");
    expect(s).toContain("0x687E3217668DDe7c32478A3F2613750c8Bd505E9");
    expect(s).toContain("keychain:main");
  });

  it("adds purpose line when description present", () => {
    const s = summarizeForPrompt(req({ description: "Nearby subway stations" }));
    expect(s).toContain("Purpose: Nearby subway stations");
  });

  it("truncates absurdly long URLs", () => {
    const longUrl = "https://example.test/" + "a".repeat(200);
    const s = summarizeForPrompt(req({ url: longUrl }));
    const urlLine = s.split("\n").find((l) => l.startsWith("URL:"))!;
    expect(urlLine.length).toBeLessThan(100);
    expect(urlLine).toContain("…");
  });
});
