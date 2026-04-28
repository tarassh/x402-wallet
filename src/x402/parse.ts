import type { Address } from "viem";
import { getAddress, isAddress } from "viem";
import { X402ParseError } from "./types.ts";
import type { X402Accept, X402Challenge, X402ResourceInfo } from "./types.ts";

const EIP155_PREFIX = "eip155:";

export function parseNetwork(network: unknown): number {
  if (typeof network !== "string" || !network.startsWith(EIP155_PREFIX)) {
    throw new X402ParseError(`Unsupported network: ${String(network)} (only eip155:* supported)`);
  }
  const id = Number.parseInt(network.slice(EIP155_PREFIX.length), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new X402ParseError(`Invalid chain id in network: ${network}`);
  }
  return id;
}

function requireString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw new X402ParseError(`Missing or invalid field: ${field}`);
  }
  return v;
}

function requireAddress(v: unknown, field: string): Address {
  const s = requireString(v, field);
  if (!isAddress(s)) {
    throw new X402ParseError(`Invalid address in field ${field}: ${s}`);
  }
  return getAddress(s);
}

function requireBigInt(v: unknown, field: string): bigint {
  if (typeof v !== "string" && typeof v !== "number") {
    throw new X402ParseError(`Missing or invalid field: ${field}`);
  }
  try {
    const n = BigInt(v);
    if (n < 0n) throw new Error("negative");
    return n;
  } catch {
    throw new X402ParseError(`Invalid integer in field ${field}: ${String(v)}`);
  }
}

function requirePositiveInt(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
    throw new X402ParseError(`Missing or invalid positive integer: ${field}`);
  }
  return v;
}

function parseAccept(raw: unknown): X402Accept {
  if (typeof raw !== "object" || raw === null) {
    throw new X402ParseError("accepts[] entry is not an object");
  }
  const r = raw as Record<string, unknown>;

  const scheme = requireString(r.scheme, "accepts[].scheme");
  if (scheme !== "exact") {
    throw new X402ParseError(`Unsupported scheme: ${scheme} (only 'exact' supported)`);
  }

  const network = requireString(r.network, "accepts[].network");
  const chainId = parseNetwork(network);

  const extraRaw = r.extra;
  if (typeof extraRaw !== "object" || extraRaw === null) {
    throw new X402ParseError("Missing accepts[].extra");
  }
  const extra = extraRaw as Record<string, unknown>;
  const extraName = requireString(extra.name, "accepts[].extra.name");
  const extraVersion = requireString(extra.version, "accepts[].extra.version");

  return {
    scheme: "exact",
    network,
    chainId,
    amount: requireBigInt(r.amount, "accepts[].amount"),
    asset: requireAddress(r.asset, "accepts[].asset"),
    payTo: requireAddress(r.payTo, "accepts[].payTo"),
    maxTimeoutSeconds: requirePositiveInt(r.maxTimeoutSeconds, "accepts[].maxTimeoutSeconds"),
    extra: { name: extraName, version: extraVersion },
    resource: requireString(r.resource, "accepts[].resource"),
    ...(typeof r.description === "string" ? { description: r.description } : {}),
  };
}

function parseResourceInfo(raw: unknown): X402ResourceInfo | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.url !== "string" || typeof r.method !== "string") return undefined;
  return {
    url: r.url,
    method: r.method,
    ...(typeof r.description === "string" ? { description: r.description } : {}),
    ...(typeof r.mimeType === "string" ? { mimeType: r.mimeType } : {}),
  };
}

export function parseChallengeJson(input: unknown): X402Challenge {
  if (typeof input !== "object" || input === null) {
    throw new X402ParseError("Challenge JSON is not an object");
  }
  const obj = input as Record<string, unknown>;

  if (obj.x402Version !== 2) {
    throw new X402ParseError(`Unsupported x402Version: ${String(obj.x402Version)} (expected 2)`);
  }

  if (!Array.isArray(obj.accepts) || obj.accepts.length === 0) {
    throw new X402ParseError("Challenge has no accepts[] entries");
  }

  const accepts = obj.accepts.map(parseAccept);
  const resource = parseResourceInfo(obj.resource);

  return {
    version: 2,
    accepts,
    ...(resource ? { resource } : {}),
    raw: input,
  };
}

export function decodePaymentRequiredHeader(value: string): X402Challenge {
  if (value.length === 0) {
    throw new X402ParseError("Empty PAYMENT-REQUIRED header");
  }
  let json: string;
  try {
    json = Buffer.from(value, "base64").toString("utf8");
  } catch (err) {
    throw new X402ParseError("PAYMENT-REQUIRED header is not valid base64", err);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new X402ParseError("PAYMENT-REQUIRED header body is not valid JSON", err);
  }
  return parseChallengeJson(parsed);
}

export interface ParsedResponse {
  challenge?: X402Challenge;
  status: number;
}

export function tryExtractChallenge(response: {
  status: number;
  headers: Headers;
}): X402Challenge | undefined {
  if (response.status !== 402) return undefined;
  const header = response.headers.get("payment-required");
  if (!header) return undefined;
  return decodePaymentRequiredHeader(header);
}
