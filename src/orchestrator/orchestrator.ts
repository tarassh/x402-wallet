import type { Signer, SignerRegistry } from "../signers/types.ts";
import type { PolicyEngine } from "../policy/engine.ts";
import type { SpendHistory } from "../policy/types.ts";
import type { Approver, ApprovalRequest } from "../approvers/types.ts";
import { tryExtractChallenge } from "../x402/parse.ts";
import { buildAuthorization, buildPaymentPayload, encodePaymentHeader, generateNonce } from "../x402/authorization.ts";
import type { X402Accept, X402Challenge } from "../x402/types.ts";
import type {
  AuditLog,
  FetchOutcome,
  HttpRequest,
  HttpResponse,
  HttpTransport,
  PaymentRecord,
} from "./types.ts";

export interface OrchestratorDeps {
  transport: HttpTransport;
  signers: SignerRegistry;
  policy: PolicyEngine;
  history: SpendHistory;
  audit?: AuditLog;
  approver?: Approver;
  now?: () => number;
  nonce?: () => `0x${string}`;
}

export class PaymentOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async fetch(request: HttpRequest): Promise<FetchOutcome> {
    const first = await this.deps.transport(request);
    if (first.status !== 402) {
      return { kind: "no_payment_required", response: first };
    }
    const challenge = tryExtractChallenge(first);
    if (!challenge) {
      return { kind: "no_payment_required", response: first };
    }

    const origin = new URL(request.url).origin;
    const nowSec = (this.deps.now ?? defaultNow)();

    const selected = this.selectAccept(challenge);
    if (!selected) {
      return {
        kind: "no_signer",
        challenge,
        reason: `No signer available for any accepted network (${challenge.accepts.map((a) => a.network).join(", ")})`,
      };
    }
    const { accept, signer } = selected;

    const decision = this.deps.policy.evaluate({
      accept,
      origin,
      history: this.deps.history,
      now: nowSec,
    });
    if (!decision.allow) {
      await this.auditAttempt(origin, request.url, accept, signer, nowSec, "failed", decision.reason);
      return { kind: "rejected_by_policy", challenge, decision };
    }

    if (this.deps.approver) {
      const approvalReq: ApprovalRequest = {
        origin,
        url: request.url,
        method: request.method ?? "GET",
        amount: accept.amount,
        assetName: accept.extra.name,
        assetAddress: accept.asset,
        network: accept.network,
        chainId: accept.chainId,
        payTo: accept.payTo,
        signerLabel: signer.label,
        ...(accept.resource ? { resource: accept.resource } : {}),
        ...(accept.description ? { description: accept.description } : {}),
      };
      const approval = await this.deps.approver.approve(approvalReq);
      if (!approval.approved) {
        await this.auditAttempt(
          origin,
          request.url,
          accept,
          signer,
          nowSec,
          "failed",
          `User rejected: ${approval.reason}`,
        );
        return { kind: "rejected_by_user", challenge, reason: approval.reason };
      }
    }

    const nonce = (this.deps.nonce ?? generateNonce)();
    const typedData = buildAuthorization({
      accept,
      from: signer.address,
      nonce,
      now: nowSec,
    });
    const signature = await signer.signTypedData(typedData);
    const payload = buildPaymentPayload(accept, typedData.message, signature);
    const header = encodePaymentHeader(payload);

    const retryHeaders = { ...(request.headers ?? {}), "X-PAYMENT": header };
    const retried = await this.deps.transport({ ...request, headers: retryHeaders });

    if (retried.status >= 200 && retried.status < 300) {
      await this.auditAttempt(origin, request.url, accept, signer, nowSec, "succeeded");
      return {
        kind: "paid",
        response: retried,
        challenge,
        signerLabel: signer.label,
        amount: accept.amount,
      };
    }
    await this.auditAttempt(
      origin,
      request.url,
      accept,
      signer,
      nowSec,
      "failed",
      `Server returned ${retried.status} after payment`,
    );
    return { kind: "payment_failed", challenge, response: retried };
  }

  private selectAccept(
    challenge: X402Challenge,
  ): { accept: X402Accept; signer: Signer } | undefined {
    for (const accept of challenge.accepts) {
      const candidates = this.deps.signers.findForChain(accept.chainId);
      if (candidates.length > 0) {
        return { accept, signer: candidates[0]! };
      }
    }
    return undefined;
  }

  private async auditAttempt(
    origin: string,
    url: string,
    accept: X402Accept,
    signer: Signer,
    timestamp: number,
    status: PaymentRecord["status"],
    errorMessage?: string,
  ): Promise<void> {
    if (!this.deps.audit) return;
    const entry: PaymentRecord = {
      origin,
      url,
      asset: accept.asset,
      network: accept.network,
      chainId: accept.chainId,
      amount: accept.amount,
      signerLabel: signer.label,
      timestamp,
      status,
      ...(errorMessage ? { errorMessage } : {}),
    };
    await this.deps.audit.record(entry);
  }
}

function defaultNow(): number {
  return Math.floor(Date.now() / 1000);
}
