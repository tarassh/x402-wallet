import { describe, expect, it } from "bun:test";
import { InMemorySpendHistory, PolicyEngine } from "../../src/policy/engine.ts";
import type { X402Accept } from "../../src/x402/types.ts";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const TRANSIT_PAYTO = "0x687E3217668DDe7c32478A3F2613750c8Bd505E9" as const;
const ORIGIN = "https://transit402.dev";

const accept = (overrides: Partial<X402Accept> = {}): X402Accept => ({
  scheme: "exact",
  network: "eip155:8453",
  chainId: 8453,
  amount: 20000n,
  asset: USDC_BASE,
  payTo: TRANSIT_PAYTO,
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
  resource: "https://transit402.dev/subway/nearest",
  ...overrides,
});

const emptyHistory = () => new InMemorySpendHistory();

describe("PolicyEngine", () => {
  it("allows by default when amount within cap", () => {
    const p = new PolicyEngine({ maxAmountPerRequest: 50000n });
    expect(p.evaluate({ accept: accept(), origin: ORIGIN, history: emptyHistory() })).toEqual({
      allow: true,
    });
  });

  it("rejects amount over cap", () => {
    const p = new PolicyEngine({ maxAmountPerRequest: 10000n });
    const d = p.evaluate({ accept: accept(), origin: ORIGIN, history: emptyHistory() });
    expect(d).toEqual({
      allow: false,
      reason: expect.stringContaining("exceeds maxAmountPerRequest") as unknown as string,
      code: "amount_exceeds_max",
    });
  });

  it("rejects disallowed networks", () => {
    const p = new PolicyEngine({ maxAmountPerRequest: 1n << 64n, networkAllowlist: [1] });
    const d = p.evaluate({ accept: accept(), origin: ORIGIN, history: emptyHistory() });
    expect(d.allow).toBe(false);
    if (d.allow) throw new Error("unreachable");
    expect(d.code).toBe("network_not_allowed");
  });

  it("allows when network is on allowlist", () => {
    const p = new PolicyEngine({ maxAmountPerRequest: 1n << 64n, networkAllowlist: [8453] });
    expect(p.evaluate({ accept: accept(), origin: ORIGIN, history: emptyHistory() })).toEqual({
      allow: true,
    });
  });

  it("rejects disallowed assets", () => {
    const p = new PolicyEngine({
      maxAmountPerRequest: 1n << 64n,
      assetAllowlist: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"],
    });
    const d = p.evaluate({ accept: accept(), origin: ORIGIN, history: emptyHistory() });
    expect(d.allow).toBe(false);
    if (d.allow) throw new Error("unreachable");
    expect(d.code).toBe("asset_not_allowed");
  });

  it("matches asset allowlist case-insensitively", () => {
    const p = new PolicyEngine({
      maxAmountPerRequest: 1n << 64n,
      assetAllowlist: [USDC_BASE.toLowerCase() as `0x${string}`],
    });
    expect(p.evaluate({ accept: accept(), origin: ORIGIN, history: emptyHistory() })).toEqual({
      allow: true,
    });
  });

  it("rejects disallowed payTo", () => {
    const p = new PolicyEngine({
      maxAmountPerRequest: 1n << 64n,
      payToAllowlist: ["0x0000000000000000000000000000000000000bad"],
    });
    const d = p.evaluate({ accept: accept(), origin: ORIGIN, history: emptyHistory() });
    expect(d.allow).toBe(false);
    if (d.allow) throw new Error("unreachable");
    expect(d.code).toBe("payto_not_allowed");
  });

  it("rejects disallowed origin", () => {
    const p = new PolicyEngine({
      maxAmountPerRequest: 1n << 64n,
      originAllowlist: ["https://other.test"],
    });
    const d = p.evaluate({ accept: accept(), origin: ORIGIN, history: emptyHistory() });
    expect(d.allow).toBe(false);
    if (d.allow) throw new Error("unreachable");
    expect(d.code).toBe("origin_not_allowed");
  });

  it("enforces per-origin daily budget", () => {
    const history = emptyHistory();
    const now = 1_700_000_000;
    history.record(ORIGIN, 40000n, now - 1000);
    const p = new PolicyEngine({
      maxAmountPerRequest: 1n << 64n,
      perOriginBudgets: { [ORIGIN]: 50000n },
    });
    const decision = p.evaluate({ accept: accept({ amount: 20000n }), origin: ORIGIN, history, now });
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error("unreachable");
    expect(decision.code).toBe("per_origin_budget_exceeded");
  });

  it("ignores per-origin history older than 24h", () => {
    const history = emptyHistory();
    const now = 1_700_000_000;
    history.record(ORIGIN, 100000n, now - 25 * 60 * 60);
    const p = new PolicyEngine({
      maxAmountPerRequest: 1n << 64n,
      perOriginBudgets: { [ORIGIN]: 50000n },
    });
    expect(
      p.evaluate({ accept: accept({ amount: 10000n }), origin: ORIGIN, history, now }),
    ).toEqual({ allow: true });
  });

  it("enforces daily cap across origins", () => {
    const history = emptyHistory();
    const now = 1_700_000_000;
    history.record("https://a.test", 30000n, now - 100);
    history.record("https://b.test", 30000n, now - 50);
    const p = new PolicyEngine({ maxAmountPerRequest: 1n << 64n, perDayCap: 70000n });
    const decision = p.evaluate({
      accept: accept({ amount: 20000n }),
      origin: "https://c.test",
      history,
      now,
    });
    expect(decision.allow).toBe(false);
    if (decision.allow) throw new Error("unreachable");
    expect(decision.code).toBe("daily_cap_exceeded");
  });

  it("short-circuits on requireApproval", () => {
    const p = new PolicyEngine({ maxAmountPerRequest: 1n << 64n, requireApproval: true });
    const d = p.evaluate({ accept: accept(), origin: ORIGIN, history: emptyHistory() });
    expect(d.allow).toBe(false);
    if (d.allow) throw new Error("unreachable");
    expect(d.code).toBe("requires_approval");
  });

  it("rejects negative maxAmountPerRequest at construction", () => {
    expect(() => new PolicyEngine({ maxAmountPerRequest: -1n })).toThrow();
  });

  it("amount equal to cap is allowed", () => {
    const p = new PolicyEngine({ maxAmountPerRequest: 20000n });
    expect(p.evaluate({ accept: accept({ amount: 20000n }), origin: ORIGIN, history: emptyHistory() })).toEqual({
      allow: true,
    });
  });
});

describe("InMemorySpendHistory", () => {
  it("totalSince filters by timestamp", () => {
    const h = new InMemorySpendHistory();
    h.record("a", 10n, 100);
    h.record("a", 20n, 200);
    h.record("a", 30n, 300);
    expect(h.totalSince(150)).toBe(50n);
    expect(h.totalSince(0)).toBe(60n);
    expect(h.totalSince(400)).toBe(0n);
  });

  it("totalForOriginSince filters by origin + timestamp", () => {
    const h = new InMemorySpendHistory();
    h.record("a", 10n, 100);
    h.record("b", 20n, 100);
    h.record("a", 30n, 200);
    expect(h.totalForOriginSince("a", 0)).toBe(40n);
    expect(h.totalForOriginSince("b", 0)).toBe(20n);
    expect(h.totalForOriginSince("a", 150)).toBe(30n);
  });
});
