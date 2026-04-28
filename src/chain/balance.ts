import type { Address } from "viem";
import type { HttpTransport } from "../orchestrator/types.ts";
import { chainSpec } from "./usdc.ts";

const BALANCE_OF_SELECTOR = "0x70a08231";

export interface QueryBalanceInput {
  chainId: number;
  address: Address;
  rpcUrl: string;
  transport: HttpTransport;
}

export class BalanceQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BalanceQueryError";
  }
}

export function encodeBalanceOfData(address: Address): string {
  const stripped = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(stripped)) {
    throw new BalanceQueryError(`Invalid address: ${address}`);
  }
  return BALANCE_OF_SELECTOR + "000000000000000000000000" + stripped;
}

export async function queryUsdcBalance(input: QueryBalanceInput): Promise<bigint> {
  const spec = chainSpec(input.chainId);
  if (!spec) {
    throw new BalanceQueryError(`Unknown chain id ${input.chainId}; add it to CHAINS`);
  }
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ to: spec.usdc, data: encodeBalanceOfData(input.address) }, "latest"],
  });

  const response = await input.transport({
    url: input.rpcUrl,
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new BalanceQueryError(`RPC ${input.rpcUrl} returned HTTP ${response.status}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch (err) {
    throw new BalanceQueryError(`RPC ${input.rpcUrl} returned invalid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new BalanceQueryError("RPC response is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.error) {
    const err = obj.error as { message?: string; code?: number };
    throw new BalanceQueryError(`RPC error ${err.code ?? ""}: ${err.message ?? "unknown"}`);
  }
  const result = obj.result;
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)) {
    throw new BalanceQueryError(`RPC returned unexpected result: ${String(result)}`);
  }
  if (result === "0x" || result === "0x0") return 0n;
  return BigInt(result);
}

export function formatTokenAmount(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = raw % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length === 0 ? `${whole}` : `${whole}.${fracStr}`;
}
