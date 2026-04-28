import { beforeEach, describe, expect, it } from "bun:test";
import { PaymentOrchestrator } from "../../src/orchestrator/orchestrator.ts";
import type { HttpRequest, HttpResponse, HttpTransport, PaymentRecord, AuditLog } from "../../src/orchestrator/types.ts";
import { MockSigner } from "../../src/signers/mock.ts";
import { InMemorySignerRegistry } from "../../src/signers/types.ts";
import { InMemorySpendHistory, PolicyEngine } from "../../src/policy/engine.ts";
import { MockApprover } from "../../src/approvers/simple.ts";
import { deny } from "../../src/approvers/types.ts";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TRANSIT_PAYTO = "0x687E3217668DDe7c32478A3F2613750c8Bd505E9";

const make402 = (): HttpResponse => {
  const challenge = {
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
        description: "Nearby subway stations",
      },
    ],
    resource: { url: "https://transit402.dev/subway/nearest", method: "GET" },
  };
  const h = new Headers();
  h.set("payment-required", Buffer.from(JSON.stringify(challenge)).toString("base64"));
  return { status: 402, headers: h, body: "" };
};

const make200 = (): HttpResponse => ({ status: 200, headers: new Headers(), body: "{}" });

class StubTransport {
  calls: HttpRequest[] = [];
  queue: HttpResponse[] = [];
  transport: HttpTransport = async (req) => {
    this.calls.push(req);
    const r = this.queue.shift();
    if (!r) throw new Error(`no response for call #${this.calls.length}`);
    return r;
  };
}

class CollectingAudit implements AuditLog {
  entries: PaymentRecord[] = [];
  async record(entry: PaymentRecord): Promise<void> {
    this.entries.push(entry);
  }
}

const NOW = 1_700_000_000;
const NONCE = ("0x" + "ef".repeat(32)) as `0x${string}`;

let history: InMemorySpendHistory;
let audit: CollectingAudit;
let stub: StubTransport;

beforeEach(() => {
  history = new InMemorySpendHistory();
  audit = new CollectingAudit();
  stub = new StubTransport();
});

const buildOrch = (opts: { approver?: MockApprover; signers?: MockSigner[] } = {}) => {
  const signers = new InMemorySignerRegistry(
    opts.signers ?? [new MockSigner({ label: "keychain:main", chains: [8453] })],
  );
  const policy = new PolicyEngine({ maxAmountPerRequest: 50000n });
  return new PaymentOrchestrator({
    transport: stub.transport,
    signers,
    policy,
    history,
    audit,
    now: () => NOW,
    nonce: () => NONCE,
    ...(opts.approver ? { approver: opts.approver } : {}),
  });
};

describe("PaymentOrchestrator with approver", () => {
  it("signs and pays when approver approves", async () => {
    stub.queue.push(make402(), make200());
    const approver = new MockApprover();
    const signer = new MockSigner({ label: "keychain:main", chains: [8453] });
    const orch = buildOrch({ approver, signers: [signer] });
    const outcome = await orch.fetch({ url: "https://transit402.dev/citibike/nearest" });
    expect(outcome.kind).toBe("paid");
    expect(approver.calls).toHaveLength(1);
    expect(signer.signCallCount).toBe(1);
    expect(stub.calls).toHaveLength(2);
  });

  it("does not sign when approver denies", async () => {
    stub.queue.push(make402());
    const approver = new MockApprover(() => deny("user pressed Deny"));
    const signer = new MockSigner({ label: "keychain:main", chains: [8453] });
    const orch = buildOrch({ approver, signers: [signer] });
    const outcome = await orch.fetch({ url: "https://transit402.dev/citibike/nearest" });
    expect(outcome.kind).toBe("rejected_by_user");
    if (outcome.kind !== "rejected_by_user") throw new Error("unreachable");
    expect(outcome.reason).toBe("user pressed Deny");
    expect(signer.signCallCount).toBe(0);
    expect(stub.calls).toHaveLength(1);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]!.status).toBe("failed");
    expect(audit.entries[0]!.errorMessage).toContain("User rejected: user pressed Deny");
  });

  it("hands the approver a request populated from the challenge", async () => {
    stub.queue.push(make402(), make200());
    const approver = new MockApprover();
    const orch = buildOrch({ approver });
    await orch.fetch({ url: "https://transit402.dev/citibike/nearest" });
    const call = approver.calls[0]!;
    expect(call.origin).toBe("https://transit402.dev");
    expect(call.url).toBe("https://transit402.dev/citibike/nearest");
    expect(call.amount).toBe(20000n);
    expect(call.assetName).toBe("USD Coin");
    expect(call.assetAddress).toBe(USDC_BASE);
    expect(call.network).toBe("eip155:8453");
    expect(call.chainId).toBe(8453);
    expect(call.payTo).toBe(TRANSIT_PAYTO);
    expect(call.signerLabel).toBe("keychain:main");
    expect(call.description).toBe("Nearby subway stations");
    expect(call.method).toBe("GET");
  });

  it("does not prompt when policy rejects first", async () => {
    stub.queue.push(make402());
    const approver = new MockApprover();
    const policy = new PolicyEngine({ maxAmountPerRequest: 100n });
    const signer = new MockSigner({ label: "keychain:main", chains: [8453] });
    const orch = new PaymentOrchestrator({
      transport: stub.transport,
      signers: new InMemorySignerRegistry([signer]),
      policy,
      history,
      audit,
      approver,
      now: () => NOW,
      nonce: () => NONCE,
    });
    const outcome = await orch.fetch({ url: "https://transit402.dev/x" });
    expect(outcome.kind).toBe("rejected_by_policy");
    expect(approver.calls).toHaveLength(0);
    expect(signer.signCallCount).toBe(0);
  });

  it("does not prompt when no signer is available", async () => {
    stub.queue.push(make402());
    const approver = new MockApprover();
    const signer = new MockSigner({ label: "keychain:main", chains: [1] }); // wrong chain
    const orch = buildOrch({ approver, signers: [signer] });
    const outcome = await orch.fetch({ url: "https://transit402.dev/x" });
    expect(outcome.kind).toBe("no_signer");
    expect(approver.calls).toHaveLength(0);
  });

  it("passes through request method to the approval request", async () => {
    stub.queue.push(make402(), make200());
    const approver = new MockApprover();
    const orch = buildOrch({ approver });
    await orch.fetch({ url: "https://transit402.dev/x", method: "POST", body: "{}" });
    expect(approver.calls[0]!.method).toBe("POST");
  });
});
