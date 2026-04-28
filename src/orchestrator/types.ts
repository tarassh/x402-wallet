import type { X402Challenge } from "../x402/types.ts";
import type { PolicyDecision } from "../policy/types.ts";

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: string;
}

export interface HttpTransport {
  (request: HttpRequest): Promise<HttpResponse>;
}

export interface PaymentRecord {
  origin: string;
  url: string;
  asset: string;
  network: string;
  chainId: number;
  amount: bigint;
  signerLabel: string;
  txHash?: string;
  timestamp: number;
  status: "attempted" | "succeeded" | "failed";
  errorMessage?: string;
}

export interface AuditLog {
  record(entry: PaymentRecord): Promise<void>;
}

export type FetchOutcome =
  | { kind: "no_payment_required"; response: HttpResponse }
  | { kind: "paid"; response: HttpResponse; challenge: X402Challenge; signerLabel: string; amount: bigint }
  | { kind: "rejected_by_policy"; challenge: X402Challenge; decision: PolicyDecision }
  | { kind: "rejected_by_user"; challenge: X402Challenge; reason: string }
  | { kind: "no_signer"; challenge: X402Challenge; reason: string }
  | { kind: "payment_failed"; challenge: X402Challenge; response: HttpResponse };
