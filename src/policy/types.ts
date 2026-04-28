import type { Address } from "viem";
import type { X402Accept } from "../x402/types.ts";

export interface PolicyConfig {
  maxAmountPerRequest: bigint;
  perDayCap?: bigint;
  perOriginBudgets?: Record<string, bigint>;
  assetAllowlist?: readonly Address[];
  networkAllowlist?: readonly number[];
  originAllowlist?: readonly string[];
  payToAllowlist?: readonly Address[];
  requireApproval?: boolean;
}

export interface SpendEntry {
  origin: string;
  amount: bigint;
  timestamp: number;
}

export interface SpendHistory {
  totalSince(sinceEpochSec: number): bigint;
  totalForOriginSince(origin: string, sinceEpochSec: number): bigint;
}

export type PolicyDecision =
  | { allow: true }
  | { allow: false; reason: string; code: PolicyRejectCode };

export type PolicyRejectCode =
  | "amount_exceeds_max"
  | "asset_not_allowed"
  | "network_not_allowed"
  | "origin_not_allowed"
  | "payto_not_allowed"
  | "per_origin_budget_exceeded"
  | "daily_cap_exceeded"
  | "requires_approval";

export interface PolicyEvaluateInput {
  accept: X402Accept;
  origin: string;
  history: SpendHistory;
  now?: number;
}
