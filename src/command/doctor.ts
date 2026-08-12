/**
 * `pi-shuttle doctor` — PS-2 SKELETON (approved ownership: work-packages PS-2
 * "doctor skeleton with the status taxonomy"; operator-cli-contract §2).
 *
 * PS-2 implements: the closed status vocabulary (used exactly, never
 * embellished), the verdict renderer, and the observations PS-2's own model
 * can truthfully make WITHOUT subprocess probes: platform/architecture lane
 * claims (manifest-bound) and the operator runtime-config state. The full
 * probe suite (node, git, pi, gateway component, pi-guard, trusted stores,
 * ChatGPT/tunnel readiness) is owned by PS-4 and is NOT fabricated here —
 * the skeleton reports it as deferred rather than guessing a verdict.
 *
 * Exit codes (contract §2): 0 all supported checks pass; 1 findings
 * (e.g. invalid runtime configuration); 2 unsupported platform.
 */
import { COMPATIBILITY_MANIFEST } from '../compat/manifest.js';
import type { HostEnvironment } from '../host/environment.js';
import { hostLane, resolveLayout } from '../host/environment.js';
import { readRuntimeDocument } from '../config/document.js';

/** The closed status vocabulary (operator-cli-contract §2, used exactly). */
export const STATUS_VOCABULARY = ['supported', 'unsupported', 'installed but unverified', 'missing', 'partial installation'] as const;
export type StatusVerdict = (typeof STATUS_VOCABULARY)[number];

/** One doctor check: id, label, closed verdict, and a truthful detail line. */
export interface DoctorCheck {
  readonly id: string;
  readonly label: string;
  readonly verdict: StatusVerdict;
  readonly detail: string;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  /** Bounded scope notes (never verdicts). */
  readonly notes: readonly string[];
}

export type DoctorResult =
  | { readonly ok: true; readonly exitCode: 0 | 1 | 2; readonly report: DoctorReport }
  | { readonly ok: false; readonly exitCode: 1; readonly message: string };

/** Render a report deterministically; verdicts are printed exactly as vocabulary values. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = ['pi-shuttle doctor'];
  for (const check of report.checks) {
    lines.push(`  ${check.label}: ${check.verdict} — ${check.detail}`);
  }
  for (const note of report.notes) {
    lines.push(`  note: ${note}`);
  }
  return lines.join('\n') + '\n';
}

/** Run the PS-2 doctor skeleton over the injected host environment. */
export function runDoctorSkeleton(env: HostEnvironment): DoctorResult {
  const layout = resolveLayout(env.home);
  const lane = hostLane(env.platform, env.arch);
  const supported = COMPATIBILITY_MANIFEST.supportedLanes.includes(lane);
  const gated = COMPATIBILITY_MANIFEST.gatedLanes.includes(lane);

  const checks: DoctorCheck[] = [
    {
      id: 'platform',
      label: 'platform',
      verdict: supported ? 'supported' : 'unsupported',
      detail: `${env.platform} ${env.arch} (lane ${lane})${gated ? ' — gated: PS-6 host-lane evidence required, not claimed' : ''}`,
    },
  ];

  const config = readRuntimeDocument(layout.runtimeConfigPath);
  if (config.ok) {
    const count = config.document.surfaces.length;
    checks.push({
      id: 'runtime-config',
      label: 'runtime configuration',
      verdict: 'supported',
      detail: `${layout.runtimeConfigPath} — ${count} registered surface${count === 1 ? '' : 's'}`,
    });
  } else if (config.code === 'absent') {
    checks.push({
      id: 'runtime-config',
      label: 'runtime configuration',
      verdict: 'missing',
      detail: `${layout.runtimeConfigPath} does not exist (no projects registered)`,
    });
  } else {
    return { ok: false, exitCode: 1, message: `runtime configuration is invalid: ${config.message}` };
  }

  const anyUnsupported = checks.some((c) => c.verdict === 'unsupported');
  // SIR-PS2-003: finding-class verdicts (missing / installed but unverified /
  // partial installation) exit 1 per operator-cli-contract §2; unsupported
  // platform takes precedence (exit 2).
  const anyFinding = checks.some((c) => c.verdict === 'missing' || c.verdict === 'installed but unverified' || c.verdict === 'partial installation');
  const exitCode: 0 | 1 | 2 = anyUnsupported ? 2 : anyFinding ? 1 : 0;
  const report: DoctorReport = {
    checks,
    notes: [
      `layout: ${layout.shareDir} (share) / ${layout.stateDir} (state) / ${layout.configDir} (config)`,
      'component probes (node, git, pi, gateway component, pi-guard, trusted stores, ChatGPT/tunnel) are deferred to PS-4',
    ],
  };
  return { ok: true, exitCode, report };
}
