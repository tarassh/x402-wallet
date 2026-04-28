import { describe, expect, it } from "bun:test";
import { ExecApprover } from "../../src/approvers/exec.ts";
import type { ApprovalRequest } from "../../src/approvers/types.ts";
import { FakeSpawn } from "./fake-spawn.ts";

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
  signerLabel: "keychain:main",
  description: "Nearby subway stations",
};

describe("ExecApprover", () => {
  it("rejects missing binary", () => {
    const fake = new FakeSpawn();
    expect(() => new ExecApprover({ binary: "" }, fake.spawner)).toThrow(/binary is required/);
  });

  it("approves when child exits 0", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 0 });
    const a = new ExecApprover({ binary: "/bin/approver" }, fake.spawner);
    const r = await a.approve(req);
    expect(r).toEqual({ approved: true });
    expect(fake.invocations).toHaveLength(1);
    expect(fake.invocations[0]!.command).toBe("/bin/approver");
  });

  it("denies with exit code in message when child exits non-zero", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 1 });
    const a = new ExecApprover({ binary: "/bin/approver" }, fake.spawner);
    const r = await a.approve(req);
    expect(r.approved).toBe(false);
    if (r.approved) throw new Error("unreachable");
    expect(r.reason).toContain("code 1");
  });

  it("denies on spawn error", async () => {
    const fake = new FakeSpawn().queue({ error: new Error("ENOENT") });
    const a = new ExecApprover({ binary: "/bin/missing" }, fake.spawner);
    const r = await a.approve(req);
    expect(r.approved).toBe(false);
    if (r.approved) throw new Error("unreachable");
    expect(r.reason).toContain("ENOENT");
  });

  it("passes args through", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 0 });
    const a = new ExecApprover(
      { binary: "/bin/approver", args: ["--json", "--title", "test"] },
      fake.spawner,
    );
    await a.approve(req);
    expect(fake.invocations[0]!.args).toEqual(["--json", "--title", "test"]);
  });

  it("writes the request JSON to stdin by default", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 0 });
    const a = new ExecApprover({ binary: "/bin/approver" }, fake.spawner);
    await a.approve(req);
    const payload = JSON.parse(fake.invocations[0]!.stdin);
    expect(payload.amount).toBe("20000");
    expect(payload.network).toBe("eip155:8453");
    expect(payload.summary).toContain("$0.02 USD Coin");
  });

  it("includes a structured view object for rich UIs", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 0 });
    const a = new ExecApprover({ binary: "/bin/approver" }, fake.spawner);
    await a.approve(req);
    const payload = JSON.parse(fake.invocations[0]!.stdin);
    expect(payload.view).toBeDefined();
    expect(payload.view.amount).toBe("$0.02 USD Coin");
    expect(payload.view.chainName).toBe("Base");
    expect(payload.view.hostname).toBe("transit402.dev");
    expect(payload.view.purpose).toBe("Nearby subway stations");
  });

  it("does not write stdin when passRequestOnStdin is false", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 0 });
    const a = new ExecApprover({ binary: "/bin/approver", passRequestOnStdin: false }, fake.spawner);
    await a.approve(req);
    expect(fake.invocations[0]!.stdin).toBe("");
  });

  it("maps known non-zero codes via codeToReason", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 10 });
    const a = new ExecApprover(
      {
        binary: "/bin/approver",
        codeToReason: { 10: "User cancelled", 11: "Biometry unavailable" },
      },
      fake.spawner,
    );
    const r = await a.approve(req);
    expect(r.approved).toBe(false);
    if (r.approved) throw new Error("unreachable");
    expect(r.reason).toBe("User cancelled");
  });

  it("falls back to generic reason for unmapped exit codes", async () => {
    const fake = new FakeSpawn().queue({ exitCode: 7 });
    const a = new ExecApprover(
      { binary: "/bin/approver", codeToReason: { 10: "cancelled" } },
      fake.spawner,
    );
    const r = await a.approve(req);
    expect(r.approved).toBe(false);
    if (r.approved) throw new Error("unreachable");
    expect(r.reason).toBe("Approver exited with code 7");
  });

  it("times out and denies when child hangs past timeoutMs", async () => {
    const fake = new FakeSpawn().queue({ delayMs: 1000 });
    const a = new ExecApprover({ binary: "/bin/approver", timeoutMs: 10 }, fake.spawner);
    const r = await a.approve(req);
    expect(r.approved).toBe(false);
    if (r.approved) throw new Error("unreachable");
    expect(r.reason).toContain("timed out");
  });
});
