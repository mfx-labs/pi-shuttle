/**
 * PS-8A release installer entry (official release lane):
 * `node dist/installer/release/bootstrap.js [installer args...]`.
 *
 * Executed by the version-pinned release `install.sh` AFTER the shell
 * bootstrap verified (against digests embedded in install.sh) the
 * release envelope and the pi-shuttle package itself. This entry:
 *
 *   1. resolves the component selections (batch args or the same
 *      interactive prompts as the local lane);
 *   2. validates the envelope against the closed schema and the exact
 *      compiled-in source pins (version/commit/tag/policy equality);
 *   3. cross-checks the pi-shuttle package digest against the envelope;
 *   4. downloads + digest-verifies ONLY the selected component artifacts
 *      (gateway, pi-guard) into an owner-controlled staging directory;
 *   5. hands the staged artifacts and the envelope digests to the SAME
 *      install core as the local lane (`runInstall`) — digest
 *      re-verification, structural archive scan, identity verification,
 *      activation, and receipt-last semantics are unchanged.
 *
 * Any failure before step 5 refuses with nothing activated; the
 * existing core's own fail-closed behavior covers everything after.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PI_SHUTTLE_VERSION } from '../../compat/manifest.js';
import type { HostEnvironment } from '../../host/environment.js';
import { hostEnvironmentFromProcess, hostLane, resolveLayout } from '../../host/environment.js';
import { hashFile } from '../artifact.js';
import { runInstall } from '../install.js';
import type { InstallOptions, InstallOutcome } from '../install.js';
import { INSTALLER_EXIT, exitCodeFor, formatOutcome } from '../main.js';
import { INSTALLER_USAGE, PROJECT_ONBOARDING_DEFERRED, absolutePathProblem, approveBatchUpgrade, parseInstallerArgs, promptInteractive, promptUpgrade } from '../selection.js';
import type { InteractiveResult } from '../selection.js';
import { readReceipt } from '../receipt.js';
import { acquireVerifiedFile, releaseBaseUrlFor } from './acquire.js';
import type { ReleaseFetcher } from './acquire.js';
import { parseEnvelope } from './envelope.js';
import type { ReleaseEnvelopeV1 } from './envelope.js';

/**
 * Shell→Node handoff (set by the release install.sh; the shell has
 * already verified both files against digests embedded in install.sh).
 */
export const RELEASE_HANDOFF_ENV = {
  envelope: 'PI_SHUTTLE_RELEASE_ENVELOPE',
  piShuttleTgz: 'PI_SHUTTLE_PI_SHUTTLE_TGZ',
  tmp: 'PI_SHUTTLE_RELEASE_TMP',
  /** Operator QA/test override for the release base URL (still HTTPS-only). */
  baseUrl: 'PI_SHUTTLE_BASE_URL',
} as const;

export interface ReleaseBootstrapHandoff {
  readonly envelopePath: string;
  readonly piShuttleTgzPath: string;
  /** Owner-controlled temp dir the shell created (cleanup is the shell's). */
  readonly tmpDir?: string;
  readonly baseUrlOverride?: string;
}

export type ReleaseBootstrapResult =
  | { readonly kind: 'outcome'; readonly outcome: InstallOutcome; readonly envelope: ReleaseEnvelopeV1 }
  | { readonly kind: 'help' }
  | { readonly kind: 'refused'; readonly code: string; readonly message: string };

export interface ReleaseBootstrapOptions {
  /** Injectable fetcher (unit tests only). */
  readonly fetcher?: ReleaseFetcher;
  /** Injectable UID observation (root refusal; test seam, same as install). */
  readonly uid?: number;
  /** Injectable install runner (unit tests only; production = runInstall). */
  readonly installRunner?: (env: HostEnvironment, options: Parameters<typeof runInstall>[1]) => Promise<InstallOutcome>;
  /** Injectable interactive prompt session (unit tests only). */
  readonly promptUI?: (defaults: { readonly installDir: string; readonly binDir: string }) => Promise<InteractiveResult>;
  /** Injectable upgrade consent (tests); production prompts or accepts explicit batch invocation. */
  readonly confirmUpgrade?: InstallOptions['confirmUpgrade'];
  /**
   * Injectable stdin-TTY observation (F-01 test seam; production reads
   * `process.stdin.isTTY`). When interactive prompts are needed and stdin
   * is not a terminal, the release entry REFUSES instead of silently
   * converting EOF into affirmative answers.
   */
  readonly stdinIsTTY?: boolean;
}

