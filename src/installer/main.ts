/**
 * PS-3 installer entry (local lane): `node dist/installer/main.js` via the
 * `install.sh` entrypoint. This is NOT the `pi-shuttle` operational CLI —
 * the closed public grammar (doctor / project / start / --help /
 * --version) is unchanged; the installer is a separate operator surface
 * with its own closed argument grammar.
 *
 * Exit codes (documented, closed): 0 COMPLETE or a successful no-change
 * lifecycle result; 1 PARTIAL (truthful opt-out/unverified stack); 2
 * FAILED / UNSUPPORTED / REFUSED / malformed invocation.
 */
import { realpathSync } from 'node:fs';
import { hostEnvironmentFromProcess, installerEnvironment } from '../host/environment.js';
import { hostLane, resolveLayout } from '../host/environment.js';
import { INSTALLER_USAGE, absolutePathProblem, approveBatchIncompleteCleanup, approveBatchUpgrade, parseInstallerArgs, promptIncompleteCleanup, promptInteractive, promptUpgrade } from './selection.js';
import { runInstall } from './install.js';
import type { InstallOutcome } from './install.js';
import { PI_SHUTTLE_VERSION } from '../compat/manifest.js';
import { readReceipt } from './receipt.js';
import { acquireLatestArtifacts } from './release/latest.js';

export const INSTALLER_EXIT = { COMPLETE: 0, PARTIAL: 1, FAILED: 2 } as const;

export const LATEST_HANDOFF_ENV = {
  source: 'PI_SHUTTLE_LATEST_SOURCE',
  packageTgz: 'PI_SHUTTLE_LATEST_PACKAGE_TGZ',
  artifactDir: 'PI_SHUTTLE_LATEST_ARTIFACT_DIR',
} as const;

export interface InstallerMainDependencies {
  readonly latestAcquirer?: typeof acquireLatestArtifacts;
  readonly installRunner?: typeof runInstall;
}

type LatestHandoff = {
  readonly sourceIdentity: string;
  readonly packageTgz: string;
  readonly artifactDir?: string;
};

function latestHandoffFromEnv(env: NodeJS.ProcessEnv): LatestHandoff | { readonly error: string } | null {
  const source = env[LATEST_HANDOFF_ENV.source];
  if (source === undefined || source.length === 0) return null;
  if (!/^mfx-labs\/pi-shuttle@[0-9a-f]{40}$/.test(source)) return { error: 'latest source identity is not a valid full commit identity' };
  const packageTgz = env[LATEST_HANDOFF_ENV.packageTgz];
  if (packageTgz === undefined || packageTgz.length === 0) return { error: 'latest installer handoff is missing its verified pi-shuttle package' };
  if (absolutePathProblem(packageTgz, 'latest package') !== null) return { error: 'latest installer handoff package path must be absolute' };
  const artifactDir = env[LATEST_HANDOFF_ENV.artifactDir];
  if (artifactDir !== undefined && absolutePathProblem(artifactDir, 'latest artifact directory') !== null) return { error: 'latest artifact directory path must be absolute' };
  return {
    sourceIdentity: source,
    packageTgz,
    ...(artifactDir !== undefined ? { artifactDir } : {}),
  };
}

export function formatOutcome(outcome: InstallOutcome): string {
  switch (outcome.kind) {
    case 'COMPLETE':
      return `result: COMPLETE — all selected components installed and verified${outcome.upgradedFrom !== undefined ? `; upgraded pi-shuttle ${outcome.upgradedFrom} → ${PI_SHUTTLE_VERSION}` : ''}`;
    case 'PARTIAL':
      return `result: PARTIAL INSTALLATION${outcome.upgradedFrom !== undefined ? ` — upgraded pi-shuttle ${outcome.upgradedFrom} → ${PI_SHUTTLE_VERSION}` : ''}${outcome.omitted.length > 0 ? ` — not installed: ${outcome.omitted.join(', ')}` : ''}${outcome.notes.length > 0 ? `\n  notes: ${outcome.notes.join('\n  notes: ')}` : ''}`;
    case 'ALREADY_INSTALLED':
      return `result: ALREADY INSTALLED — pi-shuttle ${outcome.version} is verified; no changes were needed`;
    case 'UPGRADE_AVAILABLE':
      return `result: UPGRADE AVAILABLE — verified pi-shuttle ${outcome.installedVersion} can be upgraded to ${outcome.installerVersion}; explicit confirmation is required`;
    case 'UPGRADE_DECLINED':
      return `result: UPGRADE DECLINED — pi-shuttle ${outcome.installedVersion} was preserved unchanged`;
    case 'INCOMPLETE_DECLINED':
      return 'result: INCOMPLETE CLEANUP DECLINED — No installation changes were made.';
    case 'FAILED':
      return `result: FAILED at stage "${outcome.stage}" — ${outcome.message}\nrollback: ${outcome.rollback}`;
    case 'UNSUPPORTED':
      return `result: UNSUPPORTED — ${outcome.reason}`;
    case 'REFUSED':
      return `result: REFUSED — ${outcome.reason}`;
  }
}

