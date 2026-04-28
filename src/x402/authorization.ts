import type { Address, Hex, TypedDataDefinition } from "viem";
import { getAddress } from "viem";
import type { X402Accept } from "./types.ts";

export interface TransferWithAuthorizationMessage {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

export interface BuildAuthorizationInput {
  accept: X402Accept;
  from: Address;
  now?: number;
  nonce: Hex;
}

const TRANSFER_WITH_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function buildAuthorization(
  input: BuildAuthorizationInput,
): TypedDataDefinition<typeof TRANSFER_WITH_AUTH_TYPES, "TransferWithAuthorization"> {
  const { accept, from, nonce } = input;
  if (!/^0x[0-9a-fA-F]{64}$/.test(nonce)) {
    throw new Error(`nonce must be 32 bytes hex, got ${nonce}`);
  }
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const validAfter = BigInt(Math.max(0, now - 60));
  const validBefore = BigInt(now + accept.maxTimeoutSeconds);

  const message: TransferWithAuthorizationMessage = {
    from: getAddress(from),
    to: accept.payTo,
    value: accept.amount,
    validAfter,
    validBefore,
    nonce,
  };

  return {
    domain: {
      name: accept.extra.name,
      version: accept.extra.version,
      chainId: accept.chainId,
      verifyingContract: accept.asset,
    },
    types: TRANSFER_WITH_AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message,
  };
}

export function generateNonce(random: () => Uint8Array = defaultRandom): Hex {
  const bytes = random();
  if (bytes.length !== 32) {
    throw new Error(`nonce generator must return 32 bytes, got ${bytes.length}`);
  }
  return ("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

function defaultRandom(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

export interface X402PaymentPayload {
  x402Version: 2;
  scheme: "exact";
  network: string;
  payload: {
    signature: Hex;
    authorization: {
      from: Address;
      to: Address;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };
  };
}

export function encodePaymentHeader(payload: X402PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function buildPaymentPayload(
  accept: X402Accept,
  auth: TransferWithAuthorizationMessage,
  signature: Hex,
): X402PaymentPayload {
  return {
    x402Version: 2,
    scheme: "exact",
    network: accept.network,
    payload: {
      signature,
      authorization: {
        from: auth.from,
        to: auth.to,
        value: auth.value.toString(),
        validAfter: auth.validAfter.toString(),
        validBefore: auth.validBefore.toString(),
        nonce: auth.nonce,
      },
    },
  };
}
