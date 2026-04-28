import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "fs";
import * as path from "path";
import * as os from "os";
import {
  FileConfigStore,
  InMemoryConfigStore,
  defaultConfigPath,
} from "../../src/config/store.ts";
import { CONFIG_VERSION, DEFAULT_CONFIG } from "../../src/config/types.ts";
import type { WalletConfig } from "../../src/config/types.ts";
import { ConfigError } from "../../src/config/types.ts";

const sampleConfig: WalletConfig = {
  version: CONFIG_VERSION,
  signers: [
    {
      label: "keychain:main",
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      chains: [8453],
      keychainService: "x402-agent-wallet",
      keychainAccount: "keychain-main",
      createdAt: 1_700_000_000,
    },
  ],
  policy: { maxAmountPerRequest: "20000" },
  approver: { kind: "none" },
};

describe("InMemoryConfigStore", () => {
  it("round-trips configs", async () => {
    const s = new InMemoryConfigStore();
    expect(await s.load()).toEqual(DEFAULT_CONFIG);
    await s.save(sampleConfig);
    expect(await s.load()).toEqual(sampleConfig);
  });

  it("exposes the logical location", () => {
    expect(new InMemoryConfigStore().path()).toBe("<memory>");
    expect(new InMemoryConfigStore(DEFAULT_CONFIG, "mem://a").path()).toBe("mem://a");
  });
});

describe("FileConfigStore", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "x402-cfg-"));
  });
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns DEFAULT_CONFIG when the file does not exist", async () => {
    const store = new FileConfigStore(path.join(tmpDir, "missing", "config.json"));
    const loaded = await store.load();
    expect(loaded).toEqual(DEFAULT_CONFIG);
  });

  it("creates parent dirs and writes atomically", async () => {
    const cfgPath = path.join(tmpDir, "nested", "config.json");
    const store = new FileConfigStore(cfgPath);
    await store.save(sampleConfig);
    const stat = await fs.stat(cfgPath);
    expect(stat.isFile()).toBe(true);
    const reloaded = await store.load();
    expect(reloaded).toEqual(sampleConfig);
  });

  it("sets restrictive file permissions on the written config", async () => {
    const cfgPath = path.join(tmpDir, "config.json");
    const store = new FileConfigStore(cfgPath);
    await store.save(sampleConfig);
    const stat = await fs.stat(cfgPath);
    // Only check owner bits — the umask may add group/other read on some setups.
    expect(stat.mode & 0o077).toBe(0);
  });

  it("throws a ConfigError on invalid JSON", async () => {
    const cfgPath = path.join(tmpDir, "config.json");
    await fs.writeFile(cfgPath, "not json at all", "utf8");
    const store = new FileConfigStore(cfgPath);
    await expect(store.load()).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws a ConfigError on version mismatch", async () => {
    const cfgPath = path.join(tmpDir, "config.json");
    await fs.writeFile(cfgPath, JSON.stringify({ version: 99, signers: [], policy: { maxAmountPerRequest: "1" } }), "utf8");
    const store = new FileConfigStore(cfgPath);
    await expect(store.load()).rejects.toThrow(/Unsupported config version/);
  });

  it("refuses to save a config with an unexpected version", async () => {
    const cfgPath = path.join(tmpDir, "config.json");
    const store = new FileConfigStore(cfgPath);
    await expect(
      store.save({ ...sampleConfig, version: 99 as unknown as typeof CONFIG_VERSION }),
    ).rejects.toThrow(/Refusing to save/);
  });

  it("empty path construction throws", () => {
    expect(() => new FileConfigStore("")).toThrow();
  });
});

describe("defaultConfigPath", () => {
  it("resolves under $HOME", () => {
    expect(defaultConfigPath("/Users/test")).toBe("/Users/test/.config/x402-wallet/config.json");
  });

  it("throws when $HOME is unset", () => {
    expect(() => defaultConfigPath("")).toThrow();
  });
});
