import type { Address } from "viem";

export const CONFIG_VERSION = 1;

export interface WalletSignerEntry {
  label: string;
  address: Address;
  chains: readonly number[];
  keychainService: string;
  keychainAccount: string;
  createdAt: number;
}

export interface WalletPolicyEntry {
  maxAmountPerRequest: string;
  perDayCap?: string;
  perOriginBudgets?: Record<string, string>;
  assetAllowlist?: readonly Address[];
  networkAllowlist?: readonly number[];
  originAllowlist?: readonly string[];
  payToAllowlist?: readonly Address[];
  requireApproval?: boolean;
}

export interface WalletConfig {
  version: typeof CONFIG_VERSION;
  signers: WalletSignerEntry[];
  policy: WalletPolicyEntry;
  approver?: ApproverConfig;
  dbPath?: string;
}

export type ApproverConfig =
  | { kind: "none" }
  | { kind: "osascript"; title?: string; timeoutMs?: number }
  | { kind: "exec"; binary: string; args?: readonly string[]; timeoutMs?: number; passRequestOnStdin?: boolean };

export const DEFAULT_POLICY: WalletPolicyEntry = {
  maxAmountPerRequest: "10000",
};

export const DEFAULT_CONFIG: WalletConfig = {
  version: CONFIG_VERSION,
  signers: [],
  policy: DEFAULT_POLICY,
  approver: { kind: "none" },
};

export class ConfigError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ConfigError";
  }
}
