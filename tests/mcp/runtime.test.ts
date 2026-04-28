import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  approverFromConfig,
  buildRuntimeFromConfig,
  policyFromEntry,
} from "../../src/mcp/runtime.ts";
import type { WalletConfig, WalletPolicyEntry } from "../../src/config/types.ts";
import { CONFIG_VERSION } from "../../src/config/types.ts";
import { InMemorySecretStore } from "../../src/signers/secret-store.ts";
import { ExecApprover } from "../../src/approvers/exec.ts";
import { OsascriptApprover } from "../../src/approvers/osascript.ts";

const PK = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const ADDRESS = privateKeyToAccount(PK).address;

const baseConfig = (): WalletConfig => ({
  version: CONFIG_VERSION,
  signers: [
    {
      label: "keychain:main",
      address: ADDRESS,
      chains: [8453],
      keychainService: "x402-agent-wallet",
      keychainAccount: "keychain-main",
      createdAt: 1_700_000_000,
    },
  ],
  policy: { maxAmountPerRequest: "20000" },
  approver: { kind: "none" },
});

describe("policyFromEntry", () => {
  it("coerces bigints from strings", () => {
    const entry: WalletPolicyEntry = {
      maxAmountPerRequest: "20000",
      perDayCap: "1000000",
      perOriginBudgets: { "https://a.test": "50000" },
      requireApproval: true,
    };
    const cfg = policyFromEntry(entry);
    expect(cfg.maxAmountPerRequest).toBe(20000n);
    expect(cfg.perDayCap).toBe(1000000n);
    expect(cfg.perOriginBudgets).toEqual({ "https://a.test": 50000n });
    expect(cfg.requireApproval).toBe(true);
  });

  it("omits undefined optional fields", () => {
    const cfg = policyFromEntry({ maxAmountPerRequest: "1" });
    expect(cfg.perDayCap).toBeUndefined();
    expect(cfg.perOriginBudgets).toBeUndefined();
    expect(cfg.assetAllowlist).toBeUndefined();
    expect(cfg.networkAllowlist).toBeUndefined();
  });

  it("forwards allowlists unchanged", () => {
    const cfg = policyFromEntry({
      maxAmountPerRequest: "1",
      assetAllowlist: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
      networkAllowlist: [8453],
      originAllowlist: ["https://transit402.dev"],
      payToAllowlist: ["0x687E3217668DDe7c32478A3F2613750c8Bd505E9"],
    });
    expect(cfg.assetAllowlist).toEqual(["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"]);
    expect(cfg.networkAllowlist).toEqual([8453]);
    expect(cfg.originAllowlist).toEqual(["https://transit402.dev"]);
    expect(cfg.payToAllowlist).toEqual(["0x687E3217668DDe7c32478A3F2613750c8Bd505E9"]);
  });
});

describe("approverFromConfig", () => {
  it("returns undefined for none / absent", () => {
    expect(approverFromConfig({ kind: "none" })).toBeUndefined();
    expect(approverFromConfig(undefined)).toBeUndefined();
  });

  it("builds an OsascriptApprover", () => {
    const a = approverFromConfig({ kind: "osascript", title: "Test" });
    expect(a).toBeInstanceOf(OsascriptApprover);
  });

  it("builds an ExecApprover", () => {
    const a = approverFromConfig({ kind: "exec", binary: "/bin/approver", timeoutMs: 10_000 });
    expect(a).toBeInstanceOf(ExecApprover);
  });
});

describe("buildRuntimeFromConfig", () => {
  it("constructs a runtime wired to the configured signers", async () => {
    const secretStore = new InMemorySecretStore();
    await secretStore.set("x402-agent-wallet", "keychain-main", PK);
    const { runtime, signers } = buildRuntimeFromConfig({
      config: baseConfig(),
      secretStore,
      auditDbPath: ":memory:",
    });
    expect(signers).toHaveLength(1);
    expect(runtime.signers.list()[0]!.address).toBe(ADDRESS);
    expect(runtime.signers.findForChain(8453)).toHaveLength(1);
    expect(runtime.signers.findForChain(1)).toHaveLength(0);
  });

  it("exposes the audit log both as history and audit sink", async () => {
    const secretStore = new InMemorySecretStore();
    await secretStore.set("x402-agent-wallet", "keychain-main", PK);
    const { runtime } = buildRuntimeFromConfig({
      config: baseConfig(),
      secretStore,
      auditDbPath: ":memory:",
    });
    // history should be zero initially and readable.
    expect(runtime.history.totalSince(0)).toBe(0n);
  });

  it("works with zero configured signers", () => {
    const cfg: WalletConfig = { ...baseConfig(), signers: [] };
    const built = buildRuntimeFromConfig({
      config: cfg,
      secretStore: new InMemorySecretStore(),
      auditDbPath: ":memory:",
    });
    expect(built.signers).toEqual([]);
    expect(built.runtime.signers.list()).toEqual([]);
  });
});
