/**
 * Deterministic help/version text (PS-2). Works with zero initialized
 * product state (help/version never touch the filesystem or config).
 */
import { GATEWAY_PACKAGE_VERSION, GATEWAY_PS1_BASELINE_COMMIT, PI_COMPATIBILITY_BASELINE, PI_GUARD_COMMIT, PI_GUARD_VERSION, PI_SHUTTLE_VERSION } from '../compat/manifest.js';

/** Closed help text: the exact public grammar and the closed exit-code model. */
export function helpText(): string {
  return [
    'pi-shuttle — operator CLI for the Project Gateway MCP + pi-guard composed product',
    '',
    'usage: pi-shuttle <command> [operands]',
    '',
    'commands:',
    '  doctor                              verify installation state (PS-2 skeleton)',
    '  project add <path>                  register a project (operational handler: PS-4)',
    '  project list                        list registered projects (operational handler: PS-4)',
    '  project remove <path-or-workspace-id>  deregister a project; the trusted store is',
    '                                        preserved (operational handler: PS-4)',
    '  start                               start the Gateway stdio MCP runtime (operational',
    '                                        handler: PS-4)',
    '  --help                              show this help',
    '  --version                           print version and pinned component versions',
    '',
    'exit codes: 0 success; 1 operational failure (findings, missing state);',
    '            2 malformed invocation or unsupported platform/architecture (`doctor`)',
  ].join('\n') + '\n';
}

/** Deterministic version text: CLI version + the manifest's pinned components. */
export function versionText(): string {
  return [
    `pi-shuttle ${PI_SHUTTLE_VERSION} (pre-release, unpublished)`,
    `gateway ${GATEWAY_PACKAGE_VERSION} (commit ${GATEWAY_PS1_BASELINE_COMMIT})`,
    `pi-guard ${PI_GUARD_VERSION} (commit ${PI_GUARD_COMMIT})`,
    `pi compatibility baseline ${PI_COMPATIBILITY_BASELINE}`,
  ].join('\n') + '\n';
}
