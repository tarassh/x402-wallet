import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "../../src/mcp/build.ts";
import type { ToolRuntime } from "../../src/mcp/tools.ts";
import { PaymentOrchestrator } from "../../src/orchestrator/orchestrator.ts";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../src/orchestrator/types.ts";
import { InMemorySignerRegistry } from "../../src/signers/types.ts";
import { MockSigner } from "../../src/signers/mock.ts";
import { InMemorySpendHistory, PolicyEngine } from "../../src/policy/engine.ts";
import { MockApprover } from "../../src/approvers/simple.ts";
import { deny } from "../../src/approvers/types.ts";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRANSIT_PAYTO = "0x687E3217668DDe7c32478A3F2613750c8Bd505E9";

const challengeB64 = () => {
  const c = {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        amount: "20000",
        asset: USDC_BASE,
        payTo: TRANSIT_PAYTO,
        maxTimeoutSeconds: 300,
        extra: { name: "USD Coin", version: "2" },
        resource: "https://transit402.dev/subway/nearest",
      },
    ],
    resource: { url: "https://transit402.dev/subway/nearest", method: "GET" },
  };
  return Buffer.from(JSON.stringify(c)).toString("base64");
};

class StubTransport {
  queue: HttpResponse[] = [];
  calls: HttpRequest[] = [];
  transport: HttpTransport = async (req) => {
    this.calls.push(req);
    const r = this.queue.shift();
    if (!r) throw new Error(`no stubbed response (call #${this.calls.length})`);
    return r;
  };
}

const resp200 = (body: string): HttpResponse => ({
  status: 200,
  headers: new Headers(),
  body,
});

const resp402 = (): HttpResponse => {
  const h = new Headers();
  h.set("payment-required", challengeB64());
  return { status: 402, headers: h, body: "" };
};

let stub: StubTransport;
let client: Client;
let serverDisposer: () => Promise<void>;
let history: InMemorySpendHistory;

const connect = async (rt: ToolRuntime) => {
  const server = buildMcpServer(rt);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), c.connect(clientTransport)]);
  client = c;
  serverDisposer = async () => {
    await server.close();
    await c.close();
  };
};

beforeEach(() => {
  stub = new StubTransport();
  history = new InMemorySpendHistory();
});

afterEach(async () => {
  await serverDisposer();
});

const buildRuntime = (opts: { signers?: MockSigner[]; policy?: PolicyEngine; approver?: MockApprover } = {}) => {
  const signers = new InMemorySignerRegistry(
    opts.signers ?? [new MockSigner({ label: "keychain:main", chains: [8453] })],
  );
  const policy = opts.policy ?? new PolicyEngine({ maxAmountPerRequest: 50000n });
  const orchestrator = new PaymentOrchestrator({
    transport: stub.transport,
    signers,
    policy,
    history,
    now: () => 1_700_000_000,
    nonce: () => ("0x" + "cd".repeat(32)) as `0x${string}`,
    ...(opts.approver ? { approver: opts.approver } : {}),
  });
  return {
    orchestrator,
    signers,
    history,
    rawFetch: stub.transport,
    now: () => 1_700_000_000,
  } satisfies ToolRuntime;
};

const firstText = (res: unknown): string => {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content;
  if (!content || !content[0]?.text) throw new Error("no text content in tool result");
  return content[0].text;
};

