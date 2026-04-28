import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SqliteAuditLog } from "../../src/audit/sqlite.ts";
import type { PaymentRecord } from "../../src/orchestrator/types.ts";

const entry = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  timestamp: 1_700_000_000,
  origin: "https://transit402.dev",
  url: "https://transit402.dev/subway/nearest",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  network: "eip155:8453",
  chainId: 8453,
  amount: 20000n,
  signerLabel: "keychain:main",
  status: "succeeded",
  ...overrides,
});

let log: SqliteAuditLog;

beforeEach(() => {
  log = new SqliteAuditLog(":memory:");
});

afterEach(() => {
  log.close();
});

describe("SqliteAuditLog", () => {
  it("persists and lists entries", async () => {
    await log.record(entry());
    await log.record(entry({ timestamp: 1_700_000_500, amount: 10000n }));
    const list = log.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.timestamp).toBe(1_700_000_500);
    expect(list[0]!.amount).toBe(10000n);
    expect(list[1]!.amount).toBe(20000n);
  });

  it("round-trips optional fields", async () => {
    await log.record(entry({ txHash: "0xdead", errorMessage: "oops", status: "failed" }));
    const list = log.list();
    expect(list[0]!.txHash).toBe("0xdead");
    expect(list[0]!.errorMessage).toBe("oops");
    expect(list[0]!.status).toBe("failed");
  });

  it("omits optional fields when null in DB", async () => {
    await log.record(entry());
    const list = log.list();
    expect(list[0]!.txHash).toBeUndefined();
    expect(list[0]!.errorMessage).toBeUndefined();
  });

  it("totalSince only counts succeeded entries after the cutoff", async () => {
    await log.record(entry({ timestamp: 100, amount: 10n }));
    await log.record(entry({ timestamp: 200, amount: 20n }));
    await log.record(entry({ timestamp: 300, amount: 99n, status: "failed" }));
    expect(log.totalSince(0)).toBe(30n);
    expect(log.totalSince(150)).toBe(20n);
    expect(log.totalSince(400)).toBe(0n);
  });

  it("totalForOriginSince filters by origin + status + timestamp", async () => {
    await log.record(entry({ origin: "https://a.test", timestamp: 100, amount: 10n }));
    await log.record(entry({ origin: "https://b.test", timestamp: 200, amount: 30n }));
    await log.record(entry({ origin: "https://a.test", timestamp: 300, amount: 40n }));
    await log.record(entry({ origin: "https://a.test", timestamp: 400, amount: 5n, status: "failed" }));
    expect(log.totalForOriginSince("https://a.test", 0)).toBe(50n);
    expect(log.totalForOriginSince("https://a.test", 150)).toBe(40n);
    expect(log.totalForOriginSince("https://b.test", 0)).toBe(30n);
    expect(log.totalForOriginSince("https://c.test", 0)).toBe(0n);
  });

  it("preserves bigint amount precision", async () => {
    const big = 12345678901234567890n;
    await log.record(entry({ amount: big }));
    expect(log.list()[0]!.amount).toBe(big);
    expect(log.totalSince(0)).toBe(big);
  });
});