/** Read the shell handoff from the environment. */
export function handoffFromEnv(env: NodeJS.ProcessEnv): ReleaseBootstrapHandoff | { readonly error: string } {
  const envelopePath = env[RELEASE_HANDOFF_ENV.envelope];
  const piShuttleTgzPath = env[RELEASE_HANDOFF_ENV.piShuttleTgz];
  if (envelopePath === undefined || envelopePath.length === 0) {
    return { error: 'release handoff incomplete: PI_SHUTTLE_RELEASE_ENVELOPE is not set (run via the official release install.sh)' };
  }
  if (piShuttleTgzPath === undefined || piShuttleTgzPath.length === 0) {
    return { error: 'release handoff incomplete: PI_SHUTTLE_PI_SHUTTLE_TGZ is not set (run via the official release install.sh)' };
  }
  const tmpDir = env[RELEASE_HANDOFF_ENV.tmp];
  const baseUrlOverride = env[RELEASE_HANDOFF_ENV.baseUrl];
  return {
    envelopePath,
    piShuttleTgzPath,
    ...(tmpDir !== undefined && tmpDir.length > 0 ? { tmpDir } : {}),
    ...(baseUrlOverride !== undefined && baseUrlOverride.length > 0 ? { baseUrlOverride } : {}),
  };
}

function refuse(code: string, message: string): ReleaseBootstrapResult {
  return { kind: 'refused', code, message };
}

/**
 * The release install flow (pure orchestration; all I/O installer-owned).
 * Exported for focused tests with injected fetcher/runner/prompts.
 */
