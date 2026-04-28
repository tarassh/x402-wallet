import { describe, expect, it, beforeEach } from "bun:test";
import { PaymentOrchestrator } from "../../src/orchestrator/orchestrator.ts";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../src/orchestrator/types.ts";
import type { PaymentRecord, AuditLog } from "../../src/orchestrator/types.ts";
import { MockSigner } from "../../src/signers/mock.ts";
import { InMemorySignerRegistry } from "../../src/signers/types.ts";
import { InMemorySpendHistory, PolicyEngine } from "../../src/policy/engine.ts";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRANSIT_PAYTO = "0x687E3217668DDe7c32478A3F2613750c8Bd505E9";

const challengeJson = (overrides: Record<string, unknown> = {}) => ({
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
      ...overrides,
    },
  ],
  resource: { url: "https://transit402.dev/subway/nearest", method: "GET" },
});

const make402 = (challenge: unknown = challengeJson()): HttpResponse => {
  const headers = new Headers();
  headers.set("payment-required", Buffer.from(JSON.stringify(challenge)).toString("base64"));
  return { status: 402, headers, body: JSON.stringify({ status: 402 }) };
};

const make200 = (body = '{"ok":true}'): HttpResponse => ({
  status: 200,
  headers: new Headers(),
  body,
});

class RecordingTransport {
  calls: HttpRequest[] = [];
  responses: HttpResponse[];

  constructor(responses: HttpResponse[]) {
    this.responses = [...responses];
  }

  transport: HttpTransport = async (req) => {
    this.calls.push(req);
    const r = this.responses.shift();
    if (!r) throw new Error(`No mock response for call #${this.calls.length}`);
    return r;
  };
}

class CollectingAudit implements AuditLog {
  entries: PaymentRecord[] = [];
  async record(entry: PaymentRecord): Promise<void> {
    this.entries.push(entry);
  }
}

const FIXED_NOW = 1_700_000_000;
const FIXED_NONCE = ("0x" + "ab".repeat(32)) as `0x${string}`;

let history: InMemorySpendHistory;
let audit: CollectingAudit;

beforeEach(() => {
  history = new InMemorySpendHistory();
  audit = new CollectingAudit();
});

const buildOrch = (opts: {
  transport: HttpTransport;
  signers?: MockSigner[];
  policy?: PolicyEngine;
}) => {
  const signers = opts.signers ?? [new MockSigner({ label: "keychain:main", chains: [8453] })];
  const registry = new InMemorySignerRegistry(signers);
  const policy = opts.policy ?? new PolicyEngine({ maxAmountPerRequest: 50000n });
  return new PaymentOrchestrator({
    transport: opts.transport,
    signers: registry,
    policy,
    history,
    audit,
    now: () => FIXED_NOW,
    nonce: () => FIXED_NONCE,
  });
};

