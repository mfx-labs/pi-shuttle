/**
 * PS-4 — `pi-shuttle start` (operator-cli-contract §6, gate §15–§16):
 * NEW-STATE manifest-native runtime composition.
 *
 * The manifest-native lifecycle is the ONLY installation authority start
 * consumes. Before ANY child is spawned, start requires:
 *
 *   1. valid Receipt Schema 1 (bounded read);
 *   2. exact signed selection-chain cache verification;
 *   3. installed-evidence cryptographic verification (compiled root/
 *      keyring/channel/release signatures, digest + releaseId binding);
 *   4. exact receipt/cache/release reconciliation;
 *   5. current host lane == receipt selectedLane (compiled supported lane);
 *   6. stable install/runtime protocol compatibility (compiled policy);
 *   7. canonical packageRoot (derived content-address path);
 *   8. canonical binPath derived from the signed package/bin declaration;
 *   9. complete package-tree SHA-256 verification (full hash immediately
 *      before spawn — packageTreeSha256 is the authenticated runtime
 *      integrity unit; no mtime/shortcut/doctor-cache shortcuts);
 *  10. owner/private/type/no-follow checks on the authority namespace and
 *      the installed tree;
 *  11. the exact bin re-validated immediately before spawn (regular,
 *      owner-private, no symlink, confined to the package root).
 *
 * CLEAN lifecycle: start fails with a typed no-manifest-native-
 * installation condition; it never infers or discovers a Gateway
 * elsewhere and never inspects previous-generation state.
 * MALFORMED lifecycle: start refuses launch; no fallback, no cleanup, no
 * network request, no mutation.
 *
 * Launch: the RUNNING Node executable + the canonical verified binPath +
 * the fixed `--config <runtime>` argv composition (spawnGatewayForStart),
 * stdio inherited (stdout stays MCP protocol end to end), child exit
 * status/signals propagate truthfully (signal as 128+N). Never executes a
 * caller-provided executable; never bootstraps; never repairs.
 *
 * Installed-runtime time semantics: cached keyring/channel expiration is
 * NOT a liveness gate for an otherwise valid installed release.
 */
import { join } from 'node:path';
import { constants as constantsSignals } from 'node:os';
import type { CommandOutcome } from '../app.js';
import { readRuntimeDocument } from '../config/document.js';
import { hostLane, resolveManifestNativeLayout } from '../host/environment.js';
import type { ManifestNativeLayout } from '../host/environment.js';
import { checkNodeLane, checkPlatformLane } from '../installer/preflight.js';
import { resolveManifestNativeLifecycle, validateFinalBin } from '../manifest-native/resolve.js';
import type { ManifestNativeResolution } from '../manifest-native/resolve.js';
import { spawnGatewayForStart } from '../process/runner.js';
import { pathExists } from './state.js';
import type { OperatorContext } from './state.js';

export interface StartContext extends OperatorContext {
  /**
   * Forward SIGINT/SIGTERM/SIGHUP to the Gateway child (real CLI path).
   * Direct tests run without signal forwarding so the test runner process
   * is unaffected.
   */
  readonly forwardSignals?: boolean;
  /**
   * Manifest-native lifecycle resolution (test seam only; defaults to the
   * production boundary). Fixture-verified namespaces require the paired
   * fixture provenance gate; production callers never pass this.
   */
  readonly resolveManifestNative?: (layout: ManifestNativeLayout, lane: string) => Promise<ManifestNativeResolution>;
}

function fail(code: string, detail: string, exitCode: 1 | 2): CommandOutcome {
  return { exitCode, stdout: '', stderr: `pi-shuttle: ${detail} (${code})\n` };
}

