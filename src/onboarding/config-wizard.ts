import type { ConfigStore } from "../config/store.ts";
import type { ApproverConfig, WalletConfig } from "../config/types.ts";
import {
  addOriginAllowlist,
  atomicToUsdc,
  ConfigEditError,
  removeOriginAllowlist,
  removeOriginBudget,
  setApprover,
  setLimits,
  setOriginBudget,
  summarize,
  usdcToAtomic,
} from "./config-actions.ts";

export interface ConfigWizardDeps {
  config: ConfigStore;
}

export async function configWizard(deps: ConfigWizardDeps): Promise<number> {
  const p = await import("@clack/prompts");

  p.intro("x402-wallet — settings");

  let config = await deps.config.load();
  let dirty = false;

  for (;;) {
    showSummary(p, config);

    const action = await p.select({
      message: "What do you want to do?",
      options: [
        { value: "limits", label: "Set spending limits (per-request / per-day)" },
        { value: "approver", label: "Change approval mode (none / dialog / Touch ID)" },
        { value: "allowlist", label: "Manage origin allowlist" },
        { value: "budgets", label: "Manage per-origin budgets" },
        {
          value: "save",
          label: dirty ? "Save & exit" : "Exit (no pending changes)",
        },
        { value: "cancel", label: "Discard changes & exit" },
      ],
    });

    if (p.isCancel(action)) {
      p.cancel("Cancelled.");
      return 1;
    }

    try {
      switch (action) {
        case "limits": {
          const next = await editLimits(p, config);
          if (next) {
            config = next;
            dirty = true;
          }
          break;
        }
        case "approver": {
          const next = await editApprover(p, config);
          if (next) {
            config = next;
            dirty = true;
          }
          break;
        }
        case "allowlist": {
          const next = await editAllowlist(p, config);
          if (next) {
            config = next;
            dirty = true;
          }
          break;
        }
        case "budgets": {
          const next = await editBudgets(p, config);
          if (next) {
            config = next;
            dirty = true;
          }
          break;
        }
        case "save": {
          if (dirty) {
            await deps.config.save(config);
            p.outro(`Saved to ${deps.config.path()}`);
          } else {
            p.outro("No changes.");
          }
          return 0;
        }
        case "cancel": {
          p.outro(dirty ? "Discarded pending changes." : "No changes.");
          return 0;
        }
      }
    } catch (err) {
      if (err instanceof ConfigEditError) {
        p.log.error(err.message);
      } else {
        throw err;
      }
    }
  }
}

type Prompts = typeof import("@clack/prompts");

function showSummary(p: Prompts, config: WalletConfig): void {
  const s = summarize(config);
  const lines = [
    `signers:           ${s.signerCount}`,
    `per-request cap:   ${s.perRequestUsdc} USDC`,
    `per-day cap:       ${s.perDayUsdc ? `${s.perDayUsdc} USDC` : "(none)"}`,
    `approval mode:     ${s.approver}`,
    `origin allowlist:  ${s.originAllowlist.length === 0 ? "(any)" : s.originAllowlist.join(", ")}`,
    `per-origin budgets:${
      s.originBudgets.length === 0
        ? " (none)"
        : "\n  " + s.originBudgets.map((b) => `${b.origin}: ${b.usdc} USDC`).join("\n  ")
    }`,
  ];
  p.note(lines.join("\n"), "Current settings");
}

async function editLimits(p: Prompts, config: WalletConfig): Promise<WalletConfig | null> {
  const current = summarize(config);
  const perRequest = await p.text({
    message: "Per-request cap (USDC). Blank = keep current.",
    placeholder: current.perRequestUsdc,
    validate: (v) => maybeUsdc(v),
  });
  if (p.isCancel(perRequest)) return null;

  const perDay = await p.text({
    message: 'Per-day cap (USDC). Blank = keep current. Type "-" to remove.',
    placeholder: current.perDayUsdc ?? "(none)",
    validate: (v) => (v === "-" ? undefined : maybeUsdc(v)),
  });
  if (p.isCancel(perDay)) return null;

  const update: { perRequest?: string; perDay?: string | null } = {};
  if (perRequest && perRequest.trim()) update.perRequest = perRequest;
  if (perDay === "-") update.perDay = null;
  else if (perDay && perDay.trim()) update.perDay = perDay;

  if (!("perRequest" in update) && !("perDay" in update)) return null;
  return setLimits(config, update);
}

