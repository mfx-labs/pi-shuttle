/**
 * `pi-shuttle doctor` — PS-4 full local health probe suite
 * (operator-cli-contract §2, gate PS-4 §13–§14). Replaces the PS-2
 * skeleton's deferred probes with real local observation.
 *
 * Closed status vocabulary (used exactly, never embellished):
 * `supported` | `unsupported` | `installed but unverified` | `missing` |
 * `partial installation`.
 *
 * Probe discipline:
 *   - platform/architecture runtime eligibility is descriptor-bound;
 *     `supportedLanes` remains separate normative support metadata. A
 *     descriptor-bound but unpromoted target is technically eligible and
 *     reported `installed but unverified`, never `supported`;
 *   - Node is the running interpreter (same rule as the installer);
 *     runtime minimum >= 22.19.0 (22.23.2 is the validated CI baseline,
 *     reported never gating); the retained darwin-arm64 architecture
 *     check (native arm64) applies on the darwin-arm64 target;
 *   - Git is discovered through PATH (never `/usr/bin/git`); runtime
 *     minimum >= 2.30.0 (2.45.4 is the validated CI baseline, reported
 *     never gating); presence ≠ lane evidence;
 *   - Pi 0.83.0 is the known-good baseline; candidates >= 0.83.0 are
 *     accepted only when the committed pi-guard compatibility probe
 *     PASSES (probe FAIL → unsupported; probe infrastructure unavailable
 *     → installed but unverified; below the minimum → unsupported);
 *   - Gateway/pi-guard verdicts come from the closed installation receipt
 *     plus read-only disk/Pi observation — never from filesystem
 *     existence alone;
 *   - trusted-store integrity is NOT re-verified here: the only supported
 *     verification path is the Gateway operator bootstrap replay
 *     (`pi-shuttle project add <path>`), which doctor never invokes
 *     (mutation-free discipline). The limitation is reported truthfully;
 *   - doctor never mutates anything: no bootstrap, no lock deletion, no
 *     repair. Stale/busy coordination locks are DETECTED and reported
 *     with recovery guidance; a lock artifact's liveness cannot be
 *     confirmed without PID introspection, so its verdict maps to
 *     `installed but unverified` (present, state unconfirmable) — a
 *     finding (exit 1), never auto-stolen;
 *   - ChatGPT/tunnel readiness is not locally observable (external
 *     platform state; PS-7 owns onboarding) and is reported as a note,
 *     never fabricated.
 *
 * Exit codes (contract §2; SIR-PS2-003): `unsupported` verdicts → 2
 * (precedence); finding-class verdicts (`missing`, `installed but
 * unverified`, `partial installation`) → 1; otherwise 0. Malformed
 * runtime configuration or receipt fails closed with exit 1.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPATIBILITY_MANIFEST, GIT_LANE_VERSION, GIT_RUNTIME_MINIMUM, NODE_LANE_VERSION, NODE_RUNTIME_MINIMUM, PI_COMPATIBILITY_BASELINE, PI_GUARD_VERSION, PI_RUNTIME_MINIMUM, gatewayDescriptorForLane } from '../compat/manifest.js';
import { classifyAgainstMinimum, parseVersionTriple } from '../compat/versions.js';
import { resolvePiLoaderFromBin } from '../compat/pi-guard-probe.js';
import { classifyNodeRuntime } from '../installer/preflight.js';
import { readRuntimeDocument } from '../config/document.js';
import type { HostEnvironment, LayoutPaths } from '../host/environment.js';
import { canonicalizePath, hostLane, resolveLayout } from '../host/environment.js';
import { readPackageIdentity } from '../installer/artifact.js';
import { regularFileOrNull } from '../installer/archive.js';
import { componentDirName, PI_GUARD_PACKAGE_NAME, piListConfirmsSource, validateBinPath } from '../installer/components.js';
import { readReceipt } from '../installer/receipt.js';
import type { InstallReceipt } from '../installer/receipt.js';
import { resolveExecutable, runProcess } from '../process/runner.js';
import { projectLockPath } from '../lifecycle/state.js';

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

function receiptDistribution(receipt: InstallReceipt): string {
  if (receipt.recovery !== undefined) {
    const recoveredBy = receipt.recovery.recoveredBy === undefined
      ? 'unknown'
      : `latest @ ${receipt.recovery.recoveredBy.slice(receipt.recovery.recoveredBy.lastIndexOf('@') + 1)}`;
    const originalTime = receipt.recovery.originalInstalledAt ?? 'unknown';
    const originalOrigin = receipt.recovery.originalChannel === 'unknown'
      ? 'unknown'
      : `${receipt.recovery.originalChannel}${receipt.recovery.originalSourceIdentity === undefined ? '' : ` @ ${receipt.recovery.originalSourceIdentity.slice(receipt.recovery.originalSourceIdentity.lastIndexOf('@') + 1)}`}`;
    return `installation metadata: recovered; recovered at: ${receipt.recovery.recoveredAt}; original installation time: ${originalTime}; original distribution provenance: ${originalOrigin}; recovered by: ${recoveredBy}`;
  }
  return receipt.channel === 'latest' && receipt.sourceIdentity
    ? `latest ${receipt.piShuttleVersion} @ ${receipt.sourceIdentity.slice(receipt.sourceIdentity.lastIndexOf('@') + 1)}`
    : `stable ${receipt.piShuttleVersion}`;
}

/** Injectable pi observations (host seam + probe environment). */
export interface DoctorContext {
  readonly env: HostEnvironment;
  readonly layout: LayoutPaths;
  /** Running interpreter (defaults to `process.execPath`). */
  readonly nodeExecutable?: string;
  /** Executable-search environment (PATH); absent → real process environment. */
  readonly pathEnv?: NodeJS.ProcessEnv;
  /** Injectable UID observation (test seam; defaults to `process.getuid()`). */
  readonly uid?: number;
  /**
   * PS-6R injectable pi-guard compatibility probe (default: the committed
   * compiled probe spawned through the running node). Candidates (pi
   * >= 0.83.0 other than the known-good baseline) require a PASS.
   */
  readonly piGuardProbe?: (piExecutable: string, piGuardDir: string) => Promise<{ readonly ok: boolean; readonly detail: string; readonly infrastructure: boolean }>;
}

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

