import type { ApproverConfig, WalletConfig, WalletPolicyEntry } from "../config/types.ts";
import { formatTokenAmount } from "../chain/balance.ts";

export const USDC_DECIMALS = 6;

export class ConfigEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigEditError";
  }
}

export function usdcToAtomic(input: string): string {
  const trimmed = input.trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
    throw new ConfigEditError(`Invalid USDC amount: "${input}"`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  if (frac.length > USDC_DECIMALS) {
    throw new ConfigEditError(
      `Too many decimals (USDC has ${USDC_DECIMALS}): "${input}"`,
    );
  }
  const padded = frac + "0".repeat(USDC_DECIMALS - frac.length);
  const combined = (whole ?? "0") + padded;
  const cleaned = combined.replace(/^0+/, "");
  return cleaned.length === 0 ? "0" : cleaned;
}

export function atomicToUsdc(atomic: string): string {
  return formatTokenAmount(BigInt(atomic), USDC_DECIMALS);
}

export interface SetLimitsInput {
  perRequest?: string;
  perDay?: string | null;
}

export function setLimits(config: WalletConfig, input: SetLimitsInput): WalletConfig {
  const policy: WalletPolicyEntry = { ...config.policy };
  if (input.perRequest !== undefined) {
    policy.maxAmountPerRequest = usdcToAtomic(input.perRequest);
  }
  if (input.perDay !== undefined) {
    if (input.perDay === null) {
      delete policy.perDayCap;
    } else {
      policy.perDayCap = usdcToAtomic(input.perDay);
    }
  }
  return { ...config, policy };
}

export function setApprover(config: WalletConfig, approver: ApproverConfig): WalletConfig {
  return { ...config, approver };
}

export function setOriginBudget(
  config: WalletConfig,
  origin: string,
  usdc: string,
): WalletConfig {
  validateOrigin(origin);
  const next = { ...(config.policy.perOriginBudgets ?? {}) };
  next[origin] = usdcToAtomic(usdc);
  return { ...config, policy: { ...config.policy, perOriginBudgets: next } };
}

export function removeOriginBudget(config: WalletConfig, origin: string): WalletConfig {
  const remaining = { ...(config.policy.perOriginBudgets ?? {}) };
  delete remaining[origin];
  const policy: WalletPolicyEntry = { ...config.policy };
  if (Object.keys(remaining).length === 0) {
    delete policy.perOriginBudgets;
  } else {
    policy.perOriginBudgets = remaining;
  }
  return { ...config, policy };
}

export function addOriginAllowlist(config: WalletConfig, origin: string): WalletConfig {
  validateOrigin(origin);
  const current = config.policy.originAllowlist ?? [];
  if (current.includes(origin)) return config;
  return {
    ...config,
    policy: { ...config.policy, originAllowlist: [...current, origin] },
  };
}

export function removeOriginAllowlist(config: WalletConfig, origin: string): WalletConfig {
  const filtered = (config.policy.originAllowlist ?? []).filter((o) => o !== origin);
  const policy: WalletPolicyEntry = { ...config.policy };
  if (filtered.length === 0) {
    delete policy.originAllowlist;
  } else {
    policy.originAllowlist = filtered;
  }
  return { ...config, policy };
}

function validateOrigin(origin: string): void {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new ConfigEditError(`Invalid origin (must be a full URL): "${origin}"`);
  }
  if (url.origin !== origin) {
    throw new ConfigEditError(
      `Origin must be the bare scheme+host+port (got "${origin}", expected "${url.origin}")`,
    );
  }
}

export interface ConfigSummary {
  perRequestUsdc: string;
  perDayUsdc: string | null;
  approver: string;
  originAllowlist: readonly string[];
  originBudgets: ReadonlyArray<{ origin: string; usdc: string }>;
  signerCount: number;
}

export function summarize(config: WalletConfig): ConfigSummary {
  const budgets = Object.entries(config.policy.perOriginBudgets ?? {}).map(([origin, atomic]) => ({
    origin,
    usdc: atomicToUsdc(atomic),
  }));
  return {
    perRequestUsdc: atomicToUsdc(config.policy.maxAmountPerRequest),
    perDayUsdc: config.policy.perDayCap ? atomicToUsdc(config.policy.perDayCap) : null,
    approver: config.approver?.kind ?? "none",
    originAllowlist: config.policy.originAllowlist ?? [],
    originBudgets: budgets,
    signerCount: config.signers.length,
  };
}
