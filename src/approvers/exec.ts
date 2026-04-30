import { spawn } from "child_process";
import * as path from "path";
import type { ApprovalRequest, ApprovalResult, Approver } from "./types.ts";
import { APPROVED, deny } from "./types.ts";
import { buildApprovalView, summarizeForPrompt } from "./format.ts";

export interface ExecApproverOptions {
  binary: string;
  args?: readonly string[];
  timeoutMs?: number;
  passRequestOnStdin?: boolean;
  /**
   * Map non-zero exit codes to user-facing reason strings.
   * Defaults to `"Approver exited with code N"`.
   */
  codeToReason?: Readonly<Record<number, string>>;
}

export interface SpawnLike {
  (
    command: string,
    args: readonly string[],
    options: { stdio: [string, string, string] },
  ): SpawnResult;
}

export interface SpawnResult {
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: "close", handler: (code: number | null) => void): void;
  on(event: "error", handler: (err: Error) => void): void;
  kill(signal?: string): void;
}

export class ExecApprover implements Approver {
  constructor(
    private readonly opts: ExecApproverOptions,
    private readonly spawner: SpawnLike = spawn as unknown as SpawnLike,
  ) {
    if (!opts.binary) throw new Error("ExecApprover: binary is required");
  }

  async approve(request: ApprovalRequest): Promise<ApprovalResult> {
    const child = this.spawner(expandHome(this.opts.binary), this.opts.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (this.opts.passRequestOnStdin ?? true) {
      const payload = JSON.stringify(serializeRequest(request));
      child.stdin?.end(payload);
    } else {
      child.stdin?.end();
    }

    const timeoutMs = this.opts.timeoutMs ?? 60_000;
    return new Promise<ApprovalResult>((resolve) => {
      let settled = false;
      const settle = (r: ApprovalResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(() => {
        settle(deny(`Approval timed out after ${timeoutMs}ms`));
        child.kill("SIGTERM");
      }, timeoutMs);

      child.on("error", (err) => settle(deny(`Approver process error: ${err.message}`)));
      child.on("close", (code) => {
        if (code === 0) {
          settle(APPROVED);
          return;
        }
        const mapped = code !== null ? this.opts.codeToReason?.[code] : undefined;
        settle(deny(mapped ?? `Approver exited with code ${code ?? "null"}`));
      });
    });
  }
}

function serializeRequest(r: ApprovalRequest): Record<string, unknown> {
  const view = buildApprovalView(r);
  return {
    origin: r.origin,
    url: r.url,
    method: r.method,
    amount: r.amount.toString(),
    assetName: r.assetName,
    assetAddress: r.assetAddress,
    network: r.network,
    chainId: r.chainId,
    payTo: r.payTo,
    signerLabel: r.signerLabel,
    resource: r.resource,
    description: r.description,
    summary: summarizeForPrompt(r),
    view,
  };
}

// Tilde-expand `~/foo` and `~` to `$HOME/foo` and `$HOME`. The shell does this
// for interactive paths, but `child_process.spawn` does not — without this,
// configs that store "~/.x402-wallet/bin/touchid-approver" fail with ENOENT.
export function expandHome(p: string): string {
  if (p === "~") return process.env.HOME ?? p;
  if (p.startsWith("~/")) {
    const home = process.env.HOME;
    if (!home) return p;
    return path.join(home, p.slice(2));
  }
  return p;
}
