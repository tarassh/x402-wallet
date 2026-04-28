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

export function summarizeForPrompt(request: ApprovalRequest): string {
  const lines = [
    `Approve x402 payment?`,
    ``,
    `Amount: ${formatAmount(request)}`,
    `Network: ${request.network} (chainId ${request.chainId})`,
    `URL: ${truncate(request.url, 80)}`,
    `To: ${request.payTo}`,
    `Signer: ${request.signerLabel}`,
  ];
  if (request.description) lines.push(`Purpose: ${truncate(request.description, 120)}`);
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
