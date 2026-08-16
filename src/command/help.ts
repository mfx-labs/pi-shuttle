/**
 * Deterministic help/version text (PS-2). Works with zero initialized
 * product state (help/version never touch the filesystem or config).
 */
import { PI_COMPATIBILITY_BASELINE, PI_GUARD_COMMIT, PI_GUARD_VERSION, PI_SHUTTLE_VERSION, gatewayDescriptorForLane } from '../compat/manifest.js';
import type { HostEnvironment } from '../host/environment.js';
import { hostLane } from '../host/environment.js';

/** Closed help text: the exact public grammar and the closed exit-code model. */
export function helpText(): string {
  return [
    'pi-shuttle — operator CLI for the Project Gateway MCP + pi-guard composed product',
    '',
    'usage: pi-shuttle <command> [operands]',
    '',
    'commands:',
    '  doctor                              verify installation state (full local probe suite)',
    '  project add <path>                  register a project (canonicalizes the root, runs the',
    '                                        Gateway operator bootstrap, persists the resolved',
    '                                        runtime configuration)',
    '  project list                        list registered projects',
    '  project remove <path-or-workspace-id>  deregister a project; the trusted store is',
    '                                        preserved (deregister only, never deletes)',
    '  start                               start the Gateway stdio MCP runtime (stdio inherited;',
    '                                        stdout stays MCP protocol)',
    '  --help                              show this help',
    '  --version                           print version and pinned component versions',
    '',
    'exit codes: 0 success; 1 operational failure (findings, missing state);',
    '            2 malformed invocation or unsupported platform/architecture (`doctor`, `start`)',
  ].join('\n') + '\n';
}

/**
 * Deterministic version text (C2): the Gateway line is LANE-SELECTED via
 * hostLane() → gatewayDescriptorForLane() — the historical commit is never
 * presented as universal. Without a resolvable host environment the line
 * states that no lane claim is made (SIR-PS2-010: --version works without
 * HOME); an unmapped lane fails closed without any Linux fallback.
 */
export function versionText(env?: HostEnvironment): string {
  const gatewayLine = (() => {
    if (env === undefined) return 'gateway identity not resolved (host environment unavailable; no lane claim) ';
    const lane = hostLane(env.platform, env.arch);
    const selected = gatewayDescriptorForLane(lane);
    if (!selected.ok) return `gateway identity not bound for host lane ${lane} (no fallback to another lane identity) `;
    const d = selected.descriptor;
    return `gateway ${d.version} (commit ${d.commit}) — lane ${lane}: ${d.repository} (${d.packageName}, bin ${d.binName}) `;
  })();
  return [
    `pi-shuttle ${PI_SHUTTLE_VERSION} (pre-release, unpublished)`,
    gatewayLine,
    `pi-guard ${PI_GUARD_VERSION} (commit ${PI_GUARD_COMMIT})`,
    `pi compatibility baseline ${PI_COMPATIBILITY_BASELINE}`,
  ].join('\n') + '\n';
}
