// Biometric / password approval helper for x402-wallet.
//
// Build once:
//   swiftc -O -o ~/.x402-wallet/bin/touchid-approver scripts/touchid-approver.swift
//
// Wire it into the MCP server config as the {"kind":"touchid"} approver (or
// via {"kind":"exec"} pointing at this binary).
//
// Reads a JSON ApprovalRequest from stdin (`summary` used as the prompt text)
// and evaluates LAContext.deviceOwnerAuthentication — Touch ID with password
// fallback.
//
// Exit codes (consumed by ExecApprover's codeToReason mapping):
//   0  authenticated (biometric or password)
//   1  unexpected error
//   10 user cancelled the prompt (or denied fallback)
//   11 biometry unavailable and no fallback policy applies

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

var policyError: NSError?
guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
    let msg = policyError?.localizedDescription ?? "unknown"
    FileHandle.standardError.write(
        ("Cannot evaluate authentication policy: " + msg + "\n")
            .data(using: .utf8) ?? Data())
    exit(11)
}

let sema = DispatchSemaphore(value: 0)
var succeeded = false
var authError: NSError?
ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, err in
    succeeded = ok
    authError = err as NSError?
    sema.signal()
}
sema.wait()

if succeeded {
    exit(0)
}

let code = authError?.code ?? 0
switch code {
case LAError.userCancel.rawValue,
     LAError.userFallback.rawValue,
     LAError.appCancel.rawValue,
     LAError.systemCancel.rawValue,
     LAError.authenticationFailed.rawValue:
    FileHandle.standardError.write(
        ("Authentication cancelled by user.\n").data(using: .utf8) ?? Data())
    exit(10)
case LAError.biometryNotAvailable.rawValue,
     LAError.biometryNotEnrolled.rawValue,
     LAError.biometryLockout.rawValue,
     LAError.passcodeNotSet.rawValue:
    FileHandle.standardError.write(
        ("Biometry unavailable: \(authError?.localizedDescription ?? "unknown")\n")
            .data(using: .utf8) ?? Data())
    exit(11)
default:
    FileHandle.standardError.write(
        ("Authentication failed: \(authError?.localizedDescription ?? "unknown") (code \(code))\n")
            .data(using: .utf8) ?? Data())
    exit(1)
}
