/**
 * FRESH-INSTALL Slice — release-lane installer entry (official release):
 * `node dist/installer/release/bootstrap.js [--help]`.
 *
 * Executed by the release `install.sh` (generated from
 * scripts/install-release.template.sh). The manifest-native generation
 * needs no shell-side release envelope: the production install authority
 * is the signed metadata chain fetched by the manifest-native orchestrator
 * (src/manifest-native/install.ts) from the compiled trusted origin.
 *
 * The previous-generation envelope handoff environment variables
 * (PI_SHUTTLE_RELEASE_ENVELOPE / PI_SHUTTLE_PI_SHUTTLE_TGZ / ...) are not
 * part of this generation and are never consulted.
 *
 * Exit codes: 0 INSTALLED / ALREADY_INSTALLED; 2 otherwise (same mapping
 * as the local-lane entry).
 */
import { main as installerMain } from '../main.js';
import type { InstallerMainDependencies } from '../main.js';

export { INSTALLER_EXIT, INSTALLER_USAGE, exitCodeFor, formatFreshInstallOutcome, printPostInstallNextSteps } from '../main.js';

/** Release-lane entry: identical manifest-native flow (deps = unit-test seam). */
export async function main(argv: readonly string[], dependencies: InstallerMainDependencies = {}): Promise<number> {
  return installerMain(argv, dependencies);
}

// Direct-execution entry (the release install.sh execs this module). Same
// realpath-guarded pattern as the local-lane entry.
if (process.argv[1] !== undefined) {
  const { realpathSync } = await import('node:fs');
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