/**
 * The default pi-guard compatibility probe (PS-6R): spawns the committed
 * compiled probe through the running node with a bounded timeout.
 * `infrastructure: true` = the probe could not run (loader/entry
 * unavailable, usage error) — fail closed as unverifiable; `ok: false`
 * with `infrastructure: false` = the integration surface FAILED the
 * probe (unsupported).
 */
export function defaultPiGuardProbe(nodeExecutable: string, pathEnv: NodeJS.ProcessEnv | undefined, home: string): (piExecutable: string, piGuardDir: string) => Promise<{ readonly ok: boolean; readonly detail: string; readonly infrastructure: boolean }> {
  const probeCli = fileURLToPath(new URL('../compat/pi-guard-probe.js', import.meta.url));
  return async (piExecutable, piGuardDir) => {
    const loader = resolvePiLoaderFromBin(piExecutable);
    if (loader === null) {
      return { ok: false, detail: `pi extension loader could not be located from ${piExecutable}`, infrastructure: true };
    }
    const entry = join(piGuardDir, 'extensions', 'pi-guard', 'index.ts');
    if (!existsSync(entry)) {
      return { ok: false, detail: `installed pi-guard extension entry missing at ${entry}`, infrastructure: true };
    }
    const probeRun = await runProcess(nodeExecutable, [probeCli], {
      timeoutMs: 60_000,
      env: { ...pathEnv, PI_LOADER: loader, PI_GUARD_ENTRY: entry, HOME: home },
    });
    if (probeRun.exitCode === 0 && probeRun.signal === null && !probeRun.timedOut) {
      return { ok: true, detail: probeRun.stdout.trim().slice(0, 200) || 'probe passed', infrastructure: false };
    }
    if (probeRun.exitCode === 1 && probeRun.signal === null && !probeRun.timedOut) {
      return { ok: false, detail: (probeRun.stderr.trim() || probeRun.stdout.trim()).slice(0, 300) || 'probe FAIL', infrastructure: false };
    }
    return { ok: false, detail: `probe could not complete (exit ${probeRun.exitCode ?? 'unknown'}${probeRun.timedOut ? ', timed out' : ''})`, infrastructure: true };
  };
}