async function editApprover(p: Prompts, config: WalletConfig): Promise<WalletConfig | null> {
  const kind = await p.select({
    message: "Approval mode",
    options: [
      { value: "none", label: "none — pay silently within policy" },
      { value: "osascript", label: "osascript — native macOS dialog" },
      { value: "touchid", label: "touchid — Touch ID via Swift helper" },
      { value: "exec", label: "exec — custom binary" },
    ],
  });
  if (p.isCancel(kind)) return null;

  let approver: ApproverConfig;
  switch (kind) {
    case "none":
      approver = { kind: "none" };
      break;
    case "osascript": {
      const title = await p.text({
        message: "Dialog title (blank = default)",
        placeholder: "x402 payment",
      });
      if (p.isCancel(title)) return null;
      approver = title && title.trim() ? { kind: "osascript", title } : { kind: "osascript" };
      break;
    }
    case "touchid": {
      const binary = await p.text({
        message: "Touch ID helper binary (blank = default ~/.x402-wallet/bin/touchid-approver)",
        placeholder: "~/.x402-wallet/bin/touchid-approver",
      });
      if (p.isCancel(binary)) return null;
      approver =
        binary && binary.trim() ? { kind: "touchid", binary } : { kind: "touchid" };
      break;
    }
    case "exec": {
      const binary = await p.text({
        message: "Path to approver binary",
        validate: (v) => (v && v.trim() ? undefined : "binary is required"),
      });
      if (p.isCancel(binary)) return null;
      approver = { kind: "exec", binary };
      break;
    }
    default:
      return null;
  }
  return setApprover(config, approver);
}

async function editAllowlist(p: Prompts, config: WalletConfig): Promise<WalletConfig | null> {
  const sub = await p.select({
    message: "Origin allowlist",
    options: [
      { value: "add", label: "Add an origin" },
      { value: "remove", label: "Remove an origin" },
      { value: "back", label: "Back" },
    ],
  });
  if (p.isCancel(sub) || sub === "back") return null;

  if (sub === "add") {
    const origin = await p.text({
      message: "Origin (e.g. https://transit402.dev)",
      validate: (v) => (v && v.trim() ? undefined : "origin is required"),
    });
    if (p.isCancel(origin)) return null;
    return addOriginAllowlist(config, origin);
  }

  const list = config.policy.originAllowlist ?? [];
  if (list.length === 0) {
    p.log.info("Allowlist is empty.");
    return null;
  }
  const origin = await p.select({
    message: "Remove which origin?",
    options: list.map((o) => ({ value: o, label: o })),
  });
  if (p.isCancel(origin)) return null;
  return removeOriginAllowlist(config, origin);
}

async function editBudgets(p: Prompts, config: WalletConfig): Promise<WalletConfig | null> {
  const sub = await p.select({
    message: "Per-origin budgets",
    options: [
      { value: "set", label: "Set / update a budget" },
      { value: "remove", label: "Remove a budget" },
      { value: "back", label: "Back" },
    ],
  });
  if (p.isCancel(sub) || sub === "back") return null;

  if (sub === "set") {
    const origin = await p.text({
      message: "Origin (e.g. https://transit402.dev)",
      validate: (v) => (v && v.trim() ? undefined : "origin is required"),
    });
    if (p.isCancel(origin)) return null;
    const usdc = await p.text({
      message: "Daily budget for this origin (USDC)",
      validate: (v) => maybeUsdc(v, /*required*/ true),
    });
    if (p.isCancel(usdc)) return null;
    return setOriginBudget(config, origin, usdc);
  }

  const entries = Object.entries(config.policy.perOriginBudgets ?? {});
  if (entries.length === 0) {
    p.log.info("No per-origin budgets configured.");
    return null;
  }
  const origin = await p.select({
    message: "Remove which budget?",
    options: entries.map(([o, atomic]) => ({
      value: o,
      label: `${o} — ${atomicToUsdc(atomic)} USDC`,
    })),
  });
  if (p.isCancel(origin)) return null;
  return removeOriginBudget(config, origin);
}

function maybeUsdc(input: string, required = false): string | undefined {
  if (!input || !input.trim()) {
    return required ? "amount is required" : undefined;
  }
  try {
    usdcToAtomic(input);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
