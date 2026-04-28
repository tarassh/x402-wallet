import type { ApprovalRequest, ApprovalResult, Approver } from "./types.ts";
import { APPROVED, deny } from "./types.ts";

export class AlwaysApprover implements Approver {
  async approve(_request: ApprovalRequest): Promise<ApprovalResult> {
    return APPROVED;
  }
}

export class DenyApprover implements Approver {
  constructor(private readonly reason: string = "All payments denied") {}
  async approve(_request: ApprovalRequest): Promise<ApprovalResult> {
    return deny(this.reason);
  }
}

export class MockApprover implements Approver {
  calls: ApprovalRequest[] = [];
  private readonly handler: (req: ApprovalRequest) => ApprovalResult | Promise<ApprovalResult>;

  constructor(handler: (req: ApprovalRequest) => ApprovalResult | Promise<ApprovalResult> = () => APPROVED) {
    this.handler = handler;
  }

  async approve(req: ApprovalRequest): Promise<ApprovalResult> {
    this.calls.push(req);
    return this.handler(req);
  }
}
