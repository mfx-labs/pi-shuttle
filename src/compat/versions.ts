/**
 * PS-6R runtime compatibility: pure version-triple parsing and minimum
 * comparison shared by every runtime gate (install, project add, start,
 * doctor). The approved policy separates the VALIDATED CI BASELINE
 * (exact versions in manifest.ts — evidence) from the RUNTIME
 * REQUIREMENT (minimum versions compared here). Exact equality is never
 * a runtime gate anymore; malformed/unreadable versions fail closed.
 *
 * Strict grammar: exactly `major.minor.patch`, all numeric, no
 * prerelease/build suffixes, no leading 'v' (callers strip prefixes
 * before parsing). Anything else is malformed (fail closed) — a runtime
 * version that cannot be classified is never silently accepted.
 */

export interface VersionTriple {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const TRIPLE_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Parse a strict `major.minor.patch` triple; null when malformed. */
export function parseVersionTriple(raw: string): VersionTriple | null {
  const match = raw.trim().match(TRIPLE_RE);
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Compare two triples: -1 | 0 | 1 (a < b → -1). */
export function compareVersionTriples(a: VersionTriple, b: VersionTriple): -1 | 0 | 1 {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
}

export type MinimumVerdict = 'malformed' | 'below-minimum' | 'at-or-above';

/**
 * Classify a runtime version string against a minimum version.
 * `malformed` (unparseable) fails closed; `below-minimum` is
 * unsupported; `at-or-above` is version-compatible.
 */
export function classifyAgainstMinimum(version: string | null, minimum: string): MinimumVerdict {
  if (version === null) return 'malformed';
  const parsed = parseVersionTriple(version);
  if (parsed === null) return 'malformed';
  const min = parseVersionTriple(minimum);
  if (min === null) return 'malformed'; // a malformed policy constant is a programming error; fail closed
  return compareVersionTriples(parsed, min) < 0 ? 'below-minimum' : 'at-or-above';
}

/** True when the version parses and is >= minimum (the only accept path). */
export function isAtLeast(version: string | null, minimum: string): boolean {
  return classifyAgainstMinimum(version, minimum) === 'at-or-above';
}
