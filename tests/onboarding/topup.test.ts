import { describe, expect, test } from "bun:test";
import { buildTopupReport } from "../../src/onboarding/topup.ts";
import { InMemoryConfigStore } from "../../src/config/store.ts";
import { OnboardingError } from "../../src/onboarding/commands.ts";
import { CONFIG_VERSION } from "../../src/config/types.ts";
import type { WalletConfig } from "../../src/config/types.ts";

const ADDR = "0x7be582A029B1a029A91B90BEC90753fEBdb91485" as const;

const baseConfig = (chains: number[]): WalletConfig => ({
  version: CONFIG_VERSION,
  signers: [
    {
      label: "keychain:main",
      address: ADDR,
      chains,
      keychainService: "x402-agent-wallet",
      keychainAccount: "keychain-main",
      createdAt: 1_700_000_000,
    },
  ],
  policy: { maxAmountPerRequest: "10000" },
  approver: { kind: "none" },
});

describe("buildTopupReport", () => {
  test("returns address + chain info for a known chain", async () => {
    const store = new InMemoryConfigStore(baseConfig([8453]));
    const report = await buildTopupReport({ config: store }, "keychain:main");

    expect(report.label).toBe("keychain:main");
    expect(report.address).toBe(ADDR);
    expect(report.chains).toEqual([
      {
        chainId: 8453,
        chainName: "Base",
        usdcContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        explorerAddressUrl: `https://basescan.org/address/${ADDR}`,
        decimals: 6,
      },
    ]);
    expect(report.unknownChainIds).toEqual([]);
  });

  test("includes every supported chain configured for the signer", async () => {
    const store = new InMemoryConfigStore(baseConfig([1, 8453, 10, 42161]));
    const report = await buildTopupReport({ config: store }, "keychain:main");

    expect(report.chains.map((c) => c.chainId)).toEqual([1, 8453, 10, 42161]);
    expect(report.chains.map((c) => c.chainName)).toEqual([
      "Ethereum",
      "Base",
      "Optimism",
      "Arbitrum",
    ]);
    for (const c of report.chains) {
      expect(c.usdcContract).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(c.explorerAddressUrl).toContain(ADDR);
      expect(c.decimals).toBe(6);
    }
  });

  test("collects chain IDs not in the registry into unknownChainIds", async () => {
    const store = new InMemoryConfigStore(baseConfig([8453, 99999]));
    const report = await buildTopupReport({ config: store }, "keychain:main");

    expect(report.chains.map((c) => c.chainId)).toEqual([8453]);
    expect(report.unknownChainIds).toEqual([99999]);
  });

  test("throws if the label is unknown", async () => {
    const store = new InMemoryConfigStore(baseConfig([8453]));
    await expect(buildTopupReport({ config: store }, "missing")).rejects.toThrow(
      OnboardingError,
    );
  });

  test("returns no chains and all-unknown when none are supported", async () => {
    const store = new InMemoryConfigStore(baseConfig([12345]));
    const report = await buildTopupReport({ config: store }, "keychain:main");

    expect(report.chains).toEqual([]);
    expect(report.unknownChainIds).toEqual([12345]);
  });
});
