import { describe, expect, it } from "bun:test";
import type { TypedDataDefinition } from "viem";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_SERVICE,
  KeychainSigner,
  registerKeychainSigner,
} from "../../src/signers/keychain.ts";
import { InMemorySecretStore } from "../../src/signers/secret-store.ts";

const PK = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const ADDRESS = privateKeyToAccount(PK).address;

const typed = (): TypedDataDefinition => ({
  domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: ADDRESS },
  types: { X: [{ name: "v", type: "uint256" }] },
  primaryType: "X",
  message: { v: 1n },
});

describe("registerKeychainSigner", () => {
  it("stores the private key and returns the derived address", async () => {
    const store = new InMemorySecretStore();
    const address = await registerKeychainSigner({ store, account: "main", privateKey: PK });
    expect(address).toBe(ADDRESS);
    expect(await store.get(DEFAULT_SERVICE, "main")).toBe(PK);
  });

  it("rejects a malformed private key", async () => {
    const store = new InMemorySecretStore();
    await expect(
      registerKeychainSigner({ store, account: "main", privateKey: "0x123" as `0x${string}` }),
    ).rejects.toThrow(/32-byte hex/);
  });

  it("honors a custom service name", async () => {
    const store = new InMemorySecretStore();
    await registerKeychainSigner({ store, service: "custom", account: "a", privateKey: PK });
    expect(await store.get("custom", "a")).toBe(PK);
    expect(await store.get(DEFAULT_SERVICE, "a")).toBeUndefined();
  });
});

describe("KeychainSigner", () => {
  it("signs typed data recoverable to registered address", async () => {
    const store = new InMemorySecretStore();
    await registerKeychainSigner({ store, account: "main", privateKey: PK });
    const signer = new KeychainSigner({
      label: "keychain:main",
      chains: [8453],
      account: "main",
      store,
      address: ADDRESS,
    });
    const sig = await signer.signTypedData(typed());
    const recovered = await recoverTypedDataAddress({ ...typed(), signature: sig });
    expect(recovered.toLowerCase()).toBe(ADDRESS.toLowerCase());
  });

  it("throws when the secret is missing", async () => {
    const store = new InMemorySecretStore();
    const signer = new KeychainSigner({
      label: "k",
      chains: [1],
      account: "missing",
      store,
      address: ADDRESS,
    });
    await expect(signer.signTypedData(typed())).rejects.toThrow(/No private key/);
  });

  it("throws when the stored value is not a valid hex private key", async () => {
    const store = new InMemorySecretStore();
    await store.set(DEFAULT_SERVICE, "main", "not-a-key");
    const signer = new KeychainSigner({
      label: "k",
      chains: [1],
      account: "main",
      store,
      address: ADDRESS,
    });
    await expect(signer.signTypedData(typed())).rejects.toThrow(/not a 32-byte hex private key/);
  });

  it("throws when stored key does not match registered address", async () => {
    const store = new InMemorySecretStore();
    await registerKeychainSigner({ store, account: "main", privateKey: PK });
    const signer = new KeychainSigner({
      label: "k",
      chains: [1],
      account: "main",
      store,
      address: "0x0000000000000000000000000000000000000000",
    });
    await expect(signer.signTypedData(typed())).rejects.toThrow(/does not match registered address/);
  });

  it("exposes address, chains, label on the interface", () => {
    const store = new InMemorySecretStore();
    const s = new KeychainSigner({
      label: "keychain:x",
      chains: [1, 8453],
      account: "main",
      store,
      address: ADDRESS,
    });
    expect(s.address).toBe(ADDRESS);
    expect(s.chains).toEqual([1, 8453]);
    expect(s.label).toBe("keychain:x");
    expect(s.service).toBe(DEFAULT_SERVICE);
    expect(s.account).toBe("main");
  });
});

describe("InMemorySecretStore", () => {
  it("set/get/delete round trip", async () => {
    const s = new InMemorySecretStore();
    expect(await s.get("svc", "acct")).toBeUndefined();
    await s.set("svc", "acct", "secret");
    expect(await s.get("svc", "acct")).toBe("secret");
    await s.delete("svc", "acct");
    expect(await s.get("svc", "acct")).toBeUndefined();
  });

  it("namespaces by service and account", async () => {
    const s = new InMemorySecretStore();
    await s.set("a", "x", "1");
    await s.set("b", "x", "2");
    await s.set("a", "y", "3");
    expect(await s.get("a", "x")).toBe("1");
    expect(await s.get("b", "x")).toBe("2");
    expect(await s.get("a", "y")).toBe("3");
  });
});
