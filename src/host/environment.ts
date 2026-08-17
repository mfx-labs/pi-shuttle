/**
 * pi-shuttle host seam (PS-2): the narrow, injectable host observations
 * pi-shuttle needs. Home discovery happens HERE ONLY (`process.env` is
 * confined to this module; the static guard enforces it). No subprocess
 * execution, no network, no privileged operations, no hard-coded
 * /home/<user> or /usr/bin paths anywhere in the product.
 *
 * The approved portable layout (installation-contract §8,
 * platform-support-contract §2) is identical on Linux and macOS:
 *   ~/.local/share/pi-shuttle   durable data
 *   ~/.local/state/pi-shuttle   disposable state
 *   ~/.config/pi-shuttle        operator configuration
 *   ~/.local/bin/pi-shuttle     CLI entry
 * No macOS ~/Library/... specialization exists in this gate (PS-6 owns
 * macOS host-lane semantics; PS-2 keeps the representation neutral).
 */
import { realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** Minimal host facts observed by pi-shuttle (injectable for tests). */
export interface HostEnvironment {
  /** Operator home directory (absolute). Discovered from $HOME. */
  readonly home: string;
  /** Node platform name (`linux`, `darwin`, ...). */
  readonly platform: string;
  /** Node architecture (`x64`, `arm64`, ...). */
  readonly arch: string;
  /**
   * Executable-search environment (PATH) for subprocess discovery. The
   * value is captured here — the only seam allowed to read `process.env`
   * besides the process boundary — and consumed by the PS-4 lifecycle
   * probes through the runner. Absent in synthetic/test environments:
   * the runner then falls back to the real process environment.
   */
  readonly pathEnv?: NodeJS.ProcessEnv;
}

/** Build the host environment from the real process (CLI entry only). */
export function hostEnvironmentFromProcess(): { readonly ok: true; readonly environment: HostEnvironment } | { readonly ok: false; readonly message: string } {
  const home = process.env.HOME;
  if (home === undefined || home.length === 0) {
    return { ok: false, message: 'HOME is not set; pi-shuttle requires an operator home directory' };
  }
  if (!isAbsolute(home)) {
    return { ok: false, message: `HOME must be an absolute path (got "${home}"); relative HOME paths are not accepted` };
  }
  return { ok: true, environment: { home, platform: process.platform, arch: process.arch, pathEnv: process.env } };
}

/** Direct-entry environment seam for installer bootstrap handoffs. */
export function installerEnvironment(): NodeJS.ProcessEnv {
  return process.env;
}

/** The complete approved pi-shuttle layout, derived from the home dir. */
export interface LayoutPaths {
  readonly shareDir: string; // ~/.local/share/pi-shuttle
  readonly stateDir: string; // ~/.local/state/pi-shuttle
  readonly configDir: string; // ~/.config/pi-shuttle
  readonly binDir: string; // ~/.local/bin (CLI entry)
  readonly storesDir: string; // share/stores (trusted store parents — Gateway-owned content)
  readonly packagesDir: string; // share/packages (versioned component installs)
  readonly gitHomeDir: string; // share/git-home (operator Git isolation, per store)
  readonly gitTmpDir: string; // share/git-tmp (operator Git isolation, per store)
  readonly manifestsDir: string; // share/manifests (installed manifest copies)
  readonly runtimeConfigPath: string; // config/runtime.json (Gateway startup document, operator-owned)
  readonly installReceiptPath: string; // state/install.json (install receipt, installer-owned)
  readonly stagingDir: string; // state/staging (install staging)
  readonly logsDir: string; // state/logs (bounded logs)
}

/** Resolve the approved layout from an injected home directory. */
export function resolveLayout(home: string): LayoutPaths {
  const local = join(home, '.local');
  const shareDir = join(local, 'share', 'pi-shuttle');
  const stateDir = join(local, 'state', 'pi-shuttle');
  const configDir = join(home, '.config', 'pi-shuttle');
  return {
    shareDir,
    stateDir,
    configDir,
    binDir: join(local, 'bin'),
    storesDir: join(shareDir, 'stores'),
    packagesDir: join(shareDir, 'packages'),
    gitHomeDir: join(shareDir, 'git-home'),
    gitTmpDir: join(shareDir, 'git-tmp'),
    manifestsDir: join(shareDir, 'manifests'),
    runtimeConfigPath: join(configDir, 'runtime.json'),
    installReceiptPath: join(stateDir, 'install.json'),
    stagingDir: join(stateDir, 'staging'),
    logsDir: join(stateDir, 'logs'),
  };
}

/**
 * Canonicalize an existing path (symlink-resolved). Returns null when the
 * path does not resolve (fail closed). Security-relevant canonicalization
 * (project roots, store parents) must go through this seam.
 */
export function canonicalizePath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * Map platform/architecture to a Gateway host-lane constant. Lane semantics
 * are inherited from the Gateway (component-boundaries §3); the manifest's
 * supported/gated lane sets are the claim, never this mapping.
 *
 * The canonical vocabulary: process-facing boundaries use Node's
 * architecture names (`x64`, `arm64`); protocol boundaries use the
 * TrustedHostLane spelling (`x86_64`). The `node22` suffix is a frozen
 * opaque protocol label, never an exact Node runtime requirement (PS-6R).
 */
export function hostLane(platform: string, arch: string): string {
  if (platform === 'linux' && arch === 'x64') return 'linux-x86_64-posix-utf8-node22';
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64-posix-utf8-node22';
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x86_64-posix-utf8-node22';
  return `${platform}-${arch}`;
}
