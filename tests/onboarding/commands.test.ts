import { beforeEach, describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  OnboardingError,
  importKey,
  initWallet,
  listSigners,
  removeSigner,
  showAddress,
  slugifyLabel,
  validateLabel,
} from "../../src/onboarding/commands.ts";
import { InMemoryConfigStore } from "../../src/config/store.ts";
import { InMemorySecretStore } from "../../src/signers/secret-store.ts";
import { DEFAULT_SERVICE } from "../../src/signers/keychain.ts";

const PK = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const ADDRESS = privateKeyToAccount(PK).address;
const PK_2 = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;

let config: InMemoryConfigStore;
let store: InMemorySecretStore;

beforeEach(() => {
  config = new InMemoryConfigStore();
  store = new InMemorySecretStore();
});

const deps = () => ({
  store,
  config,
  clock: () => 1_700_000_000,
});

describe("validateLabel", () => {
  it("accepts typical labels", () => {
    expect(() => validateLabel("keychain:main")).not.toThrow();
    expect(() => validateLabel("ledger.0")).not.toThrow();
    expect(() => validateLabel("ops_2026-04")).not.toThrow();
  });

  it("rejects empty labels", () => {
    expect(() => validateLabel("")).toThrow(OnboardingError);
  });

  it("rejects labels > 64 chars", () => {
    expect(() => validateLabel("a".repeat(65))).toThrow(/≤ 64/);
  });

  it("rejects invalid characters", () => {
    expect(() => validateLabel("has space")).toThrow();
    expect(() => validateLabel("slash/bad")).toThrow();
    expect(() => validateLabel("quote'bad")).toThrow();
  });
});

describe("slugifyLabel", () => {
  it("replaces :_. with -", () => {
    expect(slugifyLabel("keychain:main")).toBe("keychain-main");
    expect(slugifyLabel("ledger.0")).toBe("ledger-0");
    expect(slugifyLabel("ops_2026")).toBe("ops-2026");
  });

  it("is a no-op for already-slugified labels", () => {
    expect(slugifyLabel("keychain-main")).toBe("keychain-main");
  });
});

describe("initWallet", () => {
  it("generates a private key and stores it in the secret store", async () => {
    const result = await initWallet(
      { ...deps(), random: () => PK },
      { label: "keychain:main", chains: [8453] },
    );
    expect(result.address).toBe(ADDRESS);
    expect(await store.get(DEFAULT_SERVICE, "keychain-main")).toBe(PK);
  });

  it("appends a signer entry to the config", async () => {
    await initWallet(
      { ...deps(), random: () => PK },
      { label: "keychain:main", chains: [8453] },
    );
    const cfg = await config.load();
    expect(cfg.signers).toHaveLength(1);
    expect(cfg.signers[0]).toMatchObject({
      label: "keychain:main",
      address: ADDRESS,
      chains: [8453],
      keychainService: DEFAULT_SERVICE,
      keychainAccount: "keychain-main",
      createdAt: 1_700_000_000,
    });
  });

  it("defaults to a real random source", async () => {
    await initWallet(deps(), { label: "k1", chains: [1] });
    const cfg = await config.load();
    expect(cfg.signers[0]!.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("rejects invalid chains", async () => {
    await expect(initWallet(deps(), { label: "k", chains: [] })).rejects.toThrow(/chains/);
    await expect(initWallet(deps(), { label: "k", chains: [-1] })).rejects.toThrow();
  });

  it("rejects duplicate labels", async () => {
    await initWallet({ ...deps(), random: () => PK }, { label: "k", chains: [1] });
    await expect(
      initWallet({ ...deps(), random: () => PK_2 }, { label: "k", chains: [1] }),
    ).rejects.toThrow(/already exists/);
  });

  it("rejects when a keychain secret already exists for the slugified label", async () => {
    await store.set(DEFAULT_SERVICE, "keychain-main", PK);
    await expect(
      initWallet({ ...deps(), random: () => PK }, { label: "keychain:main", chains: [1] }),
    ).rejects.toThrow(/Secret already exists/);
    // Config must not have been mutated.
    expect((await config.load()).signers).toHaveLength(0);
  });
});

describe("importKey", () => {
  it("imports an existing key", async () => {
    const result = await importKey(deps(), { label: "imported", chains: [1], privateKey: PK });
    expect(result.address).toBe(ADDRESS);
    expect(await store.get(DEFAULT_SERVICE, "imported")).toBe(PK);
  });

  it("rejects malformed private keys", async () => {
    await expect(
      importKey(deps(), { label: "x", chains: [1], privateKey: "0x1234" as Hex }),
    ).rejects.toThrow(/32-byte hex/);
    await expect(
      importKey(deps(), { label: "x", chains: [1], privateKey: "deadbeef" as Hex }),
    ).rejects.toThrow();
  });
});

describe("listSigners", () => {
  it("returns all registered signers as summaries", async () => {
    await initWallet({ ...deps(), random: () => PK }, { label: "a", chains: [1] });
    await initWallet({ ...deps(), random: () => PK_2 }, { label: "b", chains: [8453] });
    const list = await listSigners(deps());
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.label).sort()).toEqual(["a", "b"]);
    expect(list[0]!.keychainAccount).toBe("a");
  });

  it("returns [] on an empty config", async () => {
    expect(await listSigners(deps())).toEqual([]);
  });
});

describe("showAddress", () => {
  it("returns the address for a known label", async () => {
    await initWallet({ ...deps(), random: () => PK }, { label: "a", chains: [1] });
    expect(await showAddress(deps(), "a")).toBe(ADDRESS);
  });

  it("throws for an unknown label", async () => {
    await expect(showAddress(deps(), "missing")).rejects.toThrow(/No signer with label/);
  });
});

describe("removeSigner", () => {
  it("deletes the secret and the config entry", async () => {
    await initWallet({ ...deps(), random: () => PK }, { label: "a", chains: [1] });
    await removeSigner(deps(), "a");
    expect(await store.get(DEFAULT_SERVICE, "a")).toBeUndefined();
    expect(await listSigners(deps())).toEqual([]);
  });

  it("throws for an unknown label", async () => {
    await expect(removeSigner(deps(), "missing")).rejects.toThrow(/No signer with label/);
  });

  it("preserves other signers", async () => {
    await initWallet({ ...deps(), random: () => PK }, { label: "a", chains: [1] });
    await initWallet({ ...deps(), random: () => PK_2 }, { label: "b", chains: [1] });
    await removeSigner(deps(), "a");
    const list = await listSigners(deps());
    expect(list.map((s) => s.label)).toEqual(["b"]);
  });
});
