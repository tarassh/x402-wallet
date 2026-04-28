import type { Approver } from "../approvers/types.ts";
import { ExecApprover } from "../approvers/exec.ts";
import { OsascriptApprover } from "../approvers/osascript.ts";
import { SqliteAuditLog } from "../audit/sqlite.ts";
import type { SecretStore } from "../signers/secret-store.ts";
import { KeychainSigner } from "../signers/keychain.ts";
import type { Signer } from "../signers/types.ts";
import { InMemorySignerRegistry } from "../signers/types.ts";
import { PolicyEngine } from "../policy/engine.ts";
import type { PolicyConfig } from "../policy/types.ts";
import { PaymentOrchestrator } from "../orchestrator/orchestrator.ts";
import type { HttpTransport } from "../orchestrator/types.ts";
import { realFetchTransport } from "./transport.ts";
import type { ToolRuntime } from "./tools.ts";
import type { WalletConfig, WalletPolicyEntry } from "../config/types.ts";

export interface BuildRuntimeInput {
  config: WalletConfig;
  secretStore: SecretStore;
  auditDbPath: string;
  transport?: HttpTransport;
}

export interface BuiltRuntime {
  runtime: ToolRuntime;
  audit: SqliteAuditLog;
  signers: Signer[];
}

export function buildRuntimeFromConfig(input: BuildRuntimeInput): BuiltRuntime {
  const audit = new SqliteAuditLog(input.auditDbPath);
  const signers = input.config.signers.map(
    (s) =>
      new KeychainSigner({
        label: s.label,
        chains: s.chains,
        account: s.keychainAccount,
        service: s.keychainService,
        store: input.secretStore,
        address: s.address,
      }),
  );
  const registry = new InMemorySignerRegistry(signers);
  const policy = new PolicyEngine(policyFromEntry(input.config.policy));
  const approver = approverFromConfig(input.config.approver);
  const transport = input.transport ?? realFetchTransport;

  const orchestrator = new PaymentOrchestrator({
    transport,
    signers: registry,
    policy,
    history: audit,
    audit,
    ...(approver ? { approver } : {}),
  });

  return {
    runtime: {
      orchestrator,
      signers: registry,
      history: audit,
      rawFetch: transport,
    },
    audit,
    signers,
  };
}

export function policyFromEntry(entry: WalletPolicyEntry): PolicyConfig {
  const cfg: PolicyConfig = {
    maxAmountPerRequest: BigInt(entry.maxAmountPerRequest),
  };
  if (entry.perDayCap !== undefined) cfg.perDayCap = BigInt(entry.perDayCap);
  if (entry.perOriginBudgets) {
    cfg.perOriginBudgets = Object.fromEntries(
      Object.entries(entry.perOriginBudgets).map(([k, v]) => [k, BigInt(v)]),
    );
  }
  if (entry.assetAllowlist) cfg.assetAllowlist = entry.assetAllowlist;
  if (entry.networkAllowlist) cfg.networkAllowlist = entry.networkAllowlist;
  if (entry.originAllowlist) cfg.originAllowlist = entry.originAllowlist;
  if (entry.payToAllowlist) cfg.payToAllowlist = entry.payToAllowlist;
  if (entry.requireApproval !== undefined) cfg.requireApproval = entry.requireApproval;
  return cfg;
}

export function approverFromConfig(config: WalletConfig["approver"]): Approver | undefined {
  if (!config || config.kind === "none") return undefined;
  if (config.kind === "osascript") {
    const opts: { title?: string; timeoutMs?: number } = {};
    if (config.title !== undefined) opts.title = config.title;
    if (config.timeoutMs !== undefined) opts.timeoutMs = config.timeoutMs;
    return new OsascriptApprover(opts);
  }
  if (config.kind === "exec") {
    const opts: {
      binary: string;
      args?: readonly string[];
      timeoutMs?: number;
      passRequestOnStdin?: boolean;
    } = { binary: config.binary };
    if (config.args) opts.args = config.args;
    if (config.timeoutMs !== undefined) opts.timeoutMs = config.timeoutMs;
    if (config.passRequestOnStdin !== undefined) opts.passRequestOnStdin = config.passRequestOnStdin;
    return new ExecApprover(opts);
  }
  return undefined;
}
