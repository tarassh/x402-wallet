import type { Address } from "viem";
import type {
  PolicyConfig,
  PolicyDecision,
  PolicyEvaluateInput,
  SpendHistory,
} from "./types.ts";

const DAY_SECONDS = 24 * 60 * 60;

export class PolicyEngine {
  constructor(readonly config: PolicyConfig) {
    if (config.maxAmountPerRequest < 0n) {
      throw new Error("maxAmountPerRequest must be non-negative");
    }
  }

  evaluate(input: PolicyEvaluateInput): PolicyDecision {
    const { accept, origin, history, now = Math.floor(Date.now() / 1000) } = input;

    if (this.config.requireApproval) {
      return { allow: false, reason: "Manual approval required", code: "requires_approval" };
    }

    if (accept.amount > this.config.maxAmountPerRequest) {
      return {
        allow: false,
        reason: `Amount ${accept.amount} exceeds maxAmountPerRequest ${this.config.maxAmountPerRequest}`,
        code: "amount_exceeds_max",
      };
    }

    if (this.config.networkAllowlist && !this.config.networkAllowlist.includes(accept.chainId)) {
      return {
        allow: false,
        reason: `Network ${accept.network} (chainId ${accept.chainId}) not on allowlist`,
        code: "network_not_allowed",
      };
    }

    if (this.config.assetAllowlist && !containsAddress(this.config.assetAllowlist, accept.asset)) {
      return {
        allow: false,
        reason: `Asset ${accept.asset} not on allowlist`,
        code: "asset_not_allowed",
      };
    }

    if (this.config.payToAllowlist && !containsAddress(this.config.payToAllowlist, accept.payTo)) {
      return {
        allow: false,
        reason: `payTo ${accept.payTo} not on allowlist`,
        code: "payto_not_allowed",
      };
    }

    if (this.config.originAllowlist && !this.config.originAllowlist.includes(origin)) {
      return {
        allow: false,
        reason: `Origin ${origin} not on allowlist`,
        code: "origin_not_allowed",
      };
    }

    const budgetForOrigin = this.config.perOriginBudgets?.[origin];
    if (budgetForOrigin !== undefined) {
      const spent = history.totalForOriginSince(origin, now - DAY_SECONDS);
      if (spent + accept.amount > budgetForOrigin) {
        return {
          allow: false,
          reason: `Per-origin daily budget exceeded: ${spent} + ${accept.amount} > ${budgetForOrigin}`,
          code: "per_origin_budget_exceeded",
        };
      }
    }

    if (this.config.perDayCap !== undefined) {
      const spent = history.totalSince(now - DAY_SECONDS);
      if (spent + accept.amount > this.config.perDayCap) {
        return {
          allow: false,
          reason: `Daily cap exceeded: ${spent} + ${accept.amount} > ${this.config.perDayCap}`,
          code: "daily_cap_exceeded",
        };
      }
    }

    return { allow: true };
  }
}

function containsAddress(list: readonly Address[], needle: Address): boolean {
  const lower = needle.toLowerCase();
  return list.some((a) => a.toLowerCase() === lower);
}

export class InMemorySpendHistory implements SpendHistory {
  private readonly entries: { origin: string; amount: bigint; timestamp: number }[] = [];

  record(origin: string, amount: bigint, timestamp: number): void {
    this.entries.push({ origin, amount, timestamp });
  }

  totalSince(sinceEpochSec: number): bigint {
    let sum = 0n;
    for (const e of this.entries) {
      if (e.timestamp >= sinceEpochSec) sum += e.amount;
    }
    return sum;
  }

  totalForOriginSince(origin: string, sinceEpochSec: number): bigint {
    let sum = 0n;
    for (const e of this.entries) {
      if (e.origin === origin && e.timestamp >= sinceEpochSec) sum += e.amount;
    }
    return sum;
  }
}
