import { describe, expect, test } from "bun:test";
import {
  addOriginAllowlist,
  atomicToUsdc,
  ConfigEditError,
  removeOriginAllowlist,
  removeOriginBudget,
  setApprover,
  setLimits,
  setOriginBudget,
  summarize,
  usdcToAtomic,
} from "../../src/onboarding/config-actions.ts";
import { DEFAULT_CONFIG } from "../../src/config/types.ts";
import type { WalletConfig } from "../../src/config/types.ts";

const baseConfig: WalletConfig = {
  ...DEFAULT_CONFIG,
  policy: {
    maxAmountPerRequest: "10000", // 0.01 USDC
  },
  approver: { kind: "none" },
};

describe("usdcToAtomic", () => {
  test.each([
    ["1", "1000000"],
    ["0.10", "100000"],
    ["0.000001", "1"],
    ["10.5", "10500000"],
    ["0", "0"],
    ["0.0", "0"],
    ["100", "100000000"],
  ])("%s USDC -> %s atomic", (input, expected) => {
    expect(usdcToAtomic(input)).toBe(expected);
  });

  test("trims whitespace", () => {
    expect(usdcToAtomic(" 0.1 ")).toBe("100000");
  });

  test.each(["abc", "-1", "1.2.3", "0.0000001", ""])("rejects %p", (bad) => {
    expect(() => usdcToAtomic(bad)).toThrow(ConfigEditError);
  });
});

describe("atomicToUsdc roundtrip", () => {
  test.each(["1", "100000", "1000000", "10500000", "0"])("%s roundtrips", (atomic) => {
    const usdc = atomicToUsdc(atomic);
    expect(usdcToAtomic(usdc)).toBe(atomic);
  });
});

describe("setLimits", () => {
  test("updates per-request and per-day", () => {
    const next = setLimits(baseConfig, { perRequest: "0.10", perDay: "1.00" });
    expect(next.policy.maxAmountPerRequest).toBe("100000");
    expect(next.policy.perDayCap).toBe("1000000");
  });

  test("null per-day removes the cap", () => {
    const withDay = setLimits(baseConfig, { perDay: "5.00" });
    const cleared = setLimits(withDay, { perDay: null });
    expect(cleared.policy.perDayCap).toBeUndefined();
  });

  test("does not mutate input", () => {
    const before = JSON.parse(JSON.stringify(baseConfig));
    setLimits(baseConfig, { perRequest: "0.20" });
    expect(baseConfig).toEqual(before);
  });

  test("rejects bad amount", () => {
    expect(() => setLimits(baseConfig, { perRequest: "nope" })).toThrow(ConfigEditError);
  });
});

describe("setApprover", () => {
  test.each([
    { kind: "none" } as const,
    { kind: "osascript", title: "x402" } as const,
    { kind: "touchid" } as const,
    { kind: "exec", binary: "/usr/local/bin/foo" } as const,
  ])("accepts approver kind %p", (approver) => {
    const next = setApprover(baseConfig, approver);
    expect(next.approver).toEqual(approver);
  });
});

describe("origin allowlist", () => {
  test("add then list", () => {
    const a = addOriginAllowlist(baseConfig, "https://transit402.dev");
    const b = addOriginAllowlist(a, "https://example.com");
    expect(b.policy.originAllowlist).toEqual([
      "https://transit402.dev",
      "https://example.com",
    ]);
  });

  test("dedupes", () => {
    const a = addOriginAllowlist(baseConfig, "https://x.test");
    const b = addOriginAllowlist(a, "https://x.test");
    expect(b.policy.originAllowlist).toEqual(["https://x.test"]);
  });

  test("remove last entry drops the field", () => {
    const a = addOriginAllowlist(baseConfig, "https://x.test");
    const b = removeOriginAllowlist(a, "https://x.test");
    expect(b.policy.originAllowlist).toBeUndefined();
  });

  test("rejects non-URL origin", () => {
    expect(() => addOriginAllowlist(baseConfig, "not-a-url")).toThrow(ConfigEditError);
  });

  test("rejects URL with path (must be bare origin)", () => {
    expect(() => addOriginAllowlist(baseConfig, "https://x.test/path")).toThrow(
      ConfigEditError,
    );
  });
});

describe("origin budgets", () => {
  test("set + remove", () => {
    const a = setOriginBudget(baseConfig, "https://x.test", "0.50");
    expect(a.policy.perOriginBudgets).toEqual({ "https://x.test": "500000" });

    const b = removeOriginBudget(a, "https://x.test");
    expect(b.policy.perOriginBudgets).toBeUndefined();
  });

  test("update existing budget", () => {
    const a = setOriginBudget(baseConfig, "https://x.test", "0.50");
    const b = setOriginBudget(a, "https://x.test", "1.00");
    expect(b.policy.perOriginBudgets).toEqual({ "https://x.test": "1000000" });
  });
});

describe("summarize", () => {
  test("summarizes a fully-loaded config", () => {
    const config: WalletConfig = {
      ...baseConfig,
      policy: {
        maxAmountPerRequest: "100000",
        perDayCap: "1000000",
        perOriginBudgets: { "https://x.test": "500000" },
        originAllowlist: ["https://x.test"],
      },
      approver: { kind: "osascript" },
    };
    expect(summarize(config)).toEqual({
      perRequestUsdc: "0.1",
      perDayUsdc: "1",
      approver: "osascript",
      originAllowlist: ["https://x.test"],
      originBudgets: [{ origin: "https://x.test", usdc: "0.5" }],
      signerCount: 0,
    });
  });

  test("missing per-day cap reads as null", () => {
    expect(summarize(baseConfig).perDayUsdc).toBeNull();
  });
});
