import { describe, expect, it } from "bun:test";
import { parseConfig } from "../../src/config/parse.ts";
import { CONFIG_VERSION } from "../../src/config/types.ts";

const base = {
  version: CONFIG_VERSION,
  signers: [],
  policy: { maxAmountPerRequest: "20000" },
};

const validSigner = {
  label: "keychain:main",
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  chains: [8453],
  keychainService: "x402-agent-wallet",
  keychainAccount: "keychain-main",
  createdAt: 1_700_000_000,
};

describe("parseConfig", () => {
  it("accepts a minimal config", () => {
    const c = parseConfig({ ...base });
    expect(c.version).toBe(CONFIG_VERSION);
    expect(c.signers).toEqual([]);
    expect(c.policy.maxAmountPerRequest).toBe("20000");
  });

  it("preserves signers + policy + approver", () => {
    const c = parseConfig({
      ...base,
      signers: [validSigner],
      policy: {
        maxAmountPerRequest: "30000",
        perDayCap: "1000000",
        perOriginBudgets: { "https://a.test": "20000" },
        assetAllowlist: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
        networkAllowlist: [8453, 1],
        originAllowlist: ["https://a.test"],
        payToAllowlist: ["0x687E3217668DDe7c32478A3F2613750c8Bd505E9"],
        requireApproval: true,
      },
      approver: { kind: "osascript", title: "X", timeoutMs: 60000 },
      dbPath: "/tmp/db.sqlite",
    });
    expect(c.signers).toHaveLength(1);
    expect(c.signers[0]!.label).toBe("keychain:main");
    expect(c.policy.perDayCap).toBe("1000000");
    expect(c.policy.perOriginBudgets).toEqual({ "https://a.test": "20000" });
    expect(c.policy.networkAllowlist).toEqual([8453, 1]);
    expect(c.policy.requireApproval).toBe(true);
    expect(c.approver).toEqual({ kind: "osascript", title: "X", timeoutMs: 60000 });
    expect(c.dbPath).toBe("/tmp/db.sqlite");
  });

  for (const v of [null, 42, "string", []] as const) {
    it(`rejects non-object root ${JSON.stringify(v)}`, () => {
      expect(() => parseConfig(v as unknown)).toThrow();
    });
  }

  it("rejects missing version", () => {
    expect(() => parseConfig({ signers: [], policy: { maxAmountPerRequest: "1" } })).toThrow(/version/);
  });

  it("rejects unknown version", () => {
    expect(() => parseConfig({ ...base, version: 99 })).toThrow(/Unsupported config version/);
  });

  it("rejects duplicate signer labels", () => {
    expect(() =>
      parseConfig({
        ...base,
        signers: [validSigner, { ...validSigner, address: "0x687E3217668DDe7c32478A3F2613750c8Bd505E9" }],
      }),
    ).toThrow(/Duplicate signer label/);
  });

  it("rejects invalid signer address", () => {
    expect(() => parseConfig({ ...base, signers: [{ ...validSigner, address: "0x123" }] })).toThrow(
      /not a valid Ethereum address/,
    );
  });

  it("rejects empty chains array", () => {
    expect(() => parseConfig({ ...base, signers: [{ ...validSigner, chains: [] }] })).toThrow(
      /non-empty array/,
    );
  });

  it("rejects non-integer chain ids", () => {
    expect(() => parseConfig({ ...base, signers: [{ ...validSigner, chains: [1.5] }] })).toThrow(
      /positive integer chain id/,
    );
    expect(() => parseConfig({ ...base, signers: [{ ...validSigner, chains: [-1] }] })).toThrow();
    expect(() => parseConfig({ ...base, signers: [{ ...validSigner, chains: [0] }] })).toThrow();
  });

  it("rejects missing policy.maxAmountPerRequest", () => {
    expect(() => parseConfig({ ...base, policy: {} })).toThrow(/maxAmountPerRequest/);
  });

  it("rejects non-numeric policy values", () => {
    expect(() => parseConfig({ ...base, policy: { maxAmountPerRequest: "abc" } })).toThrow();
    expect(() => parseConfig({ ...base, policy: { maxAmountPerRequest: "-1" } })).toThrow();
  });

  it("accepts policy.maxAmountPerRequest as a number", () => {
    const c = parseConfig({ ...base, policy: { maxAmountPerRequest: 20000 } });
    expect(c.policy.maxAmountPerRequest).toBe("20000");
  });

  it("rejects unknown approver kind", () => {
    expect(() => parseConfig({ ...base, approver: { kind: "smoke-signals" } })).toThrow(
      /Unknown approver kind/,
    );
  });

  it("parses touchid approver", () => {
    const c = parseConfig({
      ...base,
      approver: { kind: "touchid", binary: "/custom/path", timeoutMs: 30000 },
    });
    expect(c.approver).toEqual({ kind: "touchid", binary: "/custom/path", timeoutMs: 30000 });
  });

  it("parses touchid approver with defaults", () => {
    const c = parseConfig({ ...base, approver: { kind: "touchid" } });
    expect(c.approver).toEqual({ kind: "touchid" });
  });

  it("parses exec approver with codeToReason", () => {
    const c = parseConfig({
      ...base,
      approver: {
        kind: "exec",
        binary: "/bin/a",
        codeToReason: { 10: "user cancelled", 11: "unavailable" },
      },
    });
    expect(c.approver).toEqual({
      kind: "exec",
      binary: "/bin/a",
      codeToReason: { 10: "user cancelled", 11: "unavailable" },
    });
  });

  it("rejects non-integer codeToReason keys", () => {
    expect(() =>
      parseConfig({
        ...base,
        approver: { kind: "exec", binary: "/bin/a", codeToReason: { foo: "x" } },
      }),
    ).toThrow(/not an integer/);
  });

  it("rejects empty codeToReason values", () => {
    expect(() =>
      parseConfig({
        ...base,
        approver: { kind: "exec", binary: "/bin/a", codeToReason: { "10": "" } },
      }),
    ).toThrow(/non-empty string/);
  });

  it("parses exec approver with args", () => {
    const c = parseConfig({
      ...base,
      approver: {
        kind: "exec",
        binary: "/bin/approver",
        args: ["--json"],
        timeoutMs: 60000,
        passRequestOnStdin: true,
      },
    });
    expect(c.approver).toEqual({
      kind: "exec",
      binary: "/bin/approver",
      args: ["--json"],
      timeoutMs: 60000,
      passRequestOnStdin: true,
    });
  });
});
