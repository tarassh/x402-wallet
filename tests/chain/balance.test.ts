import { describe, expect, it } from "bun:test";
import {
  BalanceQueryError,
  encodeBalanceOfData,
  formatTokenAmount,
  queryUsdcBalance,
} from "../../src/chain/balance.ts";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../src/orchestrator/types.ts";

const ADDRESS = "0x7be582A029B1a029A91B90BEC90753fEBdb91485";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const jsonResp = (body: unknown, status = 200): HttpResponse => ({
  status,
  headers: new Headers(),
  body: JSON.stringify(body),
});

class StubTransport {
  calls: HttpRequest[] = [];
  responses: HttpResponse[] = [];
  transport: HttpTransport = async (req) => {
    this.calls.push(req);
    const r = this.responses.shift();
    if (!r) throw new Error("no mock response");
    return r;
  };
}

describe("encodeBalanceOfData", () => {
  it("encodes balanceOf(address) calldata correctly", () => {
    const data = encodeBalanceOfData(ADDRESS);
    expect(data).toBe(
      "0x70a08231" + "000000000000000000000000" + "7be582a029b1a029a91b90bec90753febdb91485",
    );
  });

  it("rejects invalid addresses", () => {
    expect(() => encodeBalanceOfData("not-an-address" as unknown as `0x${string}`)).toThrow(
      BalanceQueryError,
    );
    expect(() => encodeBalanceOfData("0x123" as unknown as `0x${string}`)).toThrow();
  });
});

describe("queryUsdcBalance", () => {
  it("returns the parsed balance on a valid response", async () => {
    const stub = new StubTransport();
    // 2_000_000 atomic = 2 USDC (6 decimals)
    stub.responses.push(jsonResp({ jsonrpc: "2.0", id: 1, result: "0x1e8480" }));
    const balance = await queryUsdcBalance({
      chainId: 8453,
      address: ADDRESS,
      rpcUrl: "https://mainnet.base.org",
      transport: stub.transport,
    });
    expect(balance).toBe(2_000_000n);

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.method).toBe("POST");
    expect(stub.calls[0]!.url).toBe("https://mainnet.base.org");
    const req = JSON.parse(stub.calls[0]!.body!);
    expect(req.method).toBe("eth_call");
    expect(req.params[0].to.toLowerCase()).toBe(USDC_BASE.toLowerCase());
    expect(req.params[0].data.startsWith("0x70a08231")).toBe(true);
  });

  it("handles a zero balance 0x0", async () => {
    const stub = new StubTransport();
    stub.responses.push(jsonResp({ jsonrpc: "2.0", id: 1, result: "0x0" }));
    const balance = await queryUsdcBalance({
      chainId: 8453,
      address: ADDRESS,
      rpcUrl: "x",
      transport: stub.transport,
    });
    expect(balance).toBe(0n);
  });

  it("handles empty 0x result as zero", async () => {
    const stub = new StubTransport();
    stub.responses.push(jsonResp({ jsonrpc: "2.0", id: 1, result: "0x" }));
    const balance = await queryUsdcBalance({
      chainId: 8453,
      address: ADDRESS,
      rpcUrl: "x",
      transport: stub.transport,
    });
    expect(balance).toBe(0n);
  });

  it("rejects unknown chains up front", async () => {
    const stub = new StubTransport();
    await expect(
      queryUsdcBalance({
        chainId: 9999,
        address: ADDRESS,
        rpcUrl: "x",
        transport: stub.transport,
      }),
    ).rejects.toThrow(/Unknown chain id/);
    expect(stub.calls).toHaveLength(0);
  });

  it("throws on non-2xx HTTP", async () => {
    const stub = new StubTransport();
    stub.responses.push({ status: 500, headers: new Headers(), body: "oops" });
    await expect(
      queryUsdcBalance({
        chainId: 8453,
        address: ADDRESS,
        rpcUrl: "x",
        transport: stub.transport,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("throws on invalid JSON", async () => {
    const stub = new StubTransport();
    stub.responses.push({ status: 200, headers: new Headers(), body: "not json" });
    await expect(
      queryUsdcBalance({
        chainId: 8453,
        address: ADDRESS,
        rpcUrl: "x",
        transport: stub.transport,
      }),
    ).rejects.toThrow(/invalid JSON/);
  });

  it("surfaces RPC-level errors", async () => {
    const stub = new StubTransport();
    stub.responses.push(jsonResp({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "bad" } }));
    await expect(
      queryUsdcBalance({
        chainId: 8453,
        address: ADDRESS,
        rpcUrl: "x",
        transport: stub.transport,
      }),
    ).rejects.toThrow(/bad/);
  });

  it("throws when result is missing or malformed", async () => {
    const stub = new StubTransport();
    stub.responses.push(jsonResp({ jsonrpc: "2.0", id: 1 }));
    await expect(
      queryUsdcBalance({ chainId: 8453, address: ADDRESS, rpcUrl: "x", transport: stub.transport }),
    ).rejects.toThrow(/unexpected result/);
  });
});

describe("formatTokenAmount", () => {
  it("renders USDC amounts", () => {
    expect(formatTokenAmount(2_000_000n, 6)).toBe("2");
    expect(formatTokenAmount(20_000n, 6)).toBe("0.02");
    expect(formatTokenAmount(0n, 6)).toBe("0");
    expect(formatTokenAmount(1_234_500n, 6)).toBe("1.2345");
  });
});
