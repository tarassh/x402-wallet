import { chainSpec } from "../chain/usdc.ts";
import type { ApprovalRequest } from "./types.ts";

export function formatUsdAtomic(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = amount % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length === 0 ? `${whole}` : `${whole}.${fracStr}`;
}

export function formatAmount(request: ApprovalRequest): string {
  // USDC uses 6 decimals; the x402 "exact" scheme pins it via extra.version=2
  // and the asset contract always exposes 6. We only support USDC today, so
  // hardcoding is fine and avoids an extra RPC round-trip.
  return `$${formatUsdAtomic(request.amount, 6)} ${request.assetName}`;
}

export function formatChainName(chainId: number, fallback: string): string {
  return chainSpec(chainId)?.name ?? fallback;
}

export function approvalHostname(request: ApprovalRequest): string {
  try {
    return new URL(request.origin).hostname;
  } catch {
    return request.origin;
  }
}

export interface ApprovalView {
  amount: string;
  chainName: string;
  hostname: string;
  purpose?: string;
  payTo: string;
  signerLabel: string;
}

export function buildApprovalView(request: ApprovalRequest): ApprovalView {
  const view: ApprovalView = {
    amount: formatAmount(request),
    chainName: formatChainName(request.chainId, request.network),
    hostname: approvalHostname(request),
    payTo: request.payTo,
    signerLabel: request.signerLabel,
  };
  const purpose = request.description?.trim();
  if (purpose) view.purpose = truncate(purpose, 160);
  return view;
}

export function summarizeForPrompt(request: ApprovalRequest): string {
  const v = buildApprovalView(request);
  const lines = [
    `Pay ${v.amount} on ${v.chainName}`,
    `to ${v.hostname}`,
  ];
  if (v.purpose) lines.push(`"${v.purpose}"`);
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