export function printPostInstallNextSteps(outcome: InstallOutcome): void {
  if (outcome.kind !== 'COMPLETE' && outcome.kind !== 'ALREADY_INSTALLED') return;
  process.stdout.write([
    '',
    'Next steps:',
    '',
    '  Configure a project:',
    '    pi-shuttle project add <path>',
    '',
    '  Check installation health:',
    '    pi-shuttle doctor',
    '',
    '  List registered projects:',
    '    pi-shuttle project list',
    '',
    '  Show available commands:',
    '    pi-shuttle --help',
    '',
  ].join('\n'));
}

export function exitCodeFor(outcome: InstallOutcome): number {
  switch (outcome.kind) {
    case 'COMPLETE':
    case 'ALREADY_INSTALLED':
    case 'UPGRADE_AVAILABLE':
    case 'UPGRADE_DECLINED':
    case 'INCOMPLETE_DECLINED':
      return INSTALLER_EXIT.COMPLETE;
    case 'PARTIAL':
      return INSTALLER_EXIT.PARTIAL;
    case 'FAILED':
    case 'UNSUPPORTED':
    case 'REFUSED':
      return INSTALLER_EXIT.FAILED;
  }
}

export async function main(argv: readonly string[], dependencies: InstallerMainDependencies = {}): Promise<number> {
  const parsed = parseInstallerArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`pi-shuttle-installer: ${parsed.message}`);
    return 2;
  }
  if (parsed.options.help) {
    process.stdout.write(INSTALLER_USAGE);
    return 0;
  }

  const latest = latestHandoffFromEnv(installerEnvironment());
  if (latest !== null && 'error' in latest) {
    process.stderr.write(`pi-shuttle-installer: ${latest.error}\n`);
    return 2;
  }
  if (latest !== null && (parsed.options.artifactDir !== undefined || parsed.options.expectGatewaySha256 !== undefined || parsed.options.expectPiGuardSha256 !== undefined)) {
    process.stderr.write('pi-shuttle-installer: latest bootstrap owns artifact acquisition and digest verification; local artifact options are refused\n');
    return 2;
  }

  const env = hostEnvironmentFromProcess();
  if (!env.ok) {
    process.stderr.write(`pi-shuttle-installer: ${env.message}\n`);
    return 2;
  }
  const home = env.environment.home;
  const layout = resolveLayout(home);
  const prior = readReceipt(layout.installReceiptPath);

  if (latest !== null) {
    process.stdout.write(`pi-shuttle latest installer\nversion: ${PI_SHUTTLE_VERSION}\nsource: ${latest.sourceIdentity}\nchannel: latest\n`);
  } else {
    process.stdout.write(`pi-shuttle installer ${PI_SHUTTLE_VERSION} (pre-release, local lane)\n`);
  }

  let selections = parsed.options.selections;
  let installDir = parsed.options.installDir;
  let binDir = parsed.options.binDir;
  const interactiveMode = selections === undefined;
  if (selections === undefined) {
    if (latest !== null && process.stdin.isTTY !== true) {
      process.stderr.write('pi-shuttle-installer: interactive Latest installation requires a controlling terminal; use curl | bash from a terminal or pass the complete existing batch arguments\n');
      return 2;
    }
    const interactive = await promptInteractive({
      installDir: parsed.options.installDir ?? (prior.ok ? prior.receipt.installDir : layout.shareDir),
      binDir: parsed.options.binDir ?? (prior.ok ? prior.receipt.binDir : layout.binDir),
    });
    selections = interactive.selections;
    installDir = interactive.installDir;
    binDir = interactive.binDir;
  }

  let latestArtifactDir: string | undefined;
  let latestGatewaySha256: string | undefined;
  let latestPiGuardSha256: string | undefined;
  if (latest !== null) {
    if (latest.artifactDir === undefined) {
      const outcome: InstallOutcome = { kind: 'REFUSED', reason: 'latest installer handoff is missing its private artifact staging directory' };
      process.stdout.write(`${formatOutcome(outcome)}\nreceipt: ${layout.installReceiptPath}\nno installation changes were finalized; prior installation state (if any) is preserved\n`);
      return INSTALLER_EXIT.FAILED;
    }
    const acquired = await (dependencies.latestAcquirer ?? acquireLatestArtifacts)(hostLane(env.environment.platform, env.environment.arch), selections, latest.artifactDir);
    if (!acquired.ok) {
      const outcome: InstallOutcome = { kind: 'REFUSED', reason: acquired.message };
      process.stdout.write(`${formatOutcome(outcome)}\nreceipt: ${layout.installReceiptPath}\nno installation changes were finalized; prior installation state (if any) is preserved\n`);
      return INSTALLER_EXIT.FAILED;
    }
    latestArtifactDir = acquired.artifactDir;
    latestGatewaySha256 = acquired.gatewaySha256;
    latestPiGuardSha256 = acquired.piGuardSha256;
  }

  const outcome = await (dependencies.installRunner ?? runInstall)(env.environment, {
    selections,
    ...(installDir !== undefined ? { installDir } : {}),
    ...(binDir !== undefined ? { binDir } : {}),
    ...(parsed.options.artifactDir !== undefined ? { artifactDir: parsed.options.artifactDir } : {}),
    ...(parsed.options.expectGatewaySha256 !== undefined ? { expectGatewaySha256: parsed.options.expectGatewaySha256 } : {}),
    ...(parsed.options.expectPiGuardSha256 !== undefined ? { expectPiGuardSha256: parsed.options.expectPiGuardSha256 } : {}),
    ...(latest !== null ? {
      releasePackageTgz: latest.packageTgz,
      sourceIdentity: latest.sourceIdentity,
      ...(latestArtifactDir !== undefined ? { artifactDir: latestArtifactDir } : {}),
      ...(latestGatewaySha256 !== undefined ? { expectGatewaySha256: latestGatewaySha256 } : {}),
      ...(latestPiGuardSha256 !== undefined ? { expectPiGuardSha256: latestPiGuardSha256 } : {}),
    } : {}),
    confirmUpgrade: interactiveMode ? promptUpgrade : approveBatchUpgrade,
    confirmIncompleteCleanup: interactiveMode ? promptIncompleteCleanup : approveBatchIncompleteCleanup,
  });

  process.stdout.write(`${formatOutcome(outcome)}\n`);
  process.stdout.write(`receipt: ${layout.installReceiptPath}\n`);
  if (outcome.kind === 'PARTIAL' || outcome.kind === 'COMPLETE') {
    process.stdout.write(`platform lane: ${hostLane(env.environment.platform, env.environment.arch)}\n`);
  }
  printPostInstallNextSteps(outcome);
  if (outcome.kind === 'FAILED' || outcome.kind === 'UNSUPPORTED' || outcome.kind === 'REFUSED') {
    process.stdout.write('no final installation receipt was written; unrelated operator state was preserved\n');
  }
  return exitCodeFor(outcome);
}

// Direct execution entry (install.sh execs this module): run the installer
// only when executed, never when imported by tests. The argv path is
// compared through realpath: on macOS /tmp is a symlink to /private/tmp,
// and argv keeps the raw path while import.meta.url is canonical — a raw
// comparison would silently skip the entry for symlinked invocations.
if (process.argv[1] !== undefined) {
  const { pathToFileURL } = await import('node:url');
  let entryPath: string | null = null;
  try {
    entryPath = realpathSync(process.argv[1]);
  } catch {
    entryPath = null;
  }
  if (entryPath !== null && import.meta.url === pathToFileURL(entryPath).href) {
    process.exitCode = await main(process.argv.slice(2));
  }
}
