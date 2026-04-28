// Biometric approval helper for x402-wallet.
//
// Build once:
//   swiftc -O -o ~/.x402-wallet/bin/touchid-approver scripts/touchid-approver.swift
//
// Contract with TypeScript ExecApprover:
//   stdin  — JSON ApprovalRequest (see src/approvers/exec.ts serializeRequest).
//   exit 0  — approved (biometric or password).
//   exit 10 — user cancelled the dialog or denied biometry.
//   exit 11 — biometry unavailable (no fallback policy).
//   exit 1  — unexpected error.
//
// UX: shows a native AppKit window with amount, chain, recipient domain, and
// purpose. Two buttons: Deny (default: Enter/Esc) and Approve. Clicking
// Approve invokes LAContext.evaluatePolicy(.deviceOwnerAuthentication),
// which pops the system Touch ID sheet over the window.

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

let approvalView = readView()

// --- AppKit dialog ---

final class ApprovalWindowController: NSObject, NSWindowDelegate {
    private let window: NSWindow
    private let onDecision: (Bool) -> Void

    init(view: ApprovalView, onDecision: @escaping (Bool) -> Void) {
        self.onDecision = onDecision
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 440, height: 280),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "x402 Payment"
        window.isReleasedWhenClosed = false
        window.level = .floating
        window.center()
        super.init()
        window.delegate = self

        let root = NSView(frame: window.contentView!.bounds)
        root.autoresizingMask = [.width, .height]

        // Amount (large, bold)
        let amount = NSTextField(labelWithString: view.amount)
        amount.font = NSFont.systemFont(ofSize: 28, weight: .semibold)
        amount.alignment = .center
        amount.frame = NSRect(x: 20, y: 200, width: 400, height: 40)
        amount.autoresizingMask = [.width, .minYMargin]
        root.addSubview(amount)

        // Chain (secondary, muted)
        let chain = NSTextField(labelWithString: "on \(view.chainName)")
        chain.font = NSFont.systemFont(ofSize: 13)
        chain.textColor = .secondaryLabelColor
        chain.alignment = .center
        chain.frame = NSRect(x: 20, y: 176, width: 400, height: 18)
        chain.autoresizingMask = [.width, .minYMargin]
        root.addSubview(chain)

        // Divider
        let divider = NSBox(frame: NSRect(x: 40, y: 160, width: 360, height: 1))
        divider.boxType = .separator
        divider.autoresizingMask = [.width, .minYMargin]
        root.addSubview(divider)

        // Rows: "To" + (optional) "For"
        var y: CGFloat = 116
        let purposeLines = view.purpose == nil ? 0 : 1
        if purposeLines > 0 { y += 24 }

        addRow(to: root, y: y, title: "To", value: view.hostname)
        if let purpose = view.purpose {
            y -= 48
            addRow(to: root, y: y, title: "For", value: purpose)
        }

        // Buttons
        let approve = NSButton(title: "Approve", target: self, action: #selector(approvePressed))
        approve.keyEquivalent = "" // explicitly NOT default
        approve.bezelStyle = .rounded
        approve.frame = NSRect(x: 320, y: 20, width: 100, height: 32)
        approve.autoresizingMask = [.minXMargin, .maxYMargin]
        root.addSubview(approve)

        let deny = NSButton(title: "Deny", target: self, action: #selector(denyPressed))
        deny.keyEquivalent = "\r" // default button: Enter = Deny (safety)
        deny.bezelStyle = .rounded
        deny.frame = NSRect(x: 210, y: 20, width: 100, height: 32)
        deny.autoresizingMask = [.minXMargin, .maxYMargin]
        root.addSubview(deny)

        window.contentView?.addSubview(root)
    }

    private func addRow(to parent: NSView, y: CGFloat, title: String, value: String) {
        let titleLabel = NSTextField(labelWithString: title)
        titleLabel.font = NSFont.systemFont(ofSize: 12)
        titleLabel.textColor = .secondaryLabelColor
        titleLabel.alignment = .right
        titleLabel.frame = NSRect(x: 20, y: y, width: 60, height: 18)
        titleLabel.autoresizingMask = [.maxXMargin, .minYMargin]
        parent.addSubview(titleLabel)

        let valueLabel = NSTextField(wrappingLabelWithString: value)
        valueLabel.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        valueLabel.maximumNumberOfLines = 2
        valueLabel.lineBreakMode = .byTruncatingTail
        valueLabel.frame = NSRect(x: 90, y: y - 18, width: 330, height: 38)
        valueLabel.autoresizingMask = [.width, .minYMargin]
        parent.addSubview(valueLabel)
    }

    @objc private func approvePressed() {
        onDecision(true)
    }

    @objc private func denyPressed() {
        onDecision(false)
    }

    func windowWillClose(_ notification: Notification) {
        // Close via red traffic-light or Esc counts as deny.
        onDecision(false)
    }

    func show() {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func close() {
        window.delegate = nil // prevent windowWillClose double-firing
        window.close()
    }
}

// --- Main ---

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

let app = NSApplication.shared
app.setActivationPolicy(.regular) // show the window reliably
var controller: ApprovalWindowController!

controller = ApprovalWindowController(view: approvalView) { approvedByUser in
    if !approvedByUser {
        FileHandle.standardError.write("Authentication cancelled by user.\n".data(using: .utf8) ?? Data())
        controller.close()
        exit(10)
    }
    // User clicked Approve — gate with Touch ID.
    let reason = "Authorize \(approvalView.amount) to \(approvalView.hostname)"
    let outcome = performTouchID(reason: reason)
    controller.close()
    switch outcome {
    case .approved:
        exit(0)
    case .cancelled:
        FileHandle.standardError.write("Authentication cancelled by user.\n".data(using: .utf8) ?? Data())
        exit(10)
    case .biometryUnavailable:
        FileHandle.standardError.write("Biometry unavailable.\n".data(using: .utf8) ?? Data())
        exit(11)
    case .error(let msg):
        FileHandle.standardError.write("Authentication failed: \(msg)\n".data(using: .utf8) ?? Data())
        exit(1)
    }
}

controller.show()
app.run()