describe("PaymentOrchestrator", () => {
  it("passes through non-402 responses untouched", async () => {
    const t = new RecordingTransport([make200()]);
    const orch = buildOrch({ transport: t.transport });
    const outcome = await orch.fetch({ url: "https://transit402.dev/subway/nearest" });
    expect(outcome.kind).toBe("no_payment_required");
    expect(t.calls).toHaveLength(1);
    expect(audit.entries).toHaveLength(0);
  });

  it("treats 402 without challenge header as no_payment_required", async () => {
    const resp: HttpResponse = { status: 402, headers: new Headers(), body: "" };
    const t = new RecordingTransport([resp]);
    const orch = buildOrch({ transport: t.transport });
    const outcome = await orch.fetch({ url: "https://transit402.dev/x" });
    expect(outcome.kind).toBe("no_payment_required");
  });

  it("happy path: pays and returns 200", async () => {
    const t = new RecordingTransport([make402(), make200('{"bikes":[]}')]);
    const signer = new MockSigner({ label: "keychain:main", chains: [8453] });
    const orch = buildOrch({ transport: t.transport, signers: [signer] });
    const outcome = await orch.fetch({ url: "https://transit402.dev/citibike/nearest" });
    expect(outcome.kind).toBe("paid");
    if (outcome.kind !== "paid") throw new Error("unreachable");
    expect(outcome.response.body).toBe('{"bikes":[]}');
    expect(outcome.signerLabel).toBe("keychain:main");
    expect(outcome.amount).toBe(20000n);

    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]!.headers?.["X-PAYMENT"]).toBeDefined();

    expect(signer.signCallCount).toBe(1);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]!.status).toBe("succeeded");
    expect(audit.entries[0]!.amount).toBe(20000n);
    expect(audit.entries[0]!.origin).toBe("https://transit402.dev");
  });

  it("rejects when policy denies", async () => {
    const t = new RecordingTransport([make402()]);
    const signer = new MockSigner({ label: "keychain:main", chains: [8453] });
    const policy = new PolicyEngine({ maxAmountPerRequest: 1000n });
    const orch = buildOrch({ transport: t.transport, signers: [signer], policy });
    const outcome = await orch.fetch({ url: "https://transit402.dev/x" });
    expect(outcome.kind).toBe("rejected_by_policy");
    if (outcome.kind !== "rejected_by_policy") throw new Error("unreachable");
    expect(outcome.decision.allow).toBe(false);
    expect(signer.signCallCount).toBe(0);
    expect(t.calls).toHaveLength(1);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]!.status).toBe("failed");
  });

  it("returns no_signer when no registered signer supports the chain", async () => {
    const t = new RecordingTransport([make402()]);
    const signer = new MockSigner({ label: "keychain:main", chains: [1] });
    const orch = buildOrch({ transport: t.transport, signers: [signer] });
    const outcome = await orch.fetch({ url: "https://transit402.dev/x" });
    expect(outcome.kind).toBe("no_signer");
    expect(signer.signCallCount).toBe(0);
    expect(t.calls).toHaveLength(1);
    expect(audit.entries).toHaveLength(0);
  });

  it("selects first accept with a matching signer when multiple present", async () => {
    const multi = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:1",
          amount: "20000",
          asset: USDC_BASE,
          payTo: TRANSIT_PAYTO,
          maxTimeoutSeconds: 300,
          extra: { name: "USD Coin", version: "2" },
          resource: "https://transit402.dev/x",
        },
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "20000",
          asset: USDC_BASE,
          payTo: TRANSIT_PAYTO,
          maxTimeoutSeconds: 300,
          extra: { name: "USD Coin", version: "2" },
          resource: "https://transit402.dev/x",
        },
      ],
      resource: { url: "https://transit402.dev/x", method: "GET" },
    };
    const t = new RecordingTransport([make402(multi), make200()]);
    const base = new MockSigner({ label: "keychain:base", chains: [8453] });
    const orch = buildOrch({ transport: t.transport, signers: [base] });
    const outcome = await orch.fetch({ url: "https://transit402.dev/x" });
    expect(outcome.kind).toBe("paid");
    if (outcome.kind !== "paid") throw new Error("unreachable");
    expect(outcome.signerLabel).toBe("keychain:base");
  });

  it("reports payment_failed when retry returns non-2xx", async () => {
    const t = new RecordingTransport([make402(), { status: 500, headers: new Headers(), body: "bad" }]);
    const orch = buildOrch({ transport: t.transport });
    const outcome = await orch.fetch({ url: "https://transit402.dev/x" });
    expect(outcome.kind).toBe("payment_failed");
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]!.status).toBe("failed");
    expect(audit.entries[0]!.errorMessage).toContain("500");
  });

  it("attaches X-PAYMENT to retry but preserves existing headers", async () => {
    const t = new RecordingTransport([make402(), make200()]);
    const orch = buildOrch({ transport: t.transport });
    await orch.fetch({
      url: "https://transit402.dev/x",
      headers: { Accept: "application/json" },
    });
    expect(t.calls[1]!.headers?.Accept).toBe("application/json");
    expect(t.calls[1]!.headers?.["X-PAYMENT"]).toBeDefined();
    // X-PAYMENT base64 decodes to a JSON object with our scheme/network
    const xPayment = t.calls[1]!.headers!["X-PAYMENT"]!;
    const decoded = JSON.parse(Buffer.from(xPayment, "base64").toString("utf8"));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.scheme).toBe("exact");
    expect(decoded.network).toBe("eip155:8453");
    expect(decoded.payload.authorization.nonce).toBe(FIXED_NONCE);
  });

  it("honors injected nonce and now() for deterministic output", async () => {
    const t = new RecordingTransport([make402(), make200()]);
    const orch = buildOrch({ transport: t.transport });
    await orch.fetch({ url: "https://transit402.dev/x" });
    const decoded = JSON.parse(Buffer.from(t.calls[1]!.headers!["X-PAYMENT"]!, "base64").toString("utf8"));
    expect(decoded.payload.authorization.validAfter).toBe(String(FIXED_NOW - 60));
    expect(decoded.payload.authorization.validBefore).toBe(String(FIXED_NOW + 300));
  });
});
