import type { Address } from "viem";
import type { ConfigStore } from "../config/store.ts";
import { chainSpec } from "../chain/usdc.ts";
import { OnboardingError } from "./commands.ts";

export interface TopupChainInfo {
  chainId: number;
  chainName: string;
  usdcContract: Address;
  explorerAddressUrl: string;
  decimals: 6;
}

export interface TopupReport {
  label: string;
  address: Address;
  chains: TopupChainInfo[];
  unknownChainIds: number[];
}

export interface TopupDeps {
  config: ConfigStore;
}

export async function buildTopupReport(
  deps: TopupDeps,
  label: string,
): Promise<TopupReport> {
  const config = await deps.config.load();
  const entry = config.signers.find((s) => s.label === label);
  if (!entry) throw new OnboardingError(`No signer with label "${label}"`);

  const chains: TopupChainInfo[] = [];
  const unknownChainIds: number[] = [];
  for (const chainId of entry.chains) {
    const spec = chainSpec(chainId);
    if (!spec) {
      unknownChainIds.push(chainId);
      continue;
    }
    chains.push({
      chainId: spec.chainId,
      chainName: spec.name,
      usdcContract: spec.usdc,
      explorerAddressUrl: `${spec.explorer}/address/${entry.address}`,
      decimals: spec.decimals,
    });
  }
  return { label, address: entry.address, chains, unknownChainIds };
}
