import { ExecApprover, type SpawnLike } from "./exec.ts";
import type { ApprovalRequest, ApprovalResult, Approver } from "./types.ts";
import { deny } from "./types.ts";
import { summarizeForPrompt } from "./format.ts";

export interface OsascriptApproverOptions {
  timeoutMs?: number;
  title?: string;
}

/**
 * macOS-native approval dialog via `osascript`. Shows a modal with Approve/Deny
 * buttons and the full payment summary. Exit code 0 = Approve, non-zero = Deny.
 *
 * Pairs well with Touch ID: if the user has "Use Touch ID for sudo" enabled and
 * combines this with a Keychain item locked by biometric ACL, the signing step
 * itself will re-prompt for Touch ID. For an integrated biometric-first UX,
 * use the Swift LocalAuthentication helper via ExecApprover instead.
 */
export class OsascriptApprover implements Approver {
  private readonly exec: ExecApprover;

  constructor(opts: OsascriptApproverOptions = {}, spawner?: SpawnLike) {
    this.exec = new ExecApprover(
      {
        binary: "osascript",
        args: ["-e", "return"],
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        passRequestOnStdin: false,
      },
      spawner,
    );
    this.title = opts.title ?? "x402 Payment Approval";
    this.spawner = spawner;
  }

  private readonly title: string;
  private readonly spawner: SpawnLike | undefined;

  async approve(request: ApprovalRequest): Promise<ApprovalResult> {
    const script = this.buildScript(request);
    const proxied = new ExecApprover(
      {
        binary: "osascript",
        args: ["-e", script],
        passRequestOnStdin: false,
      },
      this.spawner,
    );
    const result = await proxied.approve(request);
    if (!result.approved) {
      // osascript returns non-zero when the user cancels; surface as user denial.
      return deny("User denied via system dialog");
    }
    return result;
  }

  private buildScript(request: ApprovalRequest): string {
    const summary = summarizeForPrompt(request)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, "\\n");
    const title = this.title.replace(/"/g, '\\"');
    // "Deny" is the default button so Enter rejects; accidental clicks favor safety.
    return (
      `display dialog "${summary}" ` +
      `with title "${title}" ` +
      `buttons {"Deny", "Approve"} default button "Deny" cancel button "Deny"`
    );
  }
}
