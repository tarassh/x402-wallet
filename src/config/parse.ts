import { getAddress, isAddress } from "viem";
import type { Address } from "viem";
import { ConfigError, CONFIG_VERSION } from "./types.ts";
import type {
  ApproverConfig,
  WalletConfig,
  WalletPolicyEntry,
  WalletSignerEntry,
} from "./types.ts";

export function parseConfig(input: unknown): WalletConfig {
  const root = requireObject(input, "config");
  if (root.version !== CONFIG_VERSION) {
    throw new ConfigError(
      `Unsupported config version: ${String(root.version)} (this build supports ${CONFIG_VERSION})`,
    );
  }

  const signers = parseSigners(root.signers);
  const policy = parsePolicy(root.policy);
  const approver = root.approver !== undefined ? parseApprover(root.approver) : undefined;

  return {
    version: CONFIG_VERSION,
    signers,
    policy,
    ...(approver ? { approver } : {}),
    ...(typeof root.dbPath === "string" ? { dbPath: root.dbPath } : {}),
  };
}

function parseSigners(input: unknown): WalletSignerEntry[] {
  if (!Array.isArray(input)) throw new ConfigError("config.signers must be an array");
  const labels = new Set<string>();
  return input.map((raw, i) => {
    const o = requireObject(raw, `config.signers[${i}]`);
    const label = requireString(o.label, `config.signers[${i}].label`);
    if (labels.has(label)) throw new ConfigError(`Duplicate signer label: ${label}`);
    labels.add(label);
    const address = requireAddress(o.address, `config.signers[${i}].address`);
    const chains = requireChainArray(o.chains, `config.signers[${i}].chains`);
    const keychainService = requireString(o.keychainService, `config.signers[${i}].keychainService`);
    const keychainAccount = requireString(o.keychainAccount, `config.signers[${i}].keychainAccount`);
    const createdAt = requireNonNegativeInt(o.createdAt, `config.signers[${i}].createdAt`);
    return { label, address, chains, keychainService, keychainAccount, createdAt };
  });
}

function parsePolicy(input: unknown): WalletPolicyEntry {
  const o = requireObject(input, "config.policy");
  const policy: WalletPolicyEntry = {
    maxAmountPerRequest: requireBigIntString(o.maxAmountPerRequest, "config.policy.maxAmountPerRequest"),
  };
  if (o.perDayCap !== undefined) {
    policy.perDayCap = requireBigIntString(o.perDayCap, "config.policy.perDayCap");
  }
  if (o.perOriginBudgets !== undefined) {
    policy.perOriginBudgets = parseOriginBudgets(o.perOriginBudgets);
  }
  if (o.assetAllowlist !== undefined) policy.assetAllowlist = requireAddressArray(o.assetAllowlist, "config.policy.assetAllowlist");
  if (o.networkAllowlist !== undefined) policy.networkAllowlist = requireChainArray(o.networkAllowlist, "config.policy.networkAllowlist");
  if (o.originAllowlist !== undefined) policy.originAllowlist = requireStringArray(o.originAllowlist, "config.policy.originAllowlist");
  if (o.payToAllowlist !== undefined) policy.payToAllowlist = requireAddressArray(o.payToAllowlist, "config.policy.payToAllowlist");
  if (typeof o.requireApproval === "boolean") policy.requireApproval = o.requireApproval;
  return policy;
}

function parseOriginBudgets(input: unknown): Record<string, string> {
  const o = requireObject(input, "config.policy.perOriginBudgets");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = requireBigIntString(v, `config.policy.perOriginBudgets["${k}"]`);
  }
  return out;
}

function parseApprover(input: unknown): ApproverConfig {
  const o = requireObject(input, "config.approver");
  const kind = requireString(o.kind, "config.approver.kind");
  switch (kind) {
    case "none":
      return { kind: "none" };
    case "osascript":
      return {
        kind: "osascript",
        ...(typeof o.title === "string" ? { title: o.title } : {}),
        ...(typeof o.timeoutMs === "number" ? { timeoutMs: o.timeoutMs } : {}),
      };
    case "exec": {
      const binary = requireString(o.binary, "config.approver.binary");
      const out: ApproverConfig = { kind: "exec", binary };
      if (Array.isArray(o.args)) out.args = requireStringArray(o.args, "config.approver.args");
      if (typeof o.timeoutMs === "number") out.timeoutMs = o.timeoutMs;
      if (typeof o.passRequestOnStdin === "boolean") out.passRequestOnStdin = o.passRequestOnStdin;
      return out;
    }
    default:
      throw new ConfigError(`Unknown approver kind: ${kind}`);
  }
}

function requireObject(v: unknown, field: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new ConfigError(`${field} must be an object`);
  }
  return v as Record<string, unknown>;
}

function requireString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) throw new ConfigError(`${field} must be a non-empty string`);
  return v;
}

function requireAddress(v: unknown, field: string): Address {
  const s = requireString(v, field);
  if (!isAddress(s)) throw new ConfigError(`${field} is not a valid Ethereum address: ${s}`);
  return getAddress(s);
}

function requireStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) throw new ConfigError(`${field} must be an array`);
  return v.map((item, i) => requireString(item, `${field}[${i}]`));
}

function requireAddressArray(v: unknown, field: string): Address[] {
  if (!Array.isArray(v)) throw new ConfigError(`${field} must be an array`);
  return v.map((item, i) => requireAddress(item, `${field}[${i}]`));
}

function requireChainArray(v: unknown, field: string): number[] {
  if (!Array.isArray(v) || v.length === 0) throw new ConfigError(`${field} must be a non-empty array`);
  return v.map((item, i) => {
    if (typeof item !== "number" || !Number.isInteger(item) || item <= 0) {
      throw new ConfigError(`${field}[${i}] must be a positive integer chain id`);
    }
    return item;
  });
}

function requireNonNegativeInt(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new ConfigError(`${field} must be a non-negative integer`);
  }
  return v;
}

function requireBigIntString(v: unknown, field: string): string {
  if (typeof v !== "string" && typeof v !== "number") {
    throw new ConfigError(`${field} must be a string or number (got ${typeof v})`);
  }
  try {
    const n = BigInt(v);
    if (n < 0n) throw new Error("negative");
    return n.toString();
  } catch {
    throw new ConfigError(`${field} is not a valid non-negative integer: ${String(v)}`);
  }
}
