// Biometric / password approval helper for x402-wallet.
//
// Build once:
//   swiftc -O -o ~/.x402-wallet/bin/touchid-approver scripts/touchid-approver.swift
//
// Wire it into the MCP server config as an ExecApprover:
//   binary: ~/.x402-wallet/bin/touchid-approver
//   passRequestOnStdin: true
//
// Behavior: reads a JSON ApprovalRequest from stdin, uses
// LAContext.evaluatePolicy(.deviceOwnerAuthentication) which performs Touch ID
// with automatic fallback to the login password if the biometric fails.
// Exits 0 on success, non-zero on failure/cancel.

import Foundation
import LocalAuthentication

let data = FileHandle.standardInput.readDataToEndOfFile()
var reason = "Authorize x402 payment"
if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
   let summary = json["summary"] as? String {
    reason = summary.replacingOccurrences(of: "\n", with: " — ")
}

let ctx = LAContext()
ctx.localizedFallbackTitle = "Use password"
ctx.localizedCancelTitle = "Deny"

var error: NSError?
guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
    FileHandle.standardError.write(
        ("Cannot evaluate authentication policy: "
         + (error?.localizedDescription ?? "unknown"))
            .data(using: .utf8) ?? Data())
    exit(2)
}

let sema = DispatchSemaphore(value: 0)
var succeeded = false
ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, err in
    succeeded = ok
    if let e = err {
        FileHandle.standardError.write(
            ("Authentication failed: " + e.localizedDescription + "\n")
                .data(using: .utf8) ?? Data())
    }
    sema.signal()
}
sema.wait()
exit(succeeded ? 0 : 1)