/** Run `pi-shuttle start`. Resolves only after the Gateway child exits. */
export async function runStartCommand(ctx: StartContext): Promise<CommandOutcome> {
  // 1. Platform gate (fail closed; exit 2 — platform-support-contract §5).
  const platform = checkPlatformLane(ctx.env);
  if (!platform.ok) return fail('ERR-PS4-PREFLIGHT-PLATFORM', `start: ${platform.message}`, 2);

  // 2. Node lane (the interpreter that will launch the Gateway).
  const node = checkNodeLane();
  if (!node.ok) return fail('ERR-PS4-PREFLIGHT-NODE', `start: ${node.message}`, 1);

  // 3. Manifest-native lifecycle resolution (the ONLY installation
  //    authority; production defaults to the compiled trust boundary).
  const mnLayout = resolveManifestNativeLayout(ctx.env.home);
  const lane = hostLane(ctx.env.platform, ctx.env.arch);
  const resolve = ctx.resolveManifestNative ?? ((layout: ManifestNativeLayout, hostLaneName: string) => resolveManifestNativeLifecycle(layout, hostLaneName));
  const resolution = await resolve(mnLayout, lane);
  if (resolution.kind === 'CLEAN') {
    return fail('ERR-MN-START-NO-INSTALLATION', 'start: no manifest-native installation (clean manifest-native lifecycle); run the fresh installer when available', 1);
  }
  if (resolution.kind === 'MALFORMED') {
    return fail('ERR-MN-START-STATE-MALFORMED', `start: manifest-native state is malformed and cannot launch; no repair or fallback is performed: ${resolution.reason}`, 1);
  }
  const installation = resolution.installation;

  // 4. Active runtime configuration: absent/empty fails closed with the
  //    contract's recovery guidance; malformed/foreign fails closed.
  const read = readRuntimeDocument(ctx.layout.runtimeConfigPath);
  if (!read.ok) {
    if (read.code === 'absent') {
      return fail('ERR-PS4-START-NO-CONFIG', 'start: no registered projects — run `pi-shuttle project add <path>`', 1);
    }
    return fail('ERR-PS4-START-CONFIG-INVALID', `start: runtime configuration is invalid: ${read.message}`, 1);
  }
  if (read.document.surfaces.length === 0) {
    return fail('ERR-PS4-START-NO-SURFACES', 'start: no registered projects — run `pi-shuttle project add <path>`', 1);
  }

  // 5. Locally observable store pre-check (read-only): each registered
  //    surface must have its trusted store locally present
  //    (`<locator>/store-v1`). Local presence observation only — the
  //    Gateway remains the authority for deep store verification. Never
  //    creates, repairs, or inspects Gateway private metadata.
  for (const surface of read.document.surfaces) {
    if (!pathExists(surface.locator)) {
      return fail('ERR-PS4-START-STORE-MISSING', `start: trusted store parent missing at ${surface.locator}; run \`pi-shuttle project add <path>\` to replay-verify and register`, 1);
    }
    if (!pathExists(join(surface.locator, 'store-v1'))) {
      return fail('ERR-PS4-START-STORE-V1-MISSING', `start: trusted store locally absent at ${join(surface.locator, 'store-v1')} (local presence observation only, not a trusted-verification claim); run \`pi-shuttle project add <path>\` to replay-verify and register, or \`pi-shuttle doctor\` for the full picture`, 1);
    }
  }

  // 6. Final bin validation immediately before spawn (TOCTOU boundary):
  //    the complete tree was already hashed by resolution; re-validate
  //    the exact final bin — canonical confined path, regular file, owner
  //    == effective UID, owner-private mode, no symlink/special.
  const uid = ctx.uid ?? process.getuid?.() ?? -1;
  const bin = validateFinalBin(installation, uid);
  if (!bin.ok) {
    return fail(bin.code, `start: ${bin.message}`, 1);
  }

  // 7. Compose the Gateway process: inherited stdio (stdout = MCP
  //    protocol), exact verified installed CLI + `--config <runtime>`
  //    argv, launched by the RUNNING Node executable. No bootstrap, no
  //    mutation, no wrapper state.
  const child = spawnGatewayForStart(ctx.nodeExecutable, bin.binPath, ctx.layout.runtimeConfigPath, ctx.pathEnv);

  // 7b. Signal forwarding (real CLI path, SIR-PS4-003): lifecycle-local
  //     listeners that are removed once the child reaches its terminal
  //     state (ordinary exit, signal exit, or spawn failure), so repeated
  //     start invocations in one process cannot accumulate listeners.
  //     Only listeners installed by THIS invocation are removed (no
  //     removeAllListeners); unrelated process listeners are untouched.
  const forwarders: Array<{ readonly signal: string; readonly listener: () => void }> = [];
  if (ctx.forwardSignals === true) {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      const listener = (): void => {
        try {
          child.kill(signal);
        } catch {
          // the child is already gone; the close handler drives exit
        }
      };
      process.on(signal, listener);
      forwarders.push({ signal, listener });
    }
  }

  // 8. Propagate the Gateway exit status truthfully (code as-is; signal
  //    as 128 + signal number, the conventional shell convention).
  const exitCode = await new Promise<number>((resolveExit) => {
    child.on('error', () => resolveExit(1));
    child.on('close', (code, signal) => {
      if (signal !== null) resolveExit(128 + (constantsSignals.signals[signal] ?? 0));
      else resolveExit(code ?? 1);
    });
  });

  // 8b. Terminal state reached: remove exactly the listeners installed by
  //     this start invocation (SIR-PS4-003).
  for (const { signal, listener } of forwarders) {
    process.removeListener(signal, listener);
  }
  // stdout stays empty: the Gateway owns the protocol stream from here.
  return { exitCode, stdout: '', stderr: '' };
}
