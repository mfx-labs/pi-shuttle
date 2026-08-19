/**
 * FRESH-INSTALL Slice — production installer entry (manifest-native lane):
 * `node dist/installer/main.js` via the `install.sh` entrypoint.
 *
 * This is NOT the `pi-shuttle` operational CLI — the closed public grammar
 * (doctor / project / start / --help / --version) is unchanged; the
 * installer is a separate operator surface with its own closed argument
 * grammar.
 *
 * The production Gateway fresh-install authority is the manifest-native
 * orchestrator (src/manifest-native/install.ts): compiled trust policy ->
 * current signed keyring/channel -> signed Gateway release manifest ->
 * fresh VerifiedReleaseSelection -> artifact acquisition/verification ->
 * package materialization -> signed cache -> Receipt Schema 1 LAST.
 *
 * Previous-generation installer options (component selections, install-dir/
 * bin-dir overrides, upgrade prompts, latest-channel handoffs) are NOT
 * accepted: this generation has no caller-selected release authority, no
 * upgrade/rollback, and a fixed manifest-native layout. Any such argument
 * is refused with typed guidance — never silently ignored.
 *
 * Exit codes (documented, closed): 0 INSTALLED / ALREADY_INSTALLED; 2
 * FAILED / UNSUPPORTED / REFUSED / ALREADY_INSTALLED_UPDATE_REQUIRED /
 * malformed invocation.
 */
import { realpathSync } from 'node:fs';
import type { HostEnvironment } from '../host/environment.js';
import { hostEnvironmentFromProcess } from '../host/environment.js';
import { runManifestNativeFreshInstall } from '../manifest-native/install.js';
import type { FreshInstallDependencies, FreshInstallOutcome } from '../manifest-native/install.js';

export const INSTALLER_EXIT = { COMPLETE: 0, FAILED: 2 } as const;

export const INSTALLER_USAGE = `pi-shuttle installer (manifest-native lane)
usage: install.sh [--help]

Installs the signed stable Gateway release through the manifest-native
trust chain (compiled trust policy -> current signed keyring/channel ->
signed Gateway release manifest -> verified artifact -> content-addressed
package -> signed cache -> Receipt Schema 1). No component selections, no
upgrade, no rollback, no caller-selected release authority.
`;

export interface InstallerMainDependencies {
  /** Injectable install runner (unit tests only; production = the manifest-native orchestrator). */
  readonly installRunner?: (env: HostEnvironment) => Promise<FreshInstallOutcome>;
  /** Injectable orchestrator dependencies (unit tests only; production defaults). */
  readonly installDeps?: FreshInstallDependencies;
}

export function formatFreshInstallOutcome(outcome: FreshInstallOutcome): string {
  switch (outcome.kind) {
    case 'INSTALLED':
      return `result: INSTALLED — Gateway release ${outcome.releaseId} verified and activated (manifest-native lifecycle)`;
    case 'ALREADY_INSTALLED':
      return `result: ALREADY INSTALLED — Gateway release ${outcome.releaseId} is the exact authenticated installation; durability barriers re-established; no changes were needed`;
    case 'ALREADY_INSTALLED_UPDATE_REQUIRED':
      return `result: REFUSED — a different Gateway release is already installed (installed ${outcome.installedReleaseId}, selected ${outcome.selectedReleaseId}); this installer is fresh-install only — update is not supported`;
    case 'UNSUPPORTED':
      return `result: UNSUPPORTED — ${outcome.reason}`;
    case 'REFUSED':
      return `result: REFUSED — ${outcome.message} (${outcome.code})`;
    case 'FAILED':
      return `result: FAILED at stage "${outcome.stage}" — ${outcome.message} (${outcome.code})`;
  }
}

export function exitCodeFor(outcome: FreshInstallOutcome): number {
  switch (outcome.kind) {
    case 'INSTALLED':
    case 'ALREADY_INSTALLED':
      return INSTALLER_EXIT.COMPLETE;
    case 'ALREADY_INSTALLED_UPDATE_REQUIRED':
    case 'UNSUPPORTED':
    case 'REFUSED':
    case 'FAILED':
      return INSTALLER_EXIT.FAILED;
  }
}

export function printPostInstallNextSteps(outcome: FreshInstallOutcome): void {
  if (outcome.kind !== 'INSTALLED' && outcome.kind !== 'ALREADY_INSTALLED') return;
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

export async function main(argv: readonly string[], dependencies: InstallerMainDependencies = {}): Promise<number> {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    process.stdout.write(INSTALLER_USAGE);
    return 0;
  }
  if (argv.length > 0) {
    process.stderr.write(`pi-shuttle-installer: unrecognized installer arguments ${argv.map((a) => `"${a}"`).join(', ')} — the manifest-native installer accepts no selections, paths, or release options; pass --help for usage\n`);
    return INSTALLER_EXIT.FAILED;
  }

  const env = hostEnvironmentFromProcess();
  if (!env.ok) {
    process.stderr.write(`pi-shuttle-installer: ${env.message}\n`);
    return INSTALLER_EXIT.FAILED;
  }
  const runner = dependencies.installRunner ?? ((e: HostEnvironment) => runManifestNativeFreshInstall(e, dependencies.installDeps));
  const outcome = await runner(env.environment);

  process.stdout.write(`pi-shuttle installer (manifest-native lane)\n`);
  process.stdout.write(`${formatFreshInstallOutcome(outcome)}\n`);
  process.stdout.write(`manifest-native authority root: ${env.environment.home}/.local/share/pi-shuttle/manifest-native\n`);
  if (outcome.kind === 'INSTALLED' || outcome.kind === 'ALREADY_INSTALLED') {
    printPostInstallNextSteps(outcome);
  } else {
    process.stdout.write('no installation authority was changed; unrelated operator state was preserved\n');
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
