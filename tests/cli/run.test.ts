import { beforeEach, describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { run } from "../../src/cli/run.ts";
import type { CliDeps } from "../../src/cli/run.ts";
import type { HttpResponse, HttpTransport } from "../../src/orchestrator/types.ts";
import { FakeIo } from "./fake-io.ts";
import { InMemoryConfigStore } from "../../src/config/store.ts";
import { InMemorySecretStore } from "../../src/signers/secret-store.ts";
import { DEFAULT_SERVICE } from "../../src/signers/keychain.ts";

const PK = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const ADDRESS = privateKeyToAccount(PK).address;
const PK_2 = "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
const ADDRESS_2 = privateKeyToAccount(PK_2).address;

let config: InMemoryConfigStore;
let secrets: InMemorySecretStore;

beforeEach(() => {
  config = new InMemoryConfigStore();
  secrets = new InMemorySecretStore();
});

const noopTransport: HttpTransport = async () => ({
  status: 200,
  headers: new Headers(),
  body: "{}",
});

const mkDeps = (
  io: FakeIo,
  random: () => `0x${string}` = () => PK,
  transport: HttpTransport = noopTransport,
): CliDeps => ({
  io,
  configPath: "/tmp/config.json",
  transport,
  onboarding: {
    store: secrets,
    config,
    clock: () => 1_700_000_000,
    random,
  },
});

describe("cli run", () => {
  it("help prints usage", async () => {
    const io = new FakeIo();
    const code = await run(["help"], mkDeps(io));
    expect(code).toBe(0);
    expect(io.stdoutBuf).toContain("USAGE");
    expect(io.stdoutBuf).toContain("init");
  });

  it("empty argv shows help", async () => {
    const io = new FakeIo();
    expect(await run([], mkDeps(io))).toBe(0);
    expect(io.stdoutBuf).toContain("USAGE");
  });

  it("--help alias works", async () => {
    const io = new FakeIo();
    expect(await run(["--help"], mkDeps(io))).toBe(0);
    expect(io.stdoutBuf).toContain("USAGE");
  });

  it("unknown command returns 64 and prints usage to stderr", async () => {
    const io = new FakeIo();
    expect(await run(["tango"], mkDeps(io))).toBe(64);
    expect(io.stderrBuf).toContain("Unknown command: tango");
    expect(io.stderrBuf).toContain("USAGE");
  });

  describe("init", () => {
    it("creates a wallet with default chain 8453", async () => {
      const io = new FakeIo();
      const code = await run(["init", "--label", "keychain:main"], mkDeps(io));
      expect(code).toBe(0);
      const payload = io.json() as Record<string, unknown>;
      expect(payload).toEqual({
        action: "init",
        label: "keychain:main",
        address: ADDRESS,
        chains: [8453],
        configPath: "/tmp/config.json",
      });
      expect(await secrets.get(DEFAULT_SERVICE, "keychain-main")).toBe(PK);
      expect(io.stderrBuf).toContain("Created signer");
    });

    it("accepts --chains", async () => {
      const io = new FakeIo();
      const code = await run(
        ["init", "--label", "multi", "--chains", "8453,1"],
        mkDeps(io),
      );
      expect(code).toBe(0);
      const payload = io.json() as Record<string, unknown>;
      expect(payload.chains).toEqual([8453, 1]);
    });

    it("returns 1 and reports error when label already exists", async () => {
      const io1 = new FakeIo();
      await run(["init", "--label", "dup"], mkDeps(io1));
      const io2 = new FakeIo();
      const code = await run(["init", "--label", "dup"], mkDeps(io2, () => PK_2));
      expect(code).toBe(1);
      expect(io2.stderrBuf).toContain("already exists");
    });

    it("requires --label", async () => {
      const io = new FakeIo();
      expect(await run(["init"], mkDeps(io))).toBe(1);
      expect(io.stderrBuf).toContain("--label");
    });
  });

  describe("import-key", () => {
    it("reads the key from stdin by default", async () => {
      const io = new FakeIo(PK + "\n");
      const code = await run(["import-key", "--label", "imported"], mkDeps(io));
      expect(code).toBe(0);
      const payload = io.json() as Record<string, unknown>;
      expect(payload.address).toBe(ADDRESS);
      expect(io.stderrBuf).toContain("Imported signer");
    });

    it("accepts --private-key but warns about shell history", async () => {
      const io = new FakeIo();
      const code = await run(
        ["import-key", "--label", "imported", "--private-key", PK],
        mkDeps(io),
      );
      expect(code).toBe(0);
      expect(io.stderrBuf).toContain("WARNING");
      expect(io.stderrBuf).toContain("shell history");
    });

    it("rejects empty stdin with no --private-key", async () => {
      const io = new FakeIo("");
      const code = await run(["import-key", "--label", "x"], mkDeps(io));
      expect(code).toBe(1);
      expect(io.stderrBuf).toContain("No private key");
    });

    it("rejects malformed private keys", async () => {
      const io = new FakeIo("not-a-key");
      const code = await run(["import-key", "--label", "x"], mkDeps(io));
      expect(code).toBe(1);
      expect(io.stderrBuf).toContain("32-byte hex");
    });
  });

  describe("list", () => {
    it("returns an empty list on a fresh wallet", async () => {
      const io = new FakeIo();
      const code = await run(["list"], mkDeps(io));
      expect(code).toBe(0);
      const parsed = io.json() as { signers: unknown[] };
      expect(parsed.signers).toEqual([]);
    });

    it("returns registered signers", async () => {
      await run(["init", "--label", "a"], mkDeps(new FakeIo(), () => PK));
      await run(["init", "--label", "b", "--chains", "1"], mkDeps(new FakeIo(), () => PK_2));
      const io = new FakeIo();
      await run(["list"], mkDeps(io));
      const parsed = io.json() as { signers: Array<{ label: string; address: string }> };
      expect(parsed.signers.map((s) => s.label).sort()).toEqual(["a", "b"]);
      const a = parsed.signers.find((s) => s.label === "a")!;
      const b = parsed.signers.find((s) => s.label === "b")!;
      expect(a.address).toBe(ADDRESS);
      expect(b.address).toBe(ADDRESS_2);
    });
  });

  describe("show-address", () => {
    beforeEach(async () => {
      await run(["init", "--label", "a"], mkDeps(new FakeIo()));
    });

    it("prints the address for a known label", async () => {
      const io = new FakeIo();
      const code = await run(["show-address", "a"], mkDeps(io));
      expect(code).toBe(0);
      expect(io.stdoutBuf.trim()).toBe(ADDRESS);
    });

    it("accepts --label form", async () => {
      const io = new FakeIo();
      await run(["show-address", "--label", "a"], mkDeps(io));
      expect(io.stdoutBuf.trim()).toBe(ADDRESS);
    });

    it("fails with helpful error for unknown label", async () => {
      const io = new FakeIo();
      const code = await run(["show-address", "ghost"], mkDeps(io));
      expect(code).toBe(1);
      expect(io.stderrBuf).toContain("No signer");
    });

    it("fails when no label given", async () => {
      const io = new FakeIo();
      const code = await run(["show-address"], mkDeps(io));
      expect(code).toBe(1);
      expect(io.stderrBuf).toContain("requires a signer label");
    });
  });

  describe("balance", () => {
    const rpcResponse = (raw: string): HttpResponse => ({
      status: 200,
      headers: new Headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: raw }),
    });

    it("prints a balance per configured chain", async () => {
      await run(["init", "--label", "b", "--chains", "8453"], mkDeps(new FakeIo()));
      const calls: string[] = [];
      const transport: HttpTransport = async (req) => {
        calls.push(req.url);
        return rpcResponse("0x1e8480"); // 2 USDC
      };
      const io = new FakeIo();
      const code = await run(["balance", "b"], mkDeps(io, () => PK, transport));
      expect(code).toBe(0);
      const parsed = io.json() as { balances: Array<Record<string, unknown>> };
      expect(parsed.balances).toHaveLength(1);
      expect(parsed.balances[0]).toMatchObject({
        chainId: 8453,
        chainName: "Base",
        raw: "2000000",
        usdc: "2",
      });
      expect(calls).toEqual(["https://mainnet.base.org"]);
    });

    it("queries every chain for a multi-chain signer", async () => {
      await run(
        ["init", "--label", "m", "--chains", "8453,1"],
        mkDeps(new FakeIo()),
      );
      const transport: HttpTransport = async (req) => {
        return rpcResponse(req.url.includes("base") ? "0x1e8480" : "0xf4240"); // 1 USDC mainnet
      };
      const io = new FakeIo();
      await run(["balance", "m"], mkDeps(io, () => PK, transport));
      const parsed = io.json() as { balances: Array<Record<string, unknown>> };
      expect(parsed.balances).toHaveLength(2);
      const base = parsed.balances.find((b) => b.chainId === 8453)!;
      const mainnet = parsed.balances.find((b) => b.chainId === 1)!;
      expect(base.usdc).toBe("2");
      expect(mainnet.usdc).toBe("1");
    });

    it("per-chain failures surface as error rows, not fatal", async () => {
      await run(
        ["init", "--label", "mix", "--chains", "8453,1"],
        mkDeps(new FakeIo()),
      );
      const transport: HttpTransport = async (req) => {
        if (req.url.includes("base")) return rpcResponse("0x1e8480");
        return { status: 503, headers: new Headers(), body: "overloaded" };
      };
      const io = new FakeIo();
      const code = await run(["balance", "mix"], mkDeps(io, () => PK, transport));
      expect(code).toBe(0);
      const parsed = io.json() as { balances: Array<Record<string, unknown>> };
      const base = parsed.balances.find((b) => b.chainId === 8453)!;
      const mainnet = parsed.balances.find((b) => b.chainId === 1)!;
      expect(base.usdc).toBe("2");
      expect(mainnet.error).toContain("HTTP 503");
      expect(mainnet.usdc).toBeUndefined();
    });

    it("fails with helpful error for unknown label", async () => {
      const io = new FakeIo();
      const code = await run(["balance", "ghost"], mkDeps(io));
      expect(code).toBe(1);
      expect(io.stderrBuf).toContain("No signer");
    });

    it("fails when no label given", async () => {
      const io = new FakeIo();
      const code = await run(["balance"], mkDeps(io));
      expect(code).toBe(1);
      expect(io.stderrBuf).toContain("requires a signer label");
    });
  });

  describe("remove", () => {
    it("deletes secret + config entry", async () => {
      await run(["init", "--label", "zap"], mkDeps(new FakeIo()));
      const io = new FakeIo();
      const code = await run(["remove", "zap"], mkDeps(io));
      expect(code).toBe(0);
      expect(io.stdoutBuf).toContain('Removed signer "zap"');
      expect(await secrets.get(DEFAULT_SERVICE, "zap")).toBeUndefined();
      expect((await config.load()).signers).toEqual([]);
    });

    it("fails for unknown label", async () => {
      const io = new FakeIo();
      const code = await run(["remove", "ghost"], mkDeps(io));
      expect(code).toBe(1);
      expect(io.stderrBuf).toContain("No signer");
    });
  });
});
