import type { Address } from "viem";

export interface ChainSpec {
  chainId: number;
  name: string;
  usdc: Address;
  decimals: 6;
  defaultRpc: string;
  explorer: string;
}

export const CHAINS: Record<number, ChainSpec> = {
  1: {
    chainId: 1,
    name: "Ethereum",
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
    defaultRpc: "https://eth.llamarpc.com",
    explorer: "https://etherscan.io",
  },
  8453: {
    chainId: 8453,
    name: "Base",
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    defaultRpc: "https://mainnet.base.org",
    explorer: "https://basescan.org",
  },
  10: {
    chainId: 10,
    name: "Optimism",
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    decimals: 6,
    defaultRpc: "https://mainnet.optimism.io",
    explorer: "https://optimistic.etherscan.io",
  },
  42161: {
    chainId: 42161,
    name: "Arbitrum",
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
    defaultRpc: "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
  },
};

export function chainSpec(chainId: number): ChainSpec | undefined {
  return CHAINS[chainId];
}

export function resolveRpc(chainId: number, overrides: Record<number, string> = {}): string | undefined {
  const override = overrides[chainId];
  if (override) return override;
  return CHAINS[chainId]?.defaultRpc;
}
