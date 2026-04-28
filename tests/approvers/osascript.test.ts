import { describe, expect, it } from "bun:test";
import { OsascriptApprover } from "../../src/approvers/osascript.ts";
import type { ApprovalRequest } from "../../src/approvers/types.ts";
import { FakeSpawn } from "./fake-spawn.ts";

const req: ApprovalRequest = {
  origin: "https://transit402.dev",
  url: "https://transit402.dev/citibike/nearest",
  method: "GET",
  amount: 20000n,
  assetName: "USD Coin",
  assetAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  network: "eip155:8453",
  chainId: 8453,
  payTo: "0x687E3217668DDe7c32478A3F2613750c8Bd505E9",
  signerLabel: "keychain:main",
  description: 'Nearby bikes "with quotes"',
};

describe("OsascriptApprover", () => {
  it("approves when user accepts (exit 0)", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 0 });
    const a = new OsascriptApprover({}, fake.spawner);
    const r = await a.approve(req);
    expect(r).toEqual({ approved: true });
  });

  it("denies with a user-friendly reason when osascript exits non-zero", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 1 });
    const a = new OsascriptApprover({}, fake.spawner);
    const r = await a.approve(req);
    expect(r.approved).toBe(false);
    if (r.approved) throw new Error("unreachable");
    expect(r.reason).toContain("User denied via system dialog");
  });

  it("invokes osascript with -e and a display dialog script", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 0 });
    const a = new OsascriptApprover({}, fake.spawner);
    await a.approve(req);
    expect(fake.invocations).toHaveLength(1);
    expect(fake.invocations[0]!.command).toBe("osascript");
    expect(fake.invocations[0]!.args[0]).toBe("-e");
    const script = fake.invocations[0]!.args[1]!;
    expect(script).toContain("display dialog");
    // Quotes in the description must be escaped, not bare.
    expect(script).toContain('with quotes');
    expect(script).not.toMatch(/[^\\]"with quotes"/);
    // The dialog defaults to Deny on Enter/cancel for safety.
    expect(script).toContain('default button "Deny"');
    expect(script).toContain('cancel button "Deny"');
  });

  it("uses custom title when provided", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 0 });
    const a = new OsascriptApprover({ title: "Test Title" }, fake.spawner);
    await a.approve(req);
    expect(fake.invocations[0]!.args[1]!).toContain('with title "Test Title"');
  });
});
