import { describe, expect, it } from "bun:test";
import {
  decodePaymentRequiredHeader,
  parseChallengeJson,
  parseNetwork,
  tryExtractChallenge,
} from "../../src/x402/parse.ts";
import { X402ParseError } from "../../src/x402/types.ts";

const validAccept = {
  scheme: "exact",
  network: "eip155:8453",
  amount: "20000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x687E3217668DDe7c32478A3F2613750c8Bd505E9",
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
  resource: "https://transit402.dev/subway/nearest",
  description: "Nearby subway stations",
};

const validChallenge = {
  x402Version: 2,
  accepts: [validAccept],
  resource: {
    url: "https://transit402.dev/subway/nearest",
    method: "GET",
    description: "...",
    mimeType: "application/json",
  },
};

describe("parseNetwork", () => {
  it.each([
    ["eip155:1", 1],
    ["eip155:8453", 8453],
    ["eip155:137", 137],
  ] as const)("parses %s", (net, expected) => {
    expect(parseNetwork(net)).toBe(expected);
  });

  it.each(["solana:mainnet", "8453", "", null, 8453, "eip155:", "eip155:0", "eip155:-1", "eip155:abc"])(
    "rejects %p",
    (v) => {
      expect(() => parseNetwork(v as unknown)).toThrow(X402ParseError);
    },
  );
});

describe("parseChallengeJson", () => {
  it("parses a valid challenge", () => {
    const c = parseChallengeJson(validChallenge);
    expect(c.version).toBe(2);
    expect(c.accepts).toHaveLength(1);
    const a = c.accepts[0]!;
    expect(a.scheme).toBe("exact");
    expect(a.chainId).toBe(8453);
    expect(a.amount).toBe(20000n);
    expect(a.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(a.payTo).toBe("0x687E3217668DDe7c32478A3F2613750c8Bd505E9");
    expect(a.maxTimeoutSeconds).toBe(300);
    expect(a.extra).toEqual({ name: "USD Coin", version: "2" });
    expect(c.resource?.url).toBe("https://transit402.dev/subway/nearest");
  });

  it("rejects non-object input", () => {
    expect(() => parseChallengeJson(null)).toThrow(/not an object/);
    expect(() => parseChallengeJson("nope")).toThrow(/not an object/);
    expect(() => parseChallengeJson(42)).toThrow(/not an object/);
  });

  it("rejects wrong version", () => {
    expect(() => parseChallengeJson({ ...validChallenge, x402Version: 1 })).toThrow(/Unsupported x402Version/);
    expect(() => parseChallengeJson({ ...validChallenge, x402Version: undefined })).toThrow();
  });

  it("rejects missing/empty accepts", () => {
    expect(() => parseChallengeJson({ x402Version: 2 })).toThrow(/no accepts/);
    expect(() => parseChallengeJson({ x402Version: 2, accepts: [] })).toThrow(/no accepts/);
    expect(() => parseChallengeJson({ x402Version: 2, accepts: "nope" })).toThrow(/no accepts/);
  });

  it("rejects unsupported scheme", () => {
    const bad = { ...validChallenge, accepts: [{ ...validAccept, scheme: "upto" }] };
    expect(() => parseChallengeJson(bad)).toThrow(/Unsupported scheme/);
  });

  it("rejects non-eip155 network", () => {
    const bad = { ...validChallenge, accepts: [{ ...validAccept, network: "solana:mainnet" }] };
    expect(() => parseChallengeJson(bad)).toThrow(/Unsupported network/);
  });

  it("rejects invalid addresses", () => {
    expect(() =>
      parseChallengeJson({ ...validChallenge, accepts: [{ ...validAccept, asset: "not-an-address" }] }),
    ).toThrow(/Invalid address/);
    expect(() =>
      parseChallengeJson({ ...validChallenge, accepts: [{ ...validAccept, payTo: "0x123" }] }),
    ).toThrow(/Invalid address/);
  });

  it("rejects negative or non-numeric amount", () => {
    expect(() =>
      parseChallengeJson({ ...validChallenge, accepts: [{ ...validAccept, amount: "-1" }] }),
    ).toThrow(/Invalid integer/);
    expect(() =>
      parseChallengeJson({ ...validChallenge, accepts: [{ ...validAccept, amount: "abc" }] }),
    ).toThrow(/Invalid integer/);
  });

  it("requires extra.name and extra.version", () => {
    expect(() =>
      parseChallengeJson({ ...validChallenge, accepts: [{ ...validAccept, extra: { name: "X" } }] }),
    ).toThrow(/extra\.version/);
  });

  it("requires maxTimeoutSeconds > 0 integer", () => {
    expect(() =>
      parseChallengeJson({ ...validChallenge, accepts: [{ ...validAccept, maxTimeoutSeconds: 0 }] }),
    ).toThrow(/maxTimeoutSeconds/);
    expect(() =>
      parseChallengeJson({ ...validChallenge, accepts: [{ ...validAccept, maxTimeoutSeconds: -5 }] }),
    ).toThrow(/maxTimeoutSeconds/);
    expect(() =>
      parseChallengeJson({ ...validChallenge, accepts: [{ ...validAccept, maxTimeoutSeconds: 1.5 }] }),
    ).toThrow(/maxTimeoutSeconds/);
  });

  it("accepts multiple accepts entries", () => {
    const c = parseChallengeJson({
      ...validChallenge,
      accepts: [
        validAccept,
        { ...validAccept, network: "eip155:1", resource: "https://x.test/other" },
      ],
    });
    expect(c.accepts).toHaveLength(2);
    expect(c.accepts[1]!.chainId).toBe(1);
  });

  it("ignores malformed resource info", () => {
    const c = parseChallengeJson({ ...validChallenge, resource: "not-an-object" });
    expect(c.resource).toBeUndefined();
  });
});

describe("decodePaymentRequiredHeader", () => {
  it("decodes a base64-encoded JSON challenge", () => {
    const b64 = Buffer.from(JSON.stringify(validChallenge)).toString("base64");
    const c = decodePaymentRequiredHeader(b64);
    expect(c.accepts[0]!.amount).toBe(20000n);
  });

  it("rejects empty string", () => {
    expect(() => decodePaymentRequiredHeader("")).toThrow(/Empty/);
  });

  it("rejects non-JSON base64", () => {
    const b64 = Buffer.from("not json").toString("base64");
    expect(() => decodePaymentRequiredHeader(b64)).toThrow(/not valid JSON/);
  });

  it("handles the real transit402.dev challenge", () => {
    // Sample captured live from the server.
    const b64 = Buffer.from(JSON.stringify(validChallenge)).toString("base64");
    const c = decodePaymentRequiredHeader(b64);
    expect(c.accepts[0]!.payTo).toBe("0x687E3217668DDe7c32478A3F2613750c8Bd505E9");
  });
});

describe("tryExtractChallenge", () => {
  it("returns undefined for non-402", () => {
    const headers = new Headers();
    expect(tryExtractChallenge({ status: 200, headers })).toBeUndefined();
  });

  it("returns undefined for 402 without header", () => {
    const headers = new Headers();
    expect(tryExtractChallenge({ status: 402, headers })).toBeUndefined();
  });

  it("returns a challenge for 402 with header", () => {
    const headers = new Headers();
    headers.set("payment-required", Buffer.from(JSON.stringify(validChallenge)).toString("base64"));
    const c = tryExtractChallenge({ status: 402, headers });
    expect(c?.accepts[0]!.chainId).toBe(8453);
  });
});
