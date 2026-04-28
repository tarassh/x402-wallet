import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { TypedDataDefinition } from "viem";
import { recoverTypedDataAddress } from "viem";
import { KeychainSigner, registerKeychainSigner } from "../../src/signers/keychain.ts";
import { KeyringSecretStore } from "../../src/signers/secret-store.ts";

const shouldRun = process.env.RUN_KEYCHAIN_IT === "1";

describe.skipIf(!shouldRun)("KeychainSigner (real OS keyring)", () => {
  const PK = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
  const ADDRESS = privateKeyToAccount(PK).address;
  const SERVICE = "x402-agent-wallet-test";
  const ACCOUNT = `it-${Date.now()}`;

  it("stores and signs via the real keyring", async () => {
    const store = new KeyringSecretStore();
    try {
      await registerKeychainSigner({ store, service: SERVICE, account: ACCOUNT, privateKey: PK });
      const signer = new KeychainSigner({
        label: `keychain:${ACCOUNT}`,
        chains: [8453],
        service: SERVICE,
        account: ACCOUNT,
        store,
        address: ADDRESS,
      });
      const typed: TypedDataDefinition = {
        domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: ADDRESS },
        types: { X: [{ name: "v", type: "uint256" }] },
        primaryType: "X",
        message: { v: 42n },
      };
      const sig = await signer.signTypedData(typed);
      const recovered = await recoverTypedDataAddress({ ...typed, signature: sig });
      expect(recovered.toLowerCase()).toBe(ADDRESS.toLowerCase());
    } finally {
      await store.delete(SERVICE, ACCOUNT);
    }
  });
});
