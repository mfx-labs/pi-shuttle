/**
 * PS-3 installer preflight: PURE classification + the narrow facts needed
 * to install safely. This is NOT the PS-4 doctor suite — preflight answers
 * only "can this installation proceed truthfully?". Separated by design.
 *
 * PI COMPATIBILITY POLICY (explicit seam — see also the implementation
 * report §18): the approved baseline is Pi 0.83.0 (SUPPORTED_PI_LANE).
 * Pi 0.84.x is NOT a claimed lane. installation-contract §4 mandates:
 * "Pi 0.84.1 → refuse with explanation ('0.83.0 is the verified baseline;
 * 0.84.x is not a claimed lane'), not silent acceptance." Both hypothetical
 * policies (hard refuse vs allow-with-unverified) are implemented as pure
 * functions so the decision stays a one-line production constant pending
 * the human decision recorded in the PS-3 report.
 */
import { COMPATIBILITY_MANIFEST, NODE_LANE_VERSION, PI_COMPATIBILITY_BASELINE } from '../compat/manifest.js';
import { hostLane } from '../host/environment.js';
import type { HostEnvironment, LayoutPaths } from '../host/environment.js';
import { resolveExecutable } from './process.js';
import { mkdirSync } from 'node:fs';

export type PreflightVerdict = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string };

/** Platform/architecture lane claim (Linux x86_64 only; macOS stays gated). */
export function checkPlatformLane(env: HostEnvironment): PreflightVerdict {
  const lane = hostLane(env.platform, env.arch);
  if (COMPATIBILITY_MANIFEST.supportedLanes.includes(lane)) {
    return { ok: true };
  }
  const gated = COMPATIBILITY_MANIFEST.gatedLanes.includes(lane);
  return {
    ok: false,
    code: 'ERR-PS3-UNSUPPORTED-PLATFORM',
    message: `platform ${env.platform} ${env.arch} (lane ${lane}) is not a claimed supported lane; the only supported lane is ${COMPATIBILITY_MANIFEST.supportedLanes.join(', ')}${gated ? ' (macOS arm64 is gated pending PS-6 evidence)' : ''}`,
  };
}

/**
 * Node lane: the running interpreter IS the installer's node. The exact
 * validated lane is 22.23.2; other versions are refused per
 * installation-contract §4 (the engines >=22.0.0 floor is a package
 * compatibility statement, not a support claim).
 */
export function checkNodeLane(): PreflightVerdict {
  const version = process.version.replace(/^v/, '');
  if (version === NODE_LANE_VERSION) return { ok: true };
  return {
    ok: false,
    code: 'ERR-PS3-NODE-LANE',
    message: `node ${version} is not the validated lane (${NODE_LANE_VERSION}); other versions are runtime-compatible but not validated release evidence (installation-contract §4)`,
  };
}

/** tar is required to extract component artifacts. */
export function checkTarPresent(): PreflightVerdict {
  const tar = resolveExecutable('tar');
  if (tar !== null) return { ok: true };
  return { ok: false, code: 'ERR-PS3-TAR-MISSING', message: 'tar is required to extract component artifacts but was not found on PATH' };
}

export type PiVersionClassification =
  | { readonly lane: 'supported'; readonly version: string }
  | { readonly lane: 'not-supported-lane'; readonly version: string }
  | { readonly lane: 'missing' };

/** Pure Pi version classification against the approved baseline. */
export function classifyPiVersion(version: string | null): PiVersionClassification {
  if (version === null || version.trim().length === 0) return { lane: 'missing' };
  const normalized = version.trim();
  if (normalized === PI_COMPATIBILITY_BASELINE) return { lane: 'supported', version: normalized };
  return { lane: 'not-supported-lane', version: normalized };
}

/**
 * Pi non-baseline policy options (pure, both implemented; production
 * selects the contract-mandated one — see module header).
 */
export type PiPolicy = 'refuse-non-baseline' | 'allow-unverified';

export function applyPiPolicy(classification: PiVersionClassification, policy: PiPolicy): PreflightVerdict {
  switch (classification.lane) {
    case 'supported':
      return { ok: true };
    case 'missing':
      return { ok: false, code: 'ERR-PS3-PI-MISSING', message: 'pi was not found on PATH; pi-guard installation requires the Pi integration (0.83.0 baseline)' };
    case 'not-supported-lane':
      if (policy === 'allow-unverified') {
        return { ok: true };
      }
      return {
        ok: false,
        code: 'ERR-PS3-PI-NOT-SUPPORTED-LANE',
        message: `pi ${classification.version} is not a claimed lane; 0.83.0 is the verified baseline and 0.84.x is not a claimed lane (installation-contract §4)`,
      };
  }
}

/** The production policy constant (contract-mandated refusal; see report §18). */
export const PI_NON_BASELINE_POLICY: PiPolicy = 'refuse-non-baseline';

/**
 * Per-user installation rule (SIR-PS3-007; installation-contract §4): the
 * installer refuses to run with root privileges. Injectable UID observation
 * seam (`null` when the platform has no getuid, e.g. Windows — the
 * POSIX-only installer surfaces are already gated by the platform lane).
 */
export function checkNotRoot(uid: number | null): PreflightVerdict {
  if (uid === 0) {
    return {
      ok: false,
      code: 'ERR-PS3-ROOT-REFUSED',
      message: 'pi-shuttle is a per-user installation and must not run with root privileges; re-run as a normal user',
    };
  }
  return { ok: true };
}

/** Create the pi-shuttle layout dirs (0700) — fails closed when unwritable. */
export function ensureWritableLayout(layout: LayoutPaths): PreflightVerdict {
  for (const dir of [layout.shareDir, layout.stateDir, layout.configDir, layout.binDir, layout.packagesDir]) {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err) {
      return {
        ok: false,
        code: 'ERR-PS3-LAYOUT-UNWRITABLE',
        message: `installation directory ${dir} could not be created or is not writable (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})`,
      };
    }
  }
  return { ok: true };
}
