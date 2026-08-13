/**
 * PS-3 installer preflight: PURE classification + the narrow facts needed
 * to install safely. This is NOT the PS-4 doctor suite — preflight answers
 * only "can this installation proceed truthfully?". Separated by design.
 *
 * PS-6R RUNTIME COMPATIBILITY POLICY (human-approved): the exact versions
 * in the manifest (22.23.2 / 2.45.4 / 0.83.0) are the VALIDATED CI
 * BASELINES — evidence, not runtime equality gates. Runtime requirements:
 * Node >= 22.19.0; Git >= 2.30.0 (pi-shuttle side; the Gateway enforces
 * its own minimum); Pi 0.83.0 known-good, candidates >= 0.83.0 accepted
 * only when the committed pi-guard compatibility probe PASSES. Exact
 * mismatch alone is never a refusal; a missing required capability or a
 * failed required probe always is.
 */
import { COMPATIBILITY_MANIFEST, NODE_LANE_VERSION, NODE_RUNTIME_MINIMUM, PI_COMPATIBILITY_BASELINE, PI_RUNTIME_MINIMUM } from '../compat/manifest.js';
import { classifyAgainstMinimum } from '../compat/versions.js';
import { hostLane } from '../host/environment.js';
import type { HostEnvironment, LayoutPaths } from '../host/environment.js';
import { resolveExecutable } from './process.js';
import { mkdirSync } from 'node:fs';

export type PreflightVerdict = { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string };

/** Platform/architecture lane claim (Linux x86_64, darwin arm64 + darwin Intel; others refused). */
export function checkPlatformLane(env: HostEnvironment): PreflightVerdict {
  const lane = hostLane(env.platform, env.arch);
  if (COMPATIBILITY_MANIFEST.supportedLanes.includes(lane)) {
    return { ok: true };
  }
  return {
    ok: false,
    code: 'ERR-PS3-UNSUPPORTED-PLATFORM',
    message: `platform ${env.platform} ${env.arch} (lane ${lane}) is not a claimed supported lane; supported lanes: ${COMPATIBILITY_MANIFEST.supportedLanes.join(', ')}`,
  };
}

/**
 * Pure Node runtime classification (PS-6R): at/above the minimum
 * 22.19.0 → version-compatible; below → below-minimum; malformed or
 * unreadable → fail closed. The exact CI baseline 22.23.2 is reported
 * but never gating.
 */
export function classifyNodeRuntime(version: string | null): 'supported' | 'below-minimum' | 'malformed' {
  const verdict = classifyAgainstMinimum(version, NODE_RUNTIME_MINIMUM);
  if (verdict === 'below-minimum') return 'below-minimum';
  if (verdict === 'malformed') return 'malformed';
  return 'supported';
}

/**
 * Node lane: the running interpreter IS the installer's node. Runtime
 * requirement >= 22.19.0 (PS-6R); malformed versions fail closed.
 * 22.23.2 remains the validated CI baseline (reporting only).
 */
export function checkNodeLane(): PreflightVerdict {
  const version = process.version.replace(/^v/, '');
  const classification = classifyNodeRuntime(version);
  if (classification === 'supported') return { ok: true };
  if (classification === 'below-minimum') {
    return {
      ok: false,
      code: 'ERR-PS3-NODE-LANE',
      message: `node ${version} is below the minimum supported runtime ${NODE_RUNTIME_MINIMUM}; the validated CI baseline is ${NODE_LANE_VERSION}`,
    };
  }
  return {
    ok: false,
    code: 'ERR-PS3-NODE-LANE',
    message: `node version could not be parsed ('${version}'); the minimum supported runtime is ${NODE_RUNTIME_MINIMUM} and the validated CI baseline is ${NODE_LANE_VERSION}`,
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
  | { readonly lane: 'candidate'; readonly version: string }
  | { readonly lane: 'not-supported-lane'; readonly version: string }
  | { readonly lane: 'missing' }
  | { readonly lane: 'malformed'; readonly version: string };

/**
 * Pure Pi version classification (PS-6R): 0.83.0 is the known-good
 * baseline (`supported`); any other valid version at/above the minimum
 * 0.83.0 is a `candidate` (requires the committed pi-guard compatibility
 * probe to PASS before acceptance); below 0.83.0 is `not-supported-lane`;
 * unreadable output is `missing`; an unparseable version is `malformed`
 * (fail closed).
 */
export function classifyPiVersion(version: string | null): PiVersionClassification {
  if (version === null || version.trim().length === 0) return { lane: 'missing' };
  const normalized = version.trim();
  if (normalized === PI_COMPATIBILITY_BASELINE) return { lane: 'supported', version: normalized };
  const verdict = classifyAgainstMinimum(normalized, PI_RUNTIME_MINIMUM);
  if (verdict === 'malformed') return { lane: 'malformed', version: normalized };
  if (verdict === 'at-or-above') return { lane: 'candidate', version: normalized };
  return { lane: 'not-supported-lane', version: normalized };
}

/**
 * Pi runtime policy options (pure; production selects the approved
 * probe-based policy). `refuse-non-baseline` is retained for tests and
 * as the conservative alternative.
 */
export type PiPolicy = 'refuse-non-baseline' | 'probe-candidates';

export function applyPiPolicy(classification: PiVersionClassification, policy: PiPolicy): PreflightVerdict {
  switch (classification.lane) {
    case 'supported':
      return { ok: true };
    case 'candidate':
      if (policy === 'probe-candidates') {
        return { ok: true };
      }
      return {
        ok: false,
        code: 'ERR-PS3-PI-NOT-SUPPORTED-LANE',
        message: `pi ${classification.version} is not the known-good baseline ${PI_COMPATIBILITY_BASELINE} and is not accepted under the current policy (probe-based acceptance is the approved policy)`,
      };
    case 'missing':
      return { ok: false, code: 'ERR-PS3-PI-MISSING', message: 'pi was not found on PATH; pi-guard installation requires the Pi integration (0.83.0 known-good baseline)' };
    case 'not-supported-lane':
      return {
        ok: false,
        code: 'ERR-PS3-PI-NOT-SUPPORTED-LANE',
        message: `pi ${classification.version} is below the minimum supported version ${PI_RUNTIME_MINIMUM}; 0.83.0 is the known-good baseline`,
      };
    case 'malformed':
      return {
        ok: false,
        code: 'ERR-PS3-PI-NOT-SUPPORTED-LANE',
        message: `pi version could not be parsed ('${classification.version}'); the minimum supported version is ${PI_RUNTIME_MINIMUM} and 0.83.0 is the known-good baseline`,
      };
  }
}

/** The production policy constant (PS-6R human-approved: probe-based). */
export const PI_RUNTIME_POLICY: PiPolicy = 'probe-candidates';

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
