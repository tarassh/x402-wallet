import { describe, expect, it } from "bun:test";
import { hashTypedData, recoverTypedDataAddress } from "viem";
import {
  buildAuthorization,
  buildPaymentPayload,
  encodePaymentHeader,
  generateNonce,
} from "../../src/x402/authorization.ts";
import type { X402Accept } from "../../src/x402/types.ts";
import { MockSigner } from "../../src/signers/mock.ts";

const baseAccept: X402Accept = {
  scheme: "exact",
  network: "eip155:8453",
  chainId: 8453,
  amount: 20000n,
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x687E3217668DDe7c32478A3F2613750c8Bd505E9",
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
  resource: "https://transit402.dev/subway/nearest",
};

describe("buildAuthorization", () => {
  const nonce = "0x0000000000000000000000000000000000000000000000000000000000000001" as const;
  const from = "0x0000000000000000000000000000000000000111" as const;

  it("builds a TypedDataDefinition with USDC domain", () => {
    const td = buildAuthorization({ accept: baseAccept, from, nonce, now: 1_700_000_000 });
    expect(td.domain?.name).toBe("USD Coin");
    expect(td.domain?.version).toBe("2");
    expect(td.domain?.chainId).toBe(8453);
    expect(td.domain?.verifyingContract).toBe(baseAccept.asset);
    expect(td.primaryType).toBe("TransferWithAuthorization");
  });

  it("sets value/from/to/nonce on the message", () => {
    const td = buildAuthorization({ accept: baseAccept, from, nonce, now: 1_700_000_000 });
    expect(td.message.value).toBe(20000n);
    expect(td.message.from.toLowerCase()).toBe(from);
    expect(td.message.to).toBe(baseAccept.payTo);
    expect(td.message.nonce).toBe(nonce);
  });

  it("computes validAfter = now - 60 clamped >= 0 and validBefore = now + timeout", () => {
    const td = buildAuthorization({ accept: baseAccept, from, nonce, now: 1_700_000_000 });
    expect(td.message.validAfter).toBe(BigInt(1_700_000_000 - 60));
    expect(td.message.validBefore).toBe(BigInt(1_700_000_000 + 300));

    const td2 = buildAuthorization({ accept: baseAccept, from, nonce, now: 10 });
    expect(td2.message.validAfter).toBe(0n);
  });

  it("is deterministic for identical inputs", () => {
    const a = buildAuthorization({ accept: baseAccept, from, nonce, now: 1_700_000_000 });
    const b = buildAuthorization({ accept: baseAccept, from, nonce, now: 1_700_000_000 });
    expect(hashTypedData(a)).toBe(hashTypedData(b));
  });

  it("rejects malformed nonce", () => {
    expect(() =>
      buildAuthorization({ accept: baseAccept, from, nonce: "0x1234" as `0x${string}`, now: 1 }),
    ).toThrow(/nonce must be 32 bytes/);
  });

  it("produces a signature recoverable to the signer's address", async () => {
    const signer = new MockSigner({ label: "t", chains: [8453] });
    const td = buildAuthorization({ accept: baseAccept, from: signer.address, nonce, now: 1_700_000_000 });
    const sig = await signer.signTypedData(td);
    const recovered = await recoverTypedDataAddress({ ...td, signature: sig });
    expect(recovered.toLowerCase()).toBe(signer.address.toLowerCase());
  });
});

describe("generateNonce", () => {
  it("produces a 0x-prefixed 32-byte hex", () => {
    const n = generateNonce();
    expect(n).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("accepts an injected RNG", () => {
    const bytes = new Uint8Array(32);
    bytes[0] = 0xab;
    bytes[31] = 0xcd;
    const n = generateNonce(() => bytes);
    expect(n).toBe(`0xab${"00".repeat(30)}cd`);
  });

  it("rejects wrong-length RNG output", () => {
    expect(() => generateNonce(() => new Uint8Array(16))).toThrow(/32 bytes/);
  });

  it("produces unique nonces on repeated calls (sanity)", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });
});

describe("encodePaymentHeader / buildPaymentPayload", () => {
  it("round-trips to base64 JSON", () => {
    const payload = buildPaymentPayload(
      baseAccept,
      {
        from: "0x0000000000000000000000000000000000000111",
        to: baseAccept.payTo,
        value: 20000n,
        validAfter: 0n,
        validBefore: 1n,
        nonce: "0x0000000000000000000000000000000000000000000000000000000000000001",
      },
      ("0x" + "a".repeat(130)) as `0x${string}`,
    );
    const header = encodePaymentHeader(payload);
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.scheme).toBe("exact");
    expect(decoded.network).toBe("eip155:8453");
    expect(decoded.payload.authorization.value).toBe("20000");
    expect(decoded.payload.authorization.from).toBe("0x0000000000000000000000000000000000000111");
  });

  it("stringifies bigints as decimal strings", () => {
    const payload = buildPaymentPayload(
      baseAccept,
      {
        from: "0x0000000000000000000000000000000000000111",
        to: baseAccept.payTo,
        value: 12345678901234567890n,
        validAfter: 100n,
        validBefore: 200n,
        nonce: "0x0000000000000000000000000000000000000000000000000000000000000002",
      },
      ("0x" + "b".repeat(130)) as `0x${string}`,
    );
    expect(payload.payload.authorization.value).toBe("12345678901234567890");
    expect(payload.payload.authorization.validAfter).toBe("100");
    expect(payload.payload.authorization.validBefore).toBe("200");
  });
});