function check(id: string, label: string, verdict: StatusVerdict, detail: string): DoctorCheck {
  return { id, label, verdict, detail };
}

/** Mode observation (read-only); null when the path is unreadable/absent. */
function modeOf(path: string): number | null {
  try {
    return statSync(path).mode & 0o777;
  } catch {
    return null;
  }
}

function modeNote(path: string, expected: number): string {
  const mode = modeOf(path);
  if (mode === null) return `${path}: unreadable`;
  return `${path}: mode ${mode.toString(8).padStart(4, '0')}${(mode & 0o077) !== 0 ? ` (unsafe: group/world bits must be clear; expected ${expected.toString(8).padStart(4, '0')})` : ''}`;
}

/** Git isolation directory conditions (mirrors the Gateway WP-7 host-directory contract). */
function gitIsolationProblem(dir: string, workspaceRoots: readonly string[]): string | null {
  let st;
  try {
    st = statSync(dir);
  } catch {
    return `missing: ${dir}`;
  }
  if (!st.isDirectory()) return `not a directory: ${dir}`;
  if ((st.mode & 0o077) !== 0) return `unsafe mode (group/world bits set): ${dir}`;
  for (const root of workspaceRoots) {
    if (dir === root || dir.startsWith(root.endsWith('/') ? root : `${root}/`)) {
      return `inside a workspace root: ${dir}`;
    }
  }
  try {
    const entries = readdirSync(dir);
    if (entries.length > 0) return `not empty: ${dir}`;
  } catch {
    return `unreadable: ${dir}`;
  }
  return null;
}