export async function runReleaseBootstrap(env: HostEnvironment, handoff: ReleaseBootstrapHandoff, args: readonly string[], options: ReleaseBootstrapOptions = {}): Promise<ReleaseBootstrapResult> {
  const homeProblem = absolutePathProblem(env.home, 'HOME');
  if (homeProblem !== null) return refuse('ERR-REL-HOME', homeProblem);

  const parsed = parseInstallerArgs(args);
  if (!parsed.ok) {
    return refuse('ERR-REL-ARGS', `pi-shuttle-installer: ${parsed.message}`);
  }
  if (parsed.options.help) {
    return { kind: 'help' };
  }
  // F-05: local-artifact-lane options are refused in release mode — release
  // acquisition and digest expectations are owned internally. Never
  // silently ignore them.
  if (parsed.options.artifactDir !== undefined || parsed.options.expectGatewaySha256 !== undefined || parsed.options.expectPiGuardSha256 !== undefined) {
    return refuse('ERR-REL-ARGS', 'pi-shuttle-installer: --artifact-dir and --expect-*-sha256 are local-artifact-lane options and are refused by the official release installer (artifact acquisition and digest verification are managed internally)');
  }

  // Selections: batch/explicit args, or the same interactive prompts as
  // the local lane (prompts run before any download).
  const layout = resolveLayout(env.home);
  const prior = readReceipt(layout.installReceiptPath);
  let selections = parsed.options.selections;
  let installDir = parsed.options.installDir;
  let binDir = parsed.options.binDir;
  let configureProject = false;
  const interactiveMode = selections === undefined;
  if (selections === undefined) {
    // F-01: never interpret EOF on stdin as affirmative interactive
    // answers. Interactive prompting requires a terminal; when none is
    // available the release entry fails closed with guidance (the shell
    // bootstrap binds stdin to /dev/tty when a controlling terminal
    // exists, so production piped installs prompt on the real terminal).
    const tty = options.stdinIsTTY ?? process.stdin.isTTY === true;
    if (options.promptUI === undefined && !tty) {
      return refuse('ERR-REL-INTERACTIVE-TTY', 'interactive selections require a terminal; piped or non-interactive installs must pass explicit selections, e.g. --batch --gateway yes --pi-guard no');
    }
    const prompt = options.promptUI ?? promptInteractive;
    const interactive = await prompt({
      installDir: parsed.options.installDir ?? (prior.ok ? prior.receipt.installDir : layout.shareDir),
      binDir: parsed.options.binDir ?? (prior.ok ? prior.receipt.binDir : layout.binDir),
    });
    selections = interactive.selections;
    installDir = interactive.installDir;
    binDir = interactive.binDir;
    configureProject = interactive.configureProject;
  }

  if (!existsSync(handoff.envelopePath)) {
    return refuse('ERR-REL-ENVELOPE-UNAVAILABLE', `release envelope not found at ${handoff.envelopePath}`);
  }
  let envelopeText: string;
  try {
    envelopeText = readFileSync(handoff.envelopePath, 'utf8');
  } catch (err) {
    return refuse('ERR-REL-ENVELOPE-UNAVAILABLE', `release envelope could not be read (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
  }
  const envelopeResult = parseEnvelope(envelopeText, hostLane(env.platform, env.arch));
  if (!envelopeResult.ok) {
    return refuse(envelopeResult.code, envelopeResult.message);
  }
  const envelope = envelopeResult.value;

  // Cross-check: the pi-shuttle package the shell verified must be the
  // exact package this envelope was released with.
  if (!existsSync(handoff.piShuttleTgzPath)) {
    return refuse('ERR-REL-PACKAGE-UNAVAILABLE', `pi-shuttle release package not found at ${handoff.piShuttleTgzPath}`);
  }
  let packageSha256: string;
  try {
    packageSha256 = await hashFile(handoff.piShuttleTgzPath);
  } catch (err) {
    return refuse('ERR-REL-PACKAGE-UNAVAILABLE', `pi-shuttle release package could not be read (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`);
  }
  if (packageSha256 !== envelope.piShuttle.sha256) {
    return refuse('ERR-REL-ENVELOPE-MISMATCH', `pi-shuttle release package digest does not match the release envelope (package ${packageSha256}, envelope ${envelope.piShuttle.sha256})`);
  }

  // Release base URL: code-constant prefix + validated version, or an
  // explicit operator QA override. Either way: HTTPS only, never from
  // untrusted content.
  const baseUrl = handoff.baseUrlOverride ?? releaseBaseUrlFor(envelope.releaseVersion);
  let baseUrlParsed: URL;
  try {
    baseUrlParsed = new URL(baseUrl);
  } catch {
    return refuse('ERR-REL-ACQUIRE-URL', `release base URL is malformed: ${baseUrl}`);
  }
  if (baseUrlParsed.protocol !== 'https:') {
    return refuse('ERR-REL-ACQUIRE-PROTOCOL', `release acquisition requires HTTPS (refused: ${baseUrlParsed.protocol}//${baseUrlParsed.host})`);
  }

  const needsArtifacts = selections.gateway || selections.piGuard;
  const fetcher = options.fetcher;
  const stageParent = handoff.tmpDir !== undefined && handoff.tmpDir.length > 0 ? handoff.tmpDir : mkdtempSync(join(tmpdir(), 'pi-shuttle-release.XXXXXX'));
  const selfCreatedTmp = handoff.tmpDir === undefined || handoff.tmpDir.length === 0;
  const stageDir = join(stageParent, 'artifacts');
  try {
    if (needsArtifacts) {
      mkdirSync(stageDir, { recursive: true, mode: 0o700 });
      // Acquire ONLY the selected components; every artifact is digest-
      // verified before it is handed to the install core.
      if (selections.gateway) {
        const gateway = await acquireVerifiedFile(baseUrl, envelope.gateway.fileName, envelope.gateway.sha256, stageDir, fetcher);
        if (!gateway.ok) return refuse(gateway.code, gateway.message);
      }
      if (selections.piGuard) {
        const piGuard = await acquireVerifiedFile(baseUrl, envelope.piGuard.fileName, envelope.piGuard.sha256, stageDir, fetcher);
        if (!piGuard.ok) return refuse(piGuard.code, piGuard.message);
      }
    }

    if (configureProject) {
      process.stdout.write(`${PROJECT_ONBOARDING_DEFERRED}\n`);
    }

    const runner = options.installRunner ?? ((envArg, installOptions) => runInstall(envArg, installOptions));
    const outcome = await runner(env, {
      selections,
      ...(installDir !== undefined ? { installDir } : {}),
      ...(binDir !== undefined ? { binDir } : {}),
      ...(needsArtifacts ? { artifactDir: stageDir } : {}),
      // PS-8A: the core activates the verified pi-shuttle package itself
      // so the bin link points at persistent packages storage (the
      // release installer runs from an ephemeral extraction).
      releasePackageTgz: handoff.piShuttleTgzPath,
      ...(selections.gateway ? { expectGatewaySha256: envelope.gateway.sha256 } : {}),
      ...(selections.piGuard ? { expectPiGuardSha256: envelope.piGuard.sha256 } : {}),
      ...(options.uid !== undefined ? { uid: options.uid } : {}),
      confirmUpgrade: options.confirmUpgrade ?? (interactiveMode ? promptUpgrade : approveBatchUpgrade),
    });
    return { kind: 'outcome', outcome, envelope };
  } finally {
    try {
      rmSync(stageDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    if (selfCreatedTmp) {
      try {
        rmSync(stageParent, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
}

/** Direct-execution entry (the release install.sh execs this module). */
export async function main(argv: readonly string[]): Promise<number> {
  const handoff = handoffFromEnv(process.env);
  if ('error' in handoff) {
    process.stderr.write(`pi-shuttle-installer: ${handoff.error}\n`);
    return 2;
  }
  const env = hostEnvironmentFromProcess();
  if (!env.ok) {
    process.stderr.write(`pi-shuttle-installer: ${env.message}\n`);
    return 2;
  }
  const result = await runReleaseBootstrap(env.environment, handoff, argv);
  if (result.kind === 'help') {
    process.stdout.write(INSTALLER_USAGE);
    return 0;
  }
  if (result.kind === 'refused') {
    process.stderr.write(`pi-shuttle-installer: ${result.message} (${result.code})\n`);
    process.stderr.write('no installation changes were made; prior installation state (if any) is preserved\n');
    return INSTALLER_EXIT.FAILED;
  }
  process.stdout.write(`pi-shuttle installer ${PI_SHUTTLE_VERSION} (official release lane)\n`);
  process.stdout.write(`${formatOutcome(result.outcome)}\n`);
  process.stdout.write(`receipt: ${resolveLayout(env.environment.home).installReceiptPath}\n`);
  if (result.outcome.kind === 'PARTIAL' || result.outcome.kind === 'COMPLETE') {
    process.stdout.write(`platform lane: ${hostLane(env.environment.platform, env.environment.arch)}\n`);
  }
  if (result.outcome.kind === 'FAILED' || result.outcome.kind === 'UNSUPPORTED' || result.outcome.kind === 'REFUSED') {
    process.stdout.write('no installation changes were finalized; prior installation state (if any) is preserved\n');
  }
  return exitCodeFor(result.outcome);
}

if (process.argv[1] !== undefined) {
  const { pathToFileURL } = await import('node:url');
  // realpath comparison: argv keeps the raw path while import.meta.url is
  // canonical — a raw comparison silently no-ops under symlinked TMPDIRs
  // (macOS /tmp → /private/tmp), which would make release installs exit 0
  // without doing anything.
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
