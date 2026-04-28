import type { Address } from "viem";

export interface X402Accept {
  scheme: "exact";
  network: string;
  chainId: number;
  amount: bigint;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra: {
    name: string;
    version: string;
  };
  resource: string;
  description?: string;
}

export interface X402ResourceInfo {
  url: string;
  method: string;
  description?: string;
  mimeType?: string;
}

export interface X402Challenge {
  version: 2;
  accepts: X402Accept[];
  resource?: X402ResourceInfo;
  raw: unknown;
}

export class X402ParseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "X402ParseError";
  }
}
