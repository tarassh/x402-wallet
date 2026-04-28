import { describe, expect, it } from "bun:test";
import { recoverTypedDataAddress } from "viem";
import type { TypedDataDefinition } from "viem";
import { MockSigner } from "../../src/signers/mock.ts";
import { InMemorySignerRegistry } from "../../src/signers/types.ts";

const sampleTyped = (verifyingContract: `0x${string}`): TypedDataDefinition => ({
  domain: {
    name: "USD Coin",
    version: "2",
    chainId: 8453,
    verifyingContract,
  },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: {
    from: "0x0000000000000000000000000000000000000001",
    to: "0x0000000000000000000000000000000000000002",
    value: 20000n,
    validAfter: 0n,
    validBefore: 2000000000n,
    nonce: "0x0000000000000000000000000000000000000000000000000000000000000001",
  },
});

describe("MockSigner", () => {
  it("exposes address, chains, label", () => {
    const s = new MockSigner({ label: "test:a", chains: [8453, 1] });
    expect(s.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(s.chains).toEqual([8453, 1]);
    expect(s.label).toBe("test:a");
  });

  it("signTypedData produces a recoverable signature", async () => {
    const s = new MockSigner({ label: "t", chains: [8453] });
    const payload = sampleTyped("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    const sig = await s.signTypedData(payload);
    expect(sig).toMatch(/^0x[0-9a-fA-F]{130}$/);
    const recovered = await recoverTypedDataAddress({ ...payload, signature: sig });
    expect(recovered.toLowerCase()).toBe(s.address.toLowerCase());
  });

  it("is deterministic for a given private key", async () => {
    const pk = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
    const a = new MockSigner({ label: "a", chains: [1], privateKey: pk });
    const b = new MockSigner({ label: "b", chains: [1], privateKey: pk });
    expect(a.address).toBe(b.address);
    const payload = sampleTyped("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(await a.signTypedData(payload)).toBe(await b.signTypedData(payload));
  });

  it("counts sign invocations", async () => {
    const s = new MockSigner({ label: "c", chains: [1] });
    expect(s.signCallCount).toBe(0);
    await s.signTypedData(sampleTyped("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"));
    await s.signTypedData(sampleTyped("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"));
    expect(s.signCallCount).toBe(2);
  });
});

describe("InMemorySignerRegistry", () => {
  it("lists all signers", () => {
    const a = new MockSigner({ label: "a", chains: [8453] });
    const b = new MockSigner({ label: "b", chains: [1] });
    const reg = new InMemorySignerRegistry([a, b]);
    expect(reg.list()).toHaveLength(2);
  });

  it("finds by address case-insensitively", () => {
    const a = new MockSigner({ label: "a", chains: [8453] });
    const reg = new InMemorySignerRegistry([a]);
    expect(reg.findByAddress(a.address)).toBe(a);
    expect(reg.findByAddress(a.address.toUpperCase() as `0x${string}`)).toBe(a);
  });

  it("returns undefined for unknown address", () => {
    const reg = new InMemorySignerRegistry([]);
    expect(reg.findByAddress("0x0000000000000000000000000000000000000000")).toBeUndefined();
  });

  it("filters by chain", () => {
    const a = new MockSigner({ label: "a", chains: [8453, 1] });
    const b = new MockSigner({ label: "b", chains: [1] });
    const c = new MockSigner({ label: "c", chains: [137] });
    const reg = new InMemorySignerRegistry([a, b, c]);
    expect(reg.findForChain(8453)).toEqual([a]);
    expect(reg.findForChain(1)).toEqual([a, b]);
    expect(reg.findForChain(137)).toEqual([c]);
    expect(reg.findForChain(999)).toEqual([]);
  });

  it("rejects duplicate labels", () => {
    const a = new MockSigner({ label: "dup", chains: [1] });
    const b = new MockSigner({ label: "dup", chains: [8453] });
    expect(() => new InMemorySignerRegistry([a, b])).toThrow(/Duplicate signer label/);
  });
});
