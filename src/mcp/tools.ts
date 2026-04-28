import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PaymentOrchestrator } from "../orchestrator/orchestrator.ts";
import type { HttpRequest } from "../orchestrator/types.ts";
import type { SignerRegistry } from "../signers/types.ts";
import type { SpendHistory } from "../policy/types.ts";
import { tryExtractChallenge } from "../x402/parse.ts";

export interface ToolRuntime {
  orchestrator: PaymentOrchestrator;
  signers: SignerRegistry;
  history: SpendHistory;
  rawFetch: (req: HttpRequest) => Promise<{ status: number; headers: Headers; body: string }>;
  now?: () => number;
}

export const fetchInputShape = {
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
} as const;

export const checkInputShape = {
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).optional(),
} as const;

export const budgetInputShape = {
  window_seconds: z.number().int().positive().optional(),
} as const;

export function registerX402Tools(server: McpServer, rt: ToolRuntime): void {
  server.registerTool(
    "x402_fetch",
    {
      title: "Fetch a URL (with automatic x402 payment)",
      description:
        "Make an HTTP request. If the server responds 402 with an x402 challenge, auto-sign and retry using policy-governed local signers.",
      inputSchema: fetchInputShape,
    },
    async (args) => {
      const outcome = await rt.orchestrator.fetch({
        url: args.url,
        ...(args.method ? { method: args.method } : {}),
        ...(args.headers ? { headers: args.headers } : {}),
        ...(args.body ? { body: args.body } : {}),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(formatOutcome(outcome), bigintReplacer, 2) }],
        isError: outcome.kind !== "paid" && outcome.kind !== "no_payment_required",
      };
    },
  );

  server.registerTool(
    "x402_check",
    {
      title: "Inspect x402 pricing without paying",
      description:
        "Perform an unauthenticated request to the URL and return any x402 payment challenge (price, network, asset) without signing.",
      inputSchema: checkInputShape,
    },
    async (args) => {
      const req: HttpRequest = {
        url: args.url,
        ...(args.method ? { method: args.method } : {}),
      };
      const resp = await rt.rawFetch(req);
      const challenge = tryExtractChallenge(resp);
      const summary = challenge
        ? {
            status: 402,
            accepts: challenge.accepts.map((a) => ({
              network: a.network,
              chainId: a.chainId,
              amount: a.amount.toString(),
              asset: a.asset,
              payTo: a.payTo,
              maxTimeoutSeconds: a.maxTimeoutSeconds,
              resource: a.resource,
              description: a.description,
            })),
            resource: challenge.resource,
          }
        : { status: resp.status, note: "No x402 challenge present" };
      return {
        content: [{ type: "text", text: JSON.stringify(summary, bigintReplacer, 2) }],
      };
    },
  );

  server.registerTool(
    "list_accounts",
    {
      title: "List registered signer accounts",
      description: "List every signer this wallet can use, along with supported chain IDs.",
      inputSchema: {},
    },
    async () => {
      const list = rt.signers.list().map((s) => ({
        label: s.label,
        address: s.address,
        chains: s.chains,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify(list, null, 2) }],
      };
    },
  );

  server.registerTool(
    "get_budget_status",
    {
      title: "Show spend within a rolling window",
      description:
        "Return total amount spent across succeeded payments in the last N seconds (default 24h).",
      inputSchema: budgetInputShape,
    },
    async (args) => {
      const windowSeconds = args.window_seconds ?? 24 * 60 * 60;
      const now = (rt.now ?? defaultNow)();
      const since = now - windowSeconds;
      const total = rt.history.totalSince(since);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { windowSeconds, since, now, totalSpentAtomic: total.toString() },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

function formatOutcome(outcome: Awaited<ReturnType<PaymentOrchestrator["fetch"]>>): unknown {
  switch (outcome.kind) {
    case "no_payment_required":
      return {
        kind: outcome.kind,
        status: outcome.response.status,
        body: outcome.response.body,
      };
    case "paid":
      return {
        kind: outcome.kind,
        status: outcome.response.status,
        body: outcome.response.body,
        amount: outcome.amount.toString(),
        signerLabel: outcome.signerLabel,
      };
    case "rejected_by_policy":
      return {
        kind: outcome.kind,
        decision: outcome.decision,
      };
    case "rejected_by_user":
      return { kind: outcome.kind, reason: outcome.reason };
    case "no_signer":
      return { kind: outcome.kind, reason: outcome.reason };
    case "payment_failed":
      return {
        kind: outcome.kind,
        status: outcome.response.status,
        body: outcome.response.body,
      };
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function defaultNow(): number {
  return Math.floor(Date.now() / 1000);
}
