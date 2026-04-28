import { describe, expect, it } from "bun:test";
import { AlwaysApprover, DenyApprover, MockApprover } from "../../src/approvers/simple.ts";
import type { ApprovalRequest } from "../../src/approvers/types.ts";
import { deny } from "../../src/approvers/types.ts";

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

describe("AlwaysApprover", () => {
  it("approves", async () => {
    const a = new AlwaysApprover();
    expect(await a.approve(req())).toEqual({ approved: true });
  });
});

describe("DenyApprover", () => {
  it("denies with default reason", async () => {
    const a = new DenyApprover();
    const r = await a.approve(req());
    expect(r).toEqual({ approved: false, reason: "All payments denied" });
  });

  it("denies with custom reason", async () => {
    const a = new DenyApprover("nope");
    expect(await a.approve(req())).toEqual({ approved: false, reason: "nope" });
  });
});

describe("MockApprover", () => {
  it("defaults to approving", async () => {
    const m = new MockApprover();
    expect(await m.approve(req())).toEqual({ approved: true });
  });

  it("captures all calls", async () => {
    const m = new MockApprover();
    await m.approve(req({ amount: 1n }));
    await m.approve(req({ amount: 2n }));
    expect(m.calls).toHaveLength(2);
    expect(m.calls[0]!.amount).toBe(1n);
    expect(m.calls[1]!.amount).toBe(2n);
  });

  it("honors the custom handler", async () => {
    const m = new MockApprover((r) => (r.amount > 100n ? deny("too big") : { approved: true }));
    expect(await m.approve(req({ amount: 50n }))).toEqual({ approved: true });
    expect(await m.approve(req({ amount: 500n }))).toEqual({ approved: false, reason: "too big" });
  });

  it("accepts an async handler", async () => {
    const m = new MockApprover(async (r) => (r.amount === 0n ? deny("zero") : { approved: true }));
    expect((await m.approve(req({ amount: 0n }))).approved).toBe(false);
  });
});
