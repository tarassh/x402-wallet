import type { Address } from "viem";
import type { HttpTransport } from "../orchestrator/types.ts";
import type { ConfigStore } from "../config/store.ts";
import { queryUsdcBalance, BalanceQueryError } from "../chain/balance.ts";
import { chainSpec, resolveRpc } from "../chain/usdc.ts";
import { OnboardingError } from "./commands.ts";

export interface BalanceRow {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  raw?: string;
  decimals?: number;
  error?: string;
}

export interface BalanceReport {
  label: string;
  address: Address;
  rows: BalanceRow[];
}

export interface GetBalancesDeps {
  config: ConfigStore;
  transport: HttpTransport;
  rpcOverrides?: Record<number, string>;
}

export async function getBalances(
  deps: GetBalancesDeps,
  label: string,
): Promise<BalanceReport> {
  const cfg = await deps.config.load();
  const signer = cfg.signers.find((s) => s.label === label);
  if (!signer) throw new OnboardingError(`No signer with label "${label}"`);

  const rows: BalanceRow[] = [];
  for (const chainId of signer.chains) {
    const spec = chainSpec(chainId);
    const rpcUrl = resolveRpc(chainId, deps.rpcOverrides ?? {});
    if (!spec || !rpcUrl) {
      rows.push({
        chainId,
        chainName: spec?.name ?? `chain ${chainId}`,
        rpcUrl: rpcUrl ?? "",
        error: `Unknown chain ${chainId} (no USDC/RPC configured)`,
      });
      continue;
    }
    try {
      const raw = await queryUsdcBalance({
        chainId,
        address: signer.address,
        rpcUrl,
        transport: deps.transport,
      });
      rows.push({
        chainId,
        chainName: spec.name,
        rpcUrl,
        raw: raw.toString(),
        decimals: spec.decimals,
      });
    } catch (err) {
      const message = err instanceof BalanceQueryError ? err.message : (err as Error).message;
      rows.push({ chainId, chainName: spec.name, rpcUrl, error: message });
    }
  }
  return { label, address: signer.address, rows };
}
