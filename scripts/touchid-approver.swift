// Biometric approval helper for x402-wallet — single-prompt version.
//
// Build once:
//   swiftc -O -o ~/.x402-wallet/bin/touchid-approver scripts/touchid-approver.swift
//
// Contract with TypeScript ExecApprover:
//   stdin  — JSON ApprovalRequest (see src/approvers/exec.ts serializeRequest).
//   exit 0  — approved (Touch ID or password).
//   exit 10 — user cancelled the system prompt.
//   exit 11 — biometry unavailable (no fallback policy).
//   exit 1  — unexpected error.
//
// UX: the macOS Touch ID sheet is the only modal. Payment details are encoded
// into LAContext.localizedReason so the user sees what they're authorizing
// directly in the system prompt — no separate AppKit "Approve / Deny" window
// duplicating the question. The deliberate Touch ID gesture is the approve
// action; Cancel rejects.

import AppKit
import Foundation
import LocalAuthentication

// --- Parse stdin ---

struct ApprovalView {
    let amount: String
    let chainName: String
    let hostname: String
    let purpose: String?
    let payTo: String
    let signerLabel: String
}

func readView() -> ApprovalView {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    let view = json["view"] as? [String: Any] ?? [:]
    return ApprovalView(
        amount: (view["amount"] as? String) ?? "unknown amount",
        chainName: (view["chainName"] as? String) ?? "unknown chain",
        hostname: (view["hostname"] as? String) ?? "unknown host",
        purpose: (view["purpose"] as? String).flatMap { $0.isEmpty ? nil : $0 },
        payTo: (view["payTo"] as? String) ?? "",
        signerLabel: (view["signerLabel"] as? String) ?? ""
    )
}

// --- Compose the localizedReason ---
//
// macOS prepends "<binary-name> is trying to " to whatever we return, so the
// string should read naturally as a verb phrase. Keep purpose truncated so the
// system sheet doesn't clip the important parts (amount + recipient).

func buildReason(_ v: ApprovalView) -> String {
    var r = "Authorize \(v.amount) on \(v.chainName) to \(v.hostname)"
    if let purpose = v.purpose {
        let maxPurpose = 80
        let trimmed: String =
            purpose.count > maxPurpose
                ? String(purpose.prefix(maxPurpose)) + "…"
                : purpose
        r += " — \(trimmed)"
    }
    return r
}

// --- Touch ID ---

enum Outcome {
    case approved
    case cancelled
    case biometryUnavailable
    case error(String)
}

func performTouchID(reason: String) -> Outcome {
    let ctx = LAContext()
    ctx.localizedFallbackTitle = "Use password"
    ctx.localizedCancelTitle = "Cancel"

    var policyError: NSError?
    guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
        return .biometryUnavailable
    }

    let sema = DispatchSemaphore(value: 0)
    var ok = false
    var authError: NSError?
    ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, err in
        ok = success
        authError = err as NSError?
        sema.signal()
    }
    sema.wait()

    if ok { return .approved }

    let code = authError?.code ?? 0
    switch code {
    case LAError.userCancel.rawValue,
         LAError.userFallback.rawValue,
         LAError.appCancel.rawValue,
         LAError.systemCancel.rawValue,
         LAError.authenticationFailed.rawValue:
        return .cancelled
    case LAError.biometryNotAvailable.rawValue,
         LAError.biometryNotEnrolled.rawValue,
         LAError.biometryLockout.rawValue,
         LAError.passcodeNotSet.rawValue:
        return .biometryUnavailable
    default:
        return .error(authError?.localizedDescription ?? "unknown (code \(code))")
    }
}

// --- Main ---

let app = NSApplication.shared
// .accessory: no Dock icon, no menu bar — but still GUI-eligible so the
// system Touch ID sheet can attach and steal focus.
app.setActivationPolicy(.accessory)
app.activate(ignoringOtherApps: true)

let view = readView()
let reason = buildReason(view)
let outcome = performTouchID(reason: reason)

switch outcome {
case .approved:
    exit(0)
case .cancelled:
    FileHandle.standardError.write(
        "Authentication cancelled by user.\n".data(using: .utf8) ?? Data()
    )
    exit(10)
case .biometryUnavailable:
    FileHandle.standardError.write(
        "Biometry unavailable.\n".data(using: .utf8) ?? Data()
    )
    exit(11)
case .error(let msg):
    FileHandle.standardError.write(
        "Authentication failed: \(msg)\n".data(using: .utf8) ?? Data()
    )
    exit(1)
}
