import { describe, expect, it } from "bun:test";
import {
  TOUCHID_CODE_REASONS,
  TOUCHID_EXIT_CODES,
  createTouchIdApprover,
  defaultTouchIdBinary,
} from "../../src/approvers/touchid.ts";
import { FakeSpawn } from "./fake-spawn.ts";
import type { ApprovalRequest } from "../../src/approvers/types.ts";

const req: ApprovalRequest = {
  origin: "https://transit402.dev",
  url: "https://transit402.dev/subway/nearest",
  method: "GET",
  amount: 20000n,
  assetName: "USD Coin",
  assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  network: "eip155:8453",
  chainId: 8453,
  payTo: "0x687E3217668DDe7c32478A3F2613750c8Bd505E9",
  signerLabel: "keychain:live",
};

describe("createTouchIdApprover", () => {
  it("invokes the configured binary with stdin payload", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 0 });
    const a = createTouchIdApprover({ binary: "/tmp/bin" }, fake.spawner);
    const r = await a.approve(req);
    expect(r).toEqual({ approved: true });
    expect(fake.invocations[0]!.command).toBe("/tmp/bin");
    const payload = JSON.parse(fake.invocations[0]!.stdin);
    expect(payload.summary).toContain("$0.02 USD Coin");
  });

  it("maps exit code 10 to 'User cancelled the Touch ID prompt'", async () => {
    const fake = new FakeSpawn().queue({ exitCode: TOUCHID_EXIT_CODES.CANCELLED });
    const a = createTouchIdApprover({ binary: "/tmp/bin" }, fake.spawner);
    const r = await a.approve(req);
    expect(r.approved).toBe(false);
    if (r.approved) throw new Error("unreachable");
    expect(r.reason).toBe(TOUCHID_CODE_REASONS[10]!);
    expect(r.reason).toContain("cancelled");
  });

  it("maps exit code 11 to biometry-unavailable reason", async () => {
    const fake = new FakeSpawn().queue({ exitCode: TOUCHID_EXIT_CODES.BIOMETRY_UNAVAILABLE });
    const a = createTouchIdApprover({ binary: "/tmp/bin" }, fake.spawner);
    const r = await a.approve(req);
    expect(r.approved).toBe(false);
    if (r.approved) throw new Error("unreachable");
    expect(r.reason).toContain("Biometry unavailable");
  });

  it("falls back to generic message for unexpected code", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 42 });
    const a = createTouchIdApprover({ binary: "/tmp/bin" }, fake.spawner);
    const r = await a.approve(req);
    expect(r.approved).toBe(false);
    if (r.approved) throw new Error("unreachable");
    expect(r.reason).toContain("code 42");
  });
});

describe("defaultTouchIdBinary", () => {
  it("resolves under $HOME/.x402-wallet/bin/", () => {
    expect(defaultTouchIdBinary("/Users/test")).toBe("/Users/test/.x402-wallet/bin/touchid-approver");
  });
});
