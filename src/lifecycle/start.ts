/**
 * PS-4 — `pi-shuttle start` (operator-cli-contract §6, gate §15–§16):
 * runtime execution composition ONLY.
 *
 * Validates the installation receipt, validates the active runtime
 * configuration, requires at least one registered surface, resolves the
 * exact installed Gateway executable (receipt-pinned bin), and composes
 * the Gateway process with stdio INHERITED: stdout stays MCP protocol end
 * to end (no banners, no pi-shuttle text after the child starts; all
 * pre-start diagnostics go to stderr), and the Gateway process exit
 * status/signals propagate truthfully (code as-is; signal as 128+N, the
 * conventional shell mapping).
 *
 * NEVER bootstraps, never auto-repairs, never mutates registration, never
 * downloads/installs, never creates lifecycle authority. The Gateway
 * remains the authority for its own startup validation; pi-shuttle
 * pre-checks only the locally observable facts that give the operator
 * actionable guidance (store parent presence), then hands over.
 */
import { statSync } from 'node:fs';
import { constants } from 'node:os';
import { join } from 'node:path';
import type { CommandOutcome } from '../app.js';
import { readRuntimeDocument } from '../config/document.js';
import { checkNodeLane, checkPlatformLane } from '../installer/preflight.js';
import { spawnGatewayForStart } from '../process/runner.js';
import { pathExists, resolveGatewayInstallation } from './state.js';
import type { OperatorContext } from './state.js';

export interface StartContext extends OperatorContext {
  /**
   * Forward SIGINT/SIGTERM/SIGHUP to the Gateway child (real CLI path).
   * Direct tests run without signal forwarding so the test runner process
   * is unaffected.
   */
  readonly forwardSignals?: boolean;
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

  // 3. Installation receipt gate: a usable, verified Gateway is required.
  const gateway = resolveGatewayInstallation(ctx.layout);
  if (!gateway.ok) return fail(gateway.code, `start: ${gateway.message}`, gateway.exitCode);

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
  //    (`<locator>/store-v1` — the same local observation semantics doctor
  //    uses). This is `store-v1 locally present`, NOT `trusted store
  //    verified`: the Gateway remains the authority for deep store
  //    verification at startup. Never creates, repairs, or inspects
  //    Gateway private metadata.
  for (const surface of read.document.surfaces) {
    if (!pathExists(surface.locator)) {
      return fail('ERR-PS4-START-STORE-MISSING', `start: trusted store parent missing at ${surface.locator}; run \`pi-shuttle project add <path>\` to replay-verify and register`, 1);
    }
    if (!pathExists(join(surface.locator, 'store-v1'))) {
      return fail('ERR-PS4-START-STORE-V1-MISSING', `start: trusted store locally absent at ${join(surface.locator, 'store-v1')} (local presence observation only, not a trusted-verification claim); run \`pi-shuttle project add <path>\` to replay-verify and register, or \`pi-shuttle doctor\` for the full picture`, 1);
    }
  }

  // 6. Resolve the exact installed Gateway executable (receipt-pinned bin;
  //    re-verified as a regular file before execution).
  const binPath = gateway.value.binPath;
  if (!isRegularFile(binPath)) {
    return fail('ERR-PS4-START-GATEWAY-BIN', `start: the installed Gateway executable is missing or not a regular file: ${binPath}; re-run the installer`, 1);
  }

  // 7. Compose the Gateway process: inherited stdio (stdout = MCP protocol),
  //    exact installed CLI + `--config <runtime>` argv. No bootstrap, no
  //    mutation, no wrapper state.
  const child = spawnGatewayForStart(ctx.nodeExecutable, binPath, ctx.layout.runtimeConfigPath, ctx.pathEnv);

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
  const exitCode = await new Promise<number>((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', (code, signal) => {
      if (signal !== null) resolve(128 + (constants.signals[signal] ?? 0));
      else resolve(code ?? 1);
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

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
