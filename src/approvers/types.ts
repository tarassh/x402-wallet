import type { Address } from "viem";

export interface ApprovalRequest {
  origin: string;
  url: string;
  method: string;
  amount: bigint;
  assetName: string;
  assetAddress: Address;
  network: string;
  chainId: number;
  payTo: Address;
  signerLabel: string;
  resource?: string;
  description?: string;
}

export interface Approver {
  approve(request: ApprovalRequest): Promise<ApprovalResult>;
}

export type ApprovalResult = { approved: true } | { approved: false; reason: string };

export const APPROVED: ApprovalResult = { approved: true };
export const deny = (reason: string): ApprovalResult => ({ approved: false, reason });