/** Run the full PS-4 doctor probe suite. Read-only; async only for bounded subprocess probes. */
export async function runDoctor(ctx: DoctorContext): Promise<DoctorResult> {
  const layout = ctx.layout;
  const nodeExecutable = ctx.nodeExecutable ?? process.execPath;
  const lane = hostLane(ctx.env.platform, ctx.env.arch);
  // C2: the SELECTED lane descriptor is the only Gateway identity doctor
  // validates against — no historical global constants, no other lane's
  // identity. Unbound lanes fail closed for the gateway check.
  const laneDescriptor = gatewayDescriptorForLane(lane);
  const supportedLane = COMPATIBILITY_MANIFEST.supportedLanes.includes(lane);
  const checks: DoctorCheck[] = [];
  const notes: string[] = [];

  // 1. Platform / architecture: descriptor selection gates technical
  //    eligibility; supportedLanes remains a separate normative claim.
  const platformDetail = `${ctx.env.platform} ${ctx.env.arch} (lane ${lane})`;
  if (!laneDescriptor.ok) {
    checks.push(check('platform', 'platform', 'unsupported', `${platformDetail} — ${laneDescriptor.message}`));
  } else if (supportedLane) {
    checks.push(check('platform', 'platform', 'supported', `${platformDetail} — descriptor-bound and product-support promoted`));
  } else {
    checks.push(check('platform', 'platform', 'installed but unverified', `${platformDetail} — technically eligible via a valid Gateway descriptor; not a product-support claim`));
  }

  // 2. Node (the running interpreter is the runtime node; PS-6R minimum
  //    >= 22.19.0 — exact baseline 22.23.2 is reporting, never a gate).
  const nodeRun = await runProcess(nodeExecutable, ['--version'], { env: ctx.pathEnv, timeoutMs: 10_000 });
  const nodeVersion = nodeRun.exitCode === 0 ? nodeRun.stdout.trim().replace(/^v/, '') : '';
  const nodeClassification = nodeVersion === '' ? 'malformed' : classifyNodeRuntime(nodeVersion);
  // PS-6 darwin lane check (RETAINED): on the darwin-arm64 host
  // lane the ACTUAL Node executable must be arm64 — a Rosetta/x64 Node
  // cannot satisfy the darwin-arm64 target. That target remains technically
  // eligible but is not support-promoted; this check never affects Linux or
  // darwin-x86_64 behavior. The architecture requirement applies to ANY
  // version-compatible runtime.
  const requiresNativeArm64Node = ctx.env.platform === 'darwin' && ctx.env.arch === 'arm64';
  let nodeArch = '';
  if (requiresNativeArm64Node && nodeClassification === 'supported') {
    const archRun = await runProcess(nodeExecutable, ['-p', 'process.arch'], { env: ctx.pathEnv, timeoutMs: 10_000 });
    nodeArch = archRun.exitCode === 0 && archRun.signal === null && !archRun.timedOut ? archRun.stdout.trim() : '';
  }
  if (nodeClassification === 'supported') {
    checks.push(check('node', 'node', 'supported', `node ${nodeVersion} — version-compatible (minimum ${NODE_RUNTIME_MINIMUM}; validated CI baseline ${NODE_LANE_VERSION})`));
  } else if (nodeClassification === 'below-minimum') {
    checks.push(check('node', 'node', 'unsupported', `node ${nodeVersion} is below the minimum supported runtime ${NODE_RUNTIME_MINIMUM} (validated CI baseline ${NODE_LANE_VERSION})`));
  } else {
    checks.push(check('node', 'node', 'installed but unverified', nodeVersion === '' ? 'version probe produced no output' : `node version could not be parsed ('${nodeVersion}'); minimum supported runtime ${NODE_RUNTIME_MINIMUM}`));
  }
  if (requiresNativeArm64Node && nodeClassification === 'supported') {
    if (nodeArch === 'arm64') {
      const archCheck = checks[checks.length - 1]!;
      checks[checks.length - 1] = check('node', 'node', 'supported', `${archCheck.detail} — native arm64 executable (process.arch ${nodeArch})`);
    } else if (nodeArch !== '') {
      // Rosetta/x64 (or otherwise wrong-arch) Node on the darwin-arm64
      // lane: the lane requires a native arm64 Node — fail closed.
      checks[checks.length - 1] = check('node', 'node', 'unsupported', `node ${nodeVersion} runs as ${nodeArch} — the darwin-arm64 lane requires a native arm64 Node executable (Rosetta/x64 is not a claimed lane)`);
    } else {
      checks[checks.length - 1] = check('node', 'node', 'installed but unverified', `node ${nodeVersion} — architecture probe produced no observable result on the darwin-arm64 lane`);
    }
  }

  // 3. Git (PATH discovery; PS-6R minimum >= 2.30.0 — exact baseline
  //    2.45.4 is reporting, never a gate; presence/safety remain hard).
  const gitPath = resolveExecutable('git', ctx.pathEnv);
  if (gitPath === null) {
    checks.push(check('git', 'git', 'missing', 'git executable not found on PATH'));
  } else {
    const gitRun = await runProcess(gitPath, ['--version'], { env: ctx.pathEnv, timeoutMs: 10_000 });
    const gitText = gitRun.exitCode === 0 ? gitRun.stdout.trim() : '';
    const match = gitText.match(/^git version (\S+)/);
    if (match === null) {
      checks.push(check('git', 'git', 'installed but unverified', `${gitPath} — version could not be confirmed (${gitText || 'probe failed'})`));
    } else {
      const gitVersion = match[1]!;
      const gitVerdict = classifyAgainstMinimum(gitVersion, GIT_RUNTIME_MINIMUM);
      if (gitVerdict === 'at-or-above') {
        checks.push(check('git', 'git', 'supported', `${gitPath} — git ${gitVersion} (minimum ${GIT_RUNTIME_MINIMUM}; validated CI baseline ${GIT_LANE_VERSION})`));
      } else if (gitVerdict === 'below-minimum') {
        checks.push(check('git', 'git', 'unsupported', `${gitPath} — git ${gitVersion} is below the minimum supported version ${GIT_RUNTIME_MINIMUM} (validated CI baseline ${GIT_LANE_VERSION})`));
      } else {
        checks.push(check('git', 'git', 'installed but unverified', `${gitPath} — git version could not be parsed ('${gitVersion}'); minimum supported version ${GIT_RUNTIME_MINIMUM}`));
      }
    }
  }

  // 4. Pi (0.83.0 known-good; PS-6R: candidates >= 0.83.0 require the
  //    committed pi-guard compatibility probe PASS; below minimum or
  //    failed probe → unsupported; missing → missing).
  const piPath = resolveExecutable('pi', ctx.pathEnv);
  if (piPath === null) {
    checks.push(check('pi', 'pi', 'missing', 'pi executable not found on PATH'));
  } else {
    const piRun = await runProcess(piPath, ['--version'], { env: ctx.pathEnv, timeoutMs: 10_000 });
    const piVersion = piRun.exitCode === 0 ? (piRun.stdout.trim().split(/\s+/)[0] ?? '') : '';
    const piTriple = piVersion === '' ? null : parseVersionTriple(piVersion);
    if (piVersion === PI_COMPATIBILITY_BASELINE) {
      checks.push(check('pi', 'pi', 'supported', `${piPath} — pi ${piVersion} (known-good baseline)`));
    } else if (piVersion === '') {
      checks.push(check('pi', 'pi', 'installed but unverified', `${piPath} — version could not be confirmed`));
    } else if (piTriple === null) {
      checks.push(check('pi', 'pi', 'installed but unverified', `${piPath} — pi version could not be parsed ('${piVersion}'); minimum ${PI_RUNTIME_MINIMUM}`));
    } else if (classifyAgainstMinimum(piVersion, PI_RUNTIME_MINIMUM) === 'below-minimum') {
      checks.push(check('pi', 'pi', 'unsupported', `${piPath} — pi ${piVersion} is below the minimum supported version ${PI_RUNTIME_MINIMUM}; 0.83.0 is the known-good baseline`));
    } else {
      // Candidate >= 0.83.0: the committed pi-guard compatibility probe
      // must PASS. The probe needs the installed pi-guard extension entry.
      const piGuardDir = join(layout.packagesDir, componentDirName(PI_GUARD_PACKAGE_NAME, PI_GUARD_VERSION));
      const probe = await (ctx.piGuardProbe ?? defaultPiGuardProbe(ctx.nodeExecutable ?? process.execPath, ctx.pathEnv, ctx.env.home))(piPath, piGuardDir);
      if (probe.ok) {
        checks.push(check('pi', 'pi', 'supported', `${piPath} — pi ${piVersion} (candidate; pi-guard compatibility probe PASS: ${probe.detail})`));
      } else if (probe.infrastructure) {
        checks.push(check('pi', 'pi', 'installed but unverified', `${piPath} — pi ${piVersion} candidate; compatibility probe could not run (${probe.detail})`));
      } else {
        checks.push(check('pi', 'pi', 'unsupported', `${piPath} — pi ${piVersion} candidate; pi-guard compatibility probe FAIL: ${probe.detail}`));
      }
    }
  }

  // 5. Installation receipt (single source of installed truth; never inferred from disk).
  const receipt = readReceipt(layout.installReceiptPath);
  if (!receipt.ok) {
    if (receipt.code === 'absent') {
      checks.push(check('receipt', 'installation receipt', 'missing', `${layout.installReceiptPath} does not exist; run the installer`));
    } else {
      return { ok: false, exitCode: 1, message: `installation receipt is invalid (${receipt.code}): ${receipt.message}` };
    }
  } else {
    const entry = receipt.receipt.components.gateway;
    const distribution = receiptDistribution(receipt.receipt);
    if (receipt.receipt.result === 'PARTIAL') {
      const mode = modeNote(layout.installReceiptPath, 0o600);
      checks.push(check('receipt', 'installation receipt', 'partial installation', `${distribution}; ${mode}; omitted: ${receipt.receipt.omitted.join(', ') || 'none'} — re-run the installer to complete`));
    } else if (entry === null) {
      checks.push(check('receipt', 'installation receipt', 'partial installation', `${distribution}; receipt records no Gateway component; re-run the installer with the Gateway selected`));
    } else {
      const mode = modeNote(layout.installReceiptPath, 0o600);
      const modeSafe = modeOf(layout.installReceiptPath) !== null && (modeOf(layout.installReceiptPath)! & 0o077) === 0;
      checks.push(check('receipt', 'installation receipt', modeSafe ? 'supported' : 'installed but unverified', `${distribution}; ${mode}`));
    }
  }

  // 6. Gateway component (receipt + installed package, read-only; C2:
  //    validated against the SELECTED lane descriptor — never the
  //    historical global package/version assumptions, never another
  //    lane's package identity).
  if (!laneDescriptor.ok) {
    checks.push(check('gateway', 'gateway component', 'missing', `gateway identity is not bound for host lane ${lane}; refusing to validate any installed package (no fallback to another lane identity)`));
  } else if (receipt.ok && receipt.receipt.components.gateway !== null) {
    const descriptor = laneDescriptor.descriptor;
    const gatewayEntry = receipt.receipt.components.gateway;
    if (gatewayEntry.status === 'failed') {
      checks.push(check('gateway', 'gateway component', 'missing', 'installation receipt records a failed Gateway install; re-run the installer'));
    } else if (gatewayEntry.status === 'installed-unverified') {
      checks.push(check('gateway', 'gateway component', 'installed but unverified', `recorded as installed-unverified (${gatewayEntry.installPath}); the bounded bin smoke did not pass at install time — re-run the installer`));
    } else {
      const identity = readPackageIdentity(gatewayEntry.installPath);
      if (identity === null) {
        if (existsSync(gatewayEntry.installPath)) {
          checks.push(check('gateway', 'gateway component', 'installed but unverified', `package identity could not be read at ${gatewayEntry.installPath}`));
        } else {
          checks.push(check('gateway', 'gateway component', 'missing', `installed package directory no longer present: ${gatewayEntry.installPath}; re-run the installer`));
        }
      } else if (identity.name !== descriptor.packageName || identity.version !== descriptor.version) {
        checks.push(check('gateway', 'gateway component', 'installed but unverified', `package identity drifted: found ${identity.name}@${identity.version}, selected lane ${lane} expects ${descriptor.packageName}@${descriptor.version}`));
      } else if (gatewayEntry.commit !== descriptor.commit) {
        checks.push(check('gateway', 'gateway component', 'installed but unverified', `gateway commit drifted: receipt records ${gatewayEntry.commit}, selected lane ${lane} expects ${descriptor.commit}`));
      } else {
        const declaredBin = identity.bin[descriptor.binName];
        let binResolved: string | null = null;
        if (declaredBin !== undefined) {
          const binCheck = validateBinPath(declaredBin, gatewayEntry.installPath);
          binResolved = binCheck.ok ? join(gatewayEntry.installPath, declaredBin) : null;
        }
        if (binResolved === null || binResolved !== gatewayEntry.binPath) {
          checks.push(check('gateway', 'gateway component', 'installed but unverified', `gateway bin drifted: selected lane ${lane} requires the ${descriptor.binName} bin resolving exactly to ${gatewayEntry.binPath}`));
        } else if (!regularFileOrNull(gatewayEntry.binPath)) {
          checks.push(check('gateway', 'gateway component', 'missing', `installed Gateway bin missing or not a regular file: ${gatewayEntry.binPath}; re-run the installer`));
        } else {
          const smoke = await runProcess(nodeExecutable, [gatewayEntry.binPath, '--help'], { env: ctx.pathEnv, timeoutMs: 10_000 });
          const missingDeps = smoke.stderr.includes('Cannot find module') || smoke.stderr.includes('MODULE_NOT_FOUND') || smoke.stderr.includes('ERR_MODULE_NOT_FOUND');
          if (smoke.exitCode === 0 && smoke.signal === null && !smoke.timedOut) {
            checks.push(check('gateway', 'gateway component', 'supported', `${gatewayEntry.binPath} — lane ${lane} identity verified (${descriptor.packageName}@${descriptor.version}, commit ${descriptor.commit}), bounded --help smoke passed`));
          } else if (missingDeps) {
            checks.push(check('gateway', 'gateway component', 'installed but unverified', `${gatewayEntry.binPath} — bin smoke cannot run: Gateway dependency materialization is pending release; re-run the installer`));
          } else {
            checks.push(check('gateway', 'gateway component', 'installed but unverified', `${gatewayEntry.binPath} — bounded --help smoke failed (exit ${smoke.exitCode ?? 'unknown'}${smoke.timedOut ? ', timed out' : ''})`));
          }
        }
      }
    }
  } else {
    // No receipt entry: descriptor-scoped disk observation only (never a
    // claim, never another lane's package directory).
    const descriptor = laneDescriptor.descriptor;
    const packageDir = join(layout.packagesDir, componentDirName(descriptor.packageName, descriptor.version));
    if (existsSync(packageDir)) {
      checks.push(check('gateway', 'gateway component', 'installed but unverified', `package present at ${packageDir} but not recorded in a valid installation receipt`));
    } else {
      checks.push(check('gateway', 'gateway component', 'missing', 'no Gateway component recorded in the installation receipt; run the installer'));
    }
  }

  // 7. pi-guard component (receipt + read-only Pi store inspection).
  if (receipt.ok && receipt.receipt.components.piGuard !== null) {
    const piGuardEntry = receipt.receipt.components.piGuard;
    if (piGuardEntry.status === 'failed') {
      checks.push(check('pi-guard', 'pi-guard component', 'missing', 'installation receipt records a failed pi-guard install; re-run the installer'));
    } else if (piGuardEntry.status === 'installed-unverified') {
      checks.push(check('pi-guard', 'pi-guard component', 'installed but unverified', `recorded as installed-unverified (verifiedBy ${piGuardEntry.verifiedBy}); re-run the installer`));
    } else {
      const identity = readPackageIdentity(piGuardEntry.installPath);
      if (identity === null || identity.name !== PI_GUARD_PACKAGE_NAME || identity.version !== piGuardEntry.version) {
        checks.push(check('pi-guard', 'pi-guard component', 'installed but unverified', `package identity at ${piGuardEntry.installPath} does not match the receipt record`));
      } else if (piPath === null) {
        checks.push(check('pi-guard', 'pi-guard component', 'installed but unverified', `pi executable not found; cannot confirm the exact pi-guard source in the Pi package store`));
      } else {
        const listRun = await runProcess(piPath, ['list'], { env: ctx.pathEnv, timeoutMs: 15_000 });
        const confirmed = listRun.exitCode === 0 && piListConfirmsSource(listRun.stdout, piGuardEntry.installPath);
        if (confirmed) {
          checks.push(check('pi-guard', 'pi-guard component', 'supported', `exact source confirmed in \`pi list\`: ${piGuardEntry.installPath}`));
        } else {
          checks.push(check('pi-guard', 'pi-guard component', 'installed but unverified', `exact source not confirmed in \`pi list\` (${piGuardEntry.installPath})`));
        }
      }
    }
  } else {
    checks.push(check('pi-guard', 'pi-guard component', 'missing', 'no pi-guard component recorded in the installation receipt (Pi-side enforcement absent)'));
  }

  // 8. Runtime configuration (exists / parses / closed model valid).
  const config = readRuntimeDocument(layout.runtimeConfigPath);
  if (!config.ok) {
    if (config.code === 'absent') {
      checks.push(check('runtime-config', 'runtime configuration', 'missing', `${layout.runtimeConfigPath} does not exist (no projects registered)`));
    } else {
      return { ok: false, exitCode: 1, message: `runtime configuration is invalid: ${config.message}` };
    }
  } else {
    const mode = modeOf(layout.runtimeConfigPath);
    const modeSafe = mode !== null && (mode & 0o077) === 0;
    const count = config.document.surfaces.length;
    checks.push(check('runtime-config', 'runtime configuration', modeSafe ? 'supported' : 'installed but unverified', `${modeNote(layout.runtimeConfigPath, 0o600)}; ${count} registered surface${count === 1 ? '' : 's'}`));
  }

  // 9. Registered projects (per surface: root resolution + store presence;
  //    read-only; registry membership ≠ operational health).
  if (config.ok) {
    config.document.surfaces.forEach((surface, index) => {
      const workspace = surface.workspaces?.[0];
      const label = workspace === undefined ? `registered project ${surface.surfaceId}` : `registered project ${workspace.workspaceId}`;
      if (workspace === undefined) {
        checks.push(check(`project-${index}`, label, 'installed but unverified', 'surface carries no workspace entry (foreign shape)'));
        return;
      }
      if (canonicalizePath(workspace.root) === null) {
        checks.push(check(`project-${index}`, label, 'missing', `project root does not resolve: ${workspace.root}`));
        return;
      }
      if (!existsSync(surface.locator)) {
        checks.push(check(`project-${index}`, label, 'missing', `trusted store parent missing at ${surface.locator}`));
        return;
      }
      if (!existsSync(join(surface.locator, 'store-v1'))) {
        checks.push(check(`project-${index}`, label, 'missing', `trusted store missing at ${join(surface.locator, 'store-v1')}; run \`pi-shuttle project add <path>\` to replay-verify`));
        return;
      }
      const locatorMode = modeOf(surface.locator);
      if (locatorMode === null || (locatorMode & 0o077) !== 0) {
        checks.push(check(`project-${index}`, label, 'installed but unverified', `root resolves; store present but the locator parent mode is unsafe (must be 0700): ${modeNote(surface.locator, 0o700)}`));
        return;
      }
      checks.push(check(`project-${index}`, label, 'supported', `root resolves; store present at ${surface.locator}`));
    });
  }

  // 10. Git isolation directories (per surface with a workspace; WP-7 conditions).
  if (config.ok) {
    config.document.surfaces.forEach((surface, index) => {
      const workspace = surface.workspaces?.[0];
      if (workspace === undefined) return;
      const roots = surface.workspaces!.map((w) => w.root);
      const label = `git isolation ${workspace.workspaceId}`;
      if (surface.gitHome === undefined || surface.gitTmpdir === undefined) {
        checks.push(check(`git-isolation-${index}`, label, 'installed but unverified', 'workspace surface without gitHome/gitTmpdir; the Gateway will refuse startup (WP-7 requires empty operator-owned isolation dirs)'));
        return;
      }
      const homeProblem = gitIsolationProblem(surface.gitHome, roots);
      const tmpProblem = gitIsolationProblem(surface.gitTmpdir, roots);
      if (homeProblem === null && tmpProblem === null) {
        checks.push(check(`git-isolation-${index}`, label, 'supported', `${surface.gitHome}; ${surface.gitTmpdir} — empty, operator-owned, outside workspace roots`));
      } else {
        checks.push(check(`git-isolation-${index}`, label, 'missing', [homeProblem, tmpProblem].filter((p): p is string => p !== null).join('; ')));
      }
    });
  }

  // 11. Coordination locks (PS-2/PS-3/PS-4): presence can block operation.
  //     Detected, never auto-deleted; recovery guidance reported.
  const lockCandidates = [
    `${layout.runtimeConfigPath}.lock`,
    join(layout.stateDir, 'install.lock'),
    projectLockPath(layout),
  ];
  const presentLocks = lockCandidates.filter((p) => existsSync(p));
  if (presentLocks.length === 0) {
    checks.push(check('locks', 'coordination locks', 'supported', 'no lock artifacts present'));
  } else {
    checks.push(check('locks', 'coordination locks', 'installed but unverified', `lock artifact(s) present: ${presentLocks.join(', ')} — a pi-shuttle operation may be running or the lock is stale; locks are never auto-stolen: verify no operation is running, then remove the stale file and re-run doctor`));
  }

  notes.push('trusted-store integrity verification is available only through the Gateway operator bootstrap replay (`pi-shuttle project add <path>`); doctor performs read-only local observation and never invokes bootstrap or mutates state');
  notes.push('ChatGPT/tunnel readiness is not locally observable (external platform state); onboarding is deferred (PS-7)');
  notes.push(`layout: ${layout.shareDir} (share) / ${layout.stateDir} (state) / ${layout.configDir} (config)`);

  // Exit classification (SIR-PS2-003): unsupported → 2 (precedence);
  // finding-class verdicts → 1; otherwise 0.
  const anyUnsupported = checks.some((c) => c.verdict === 'unsupported');
  const anyFinding = checks.some((c) => c.verdict === 'missing' || c.verdict === 'installed but unverified' || c.verdict === 'partial installation');
  const exitCode: 0 | 1 | 2 = anyUnsupported ? 2 : anyFinding ? 1 : 0;
  return { ok: true, exitCode, report: { checks, notes } };
}

/** Resolve the doctor context from a home directory (composition-root helper). */
export function doctorContext(env: HostEnvironment, pathEnv?: NodeJS.ProcessEnv): DoctorContext {
  return { env, layout: resolveLayout(env.home), pathEnv };
}
