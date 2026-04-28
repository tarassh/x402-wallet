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
  it("renders the amount, chain pretty-name, and hostname on three lines", () => {
    const s = summarizeForPrompt(req());
    expect(s).toContain("$0.02 USD Coin");
    expect(s).toContain("on Base");
    expect(s).toContain("to transit402.dev");
    expect(s.split("\n")).toHaveLength(2);
  });

  it("omits chainId and eip155: prefix for readability", () => {
    const s = summarizeForPrompt(req());
    expect(s).not.toContain("eip155:");
    expect(s).not.toContain("8453");
  });

  it("omits full recipient address and signer label from the prompt", () => {
    const s = summarizeForPrompt(req());
    expect(s).not.toContain("0x687E3217668DDe7c32478A3F2613750c8Bd505E9");
    expect(s).not.toContain("keychain:main");
  });

  it("adds a quoted purpose line when description present", () => {
    const s = summarizeForPrompt(req({ description: "Nearby subway stations" }));
    expect(s).toContain('"Nearby subway stations"');
    expect(s.split("\n")).toHaveLength(3);
  });

  it("falls back to eip155 network name for unknown chain ids", () => {
    const s = summarizeForPrompt(req({ chainId: 424242, network: "eip155:424242" }));
    expect(s).toContain("on eip155:424242");
  });
});

describe("buildApprovalView", () => {
  it("builds a structured view with chain pretty-name and hostname", async () => {
    const { buildApprovalView } = await import("../../src/approvers/format.ts");
    const v = buildApprovalView(req({ description: "Nearby subway stations" }));
    expect(v.amount).toBe("$0.02 USD Coin");
    expect(v.chainName).toBe("Base");
    expect(v.hostname).toBe("transit402.dev");
    expect(v.purpose).toBe("Nearby subway stations");
    expect(v.payTo).toBe("0x687E3217668DDe7c32478A3F2613750c8Bd505E9");
    expect(v.signerLabel).toBe("keychain:main");
  });

  it("omits purpose when description is empty or missing", async () => {
    const { buildApprovalView } = await import("../../src/approvers/format.ts");
    expect(buildApprovalView(req()).purpose).toBeUndefined();
    expect(buildApprovalView(req({ description: "   " })).purpose).toBeUndefined();
  });

  it("truncates very long purpose text", async () => {
    const { buildApprovalView } = await import("../../src/approvers/format.ts");
    const v = buildApprovalView(req({ description: "x".repeat(300) }));
    expect(v.purpose!.length).toBeLessThanOrEqual(161);
    expect(v.purpose!.endsWith("…")).toBe(true);
  });

  it("falls back to raw origin string if it isn't a URL", async () => {
    const { buildApprovalView } = await import("../../src/approvers/format.ts");
    const v = buildApprovalView(req({ origin: "not-a-url" }));
    expect(v.hostname).toBe("not-a-url");
  });
});