describe("MCP server", () => {
  it("lists the expected tools", async () => {
    await connect(buildRuntime());
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_budget_status", "list_accounts", "x402_check", "x402_fetch"]);
  });

  it("x402_fetch returns no_payment_required for 200 responses", async () => {
    stub.queue.push(resp200('{"ok":true}'));
    await connect(buildRuntime());
    const result = await client.callTool({
      name: "x402_fetch",
      arguments: { url: "https://transit402.dev/openapi.json" },
    });
    const parsed = JSON.parse(firstText(result));
    expect(parsed.kind).toBe("no_payment_required");
    expect(parsed.body).toBe('{"ok":true}');
  });

  it("x402_fetch pays and returns data on 402 + retry happy path", async () => {
    stub.queue.push(resp402(), resp200('{"bikes":[]}'));
    await connect(buildRuntime());
    const result = await client.callTool({
      name: "x402_fetch",
      arguments: { url: "https://transit402.dev/citibike/nearest" },
    });
    const parsed = JSON.parse(firstText(result));
    expect(parsed.kind).toBe("paid");
    expect(parsed.body).toBe('{"bikes":[]}');
    expect(parsed.amount).toBe("20000");
    expect(parsed.signerLabel).toBe("keychain:main");
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1]!.headers?.["PAYMENT-SIGNATURE"]).toBeDefined();
  });

  it("x402_fetch reports rejected_by_user when approver denies", async () => {
    stub.queue.push(resp402());
    const approver = new MockApprover(() => deny("user denied"));
    await connect(buildRuntime({ approver }));
    const result = await client.callTool({
      name: "x402_fetch",
      arguments: { url: "https://transit402.dev/x" },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(firstText(result));
    expect(parsed.kind).toBe("rejected_by_user");
    expect(parsed.reason).toBe("user denied");
    expect(approver.calls).toHaveLength(1);
  });

  it("x402_fetch reports rejected_by_policy when amount exceeds cap", async () => {
    stub.queue.push(resp402());
    await connect(buildRuntime({ policy: new PolicyEngine({ maxAmountPerRequest: 100n }) }));
    const result = await client.callTool({
      name: "x402_fetch",
      arguments: { url: "https://transit402.dev/x" },
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(firstText(result));
    expect(parsed.kind).toBe("rejected_by_policy");
    expect(parsed.decision.code).toBe("amount_exceeds_max");
  });

  it("x402_check returns the challenge without paying", async () => {
    stub.queue.push(resp402());
    await connect(buildRuntime());
    const result = await client.callTool({
      name: "x402_check",
      arguments: { url: "https://transit402.dev/subway/nearest" },
    });
    const parsed = JSON.parse(firstText(result));
    expect(parsed.status).toBe(402);
    expect(parsed.accepts).toHaveLength(1);
    expect(parsed.accepts[0].amount).toBe("20000");
    expect(parsed.accepts[0].chainId).toBe(8453);
    expect(parsed.accepts[0].payTo).toBe(TRANSIT_PAYTO);
    // check must not sign
    expect(stub.calls).toHaveLength(1);
  });

  it("x402_check reports non-402 responses transparently", async () => {
    stub.queue.push(resp200("<html/>"));
    await connect(buildRuntime());
    const result = await client.callTool({
      name: "x402_check",
      arguments: { url: "https://example.test" },
    });
    const parsed = JSON.parse(firstText(result));
    expect(parsed.status).toBe(200);
    expect(parsed.note).toMatch(/No x402 challenge/);
  });

  it("list_accounts returns registered signers", async () => {
    const a = new MockSigner({ label: "keychain:a", chains: [8453] });
    const b = new MockSigner({ label: "ledger:b", chains: [1, 8453] });
    await connect(buildRuntime({ signers: [a, b] }));
    const result = await client.callTool({ name: "list_accounts", arguments: {} });
    const parsed = JSON.parse(firstText(result));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].label).toBe("keychain:a");
    expect(parsed[1].chains).toEqual([1, 8453]);
  });

  it("get_budget_status reports totals within window", async () => {
    history.record("https://a.test", 30000n, 1_700_000_000 - 100);
    history.record("https://b.test", 40000n, 1_700_000_000 - 10_000);
    await connect(buildRuntime());
    const result = await client.callTool({
      name: "get_budget_status",
      arguments: { window_seconds: 3600 },
    });
    const parsed = JSON.parse(firstText(result));
    expect(parsed.windowSeconds).toBe(3600);
    expect(parsed.totalSpentAtomic).toBe("30000");
  });

  it("get_budget_status defaults to 24h window", async () => {
    history.record("https://a.test", 5n, 1_700_000_000 - 60);
    await connect(buildRuntime());
    const result = await client.callTool({ name: "get_budget_status", arguments: {} });
    const parsed = JSON.parse(firstText(result));
    expect(parsed.windowSeconds).toBe(86400);
    expect(parsed.totalSpentAtomic).toBe("5");
  });
});
