/**
 * PS-8A release envelope (`pi-shuttle-0.1.0.json`): the closed,
 * version-pinned distribution manifest. It binds the release version,
 * the pi-shuttle package, the exact Gateway and pi-guard artifacts
 * (file names + SHA-256), and the runtime policy facts.
 *
 * Deliberately DISTINCT from the runtime compatibility manifest
 * (compat/manifest.ts): the runtime manifest is embedded in the product
 * and carries no distribution data; the envelope is a release asset and
 * carries no URLs — artifact file names are resolved by the release
 * bootstrap against the fixed, version-pinned release base URL, so no
 * untrusted manifest content can name a host.
 *
 * Closed schema: every object rejects unknown keys; every value is
 * type-checked; version/commit/policy fields must EQUAL the compiled-in
 * constants (a release built from different pins cannot validate).
 */
import { COMPATIBILITY_MANIFEST, GATEWAY_DEPENDENCIES, GATEWAY_PACKAGE_VERSION, GATEWAY_PS1_BASELINE_COMMIT, GIT_RUNTIME_MINIMUM, NODE_RUNTIME_MINIMUM, PI_GUARD_COMMIT, PI_GUARD_TAG, PI_GUARD_VERSION, PI_RUNTIME_MINIMUM, PI_SHUTTLE_VERSION } from '../../compat/manifest.js';
import { parseJsonRejectingDuplicates } from '../../config/json.js';

export const ENVELOPE_SCHEMA_VERSION = 1;

/** Closed asset file-name grammar: a single relative component, no traversal. */
export const RELEASE_FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export interface ReleaseEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly releaseVersion: string;
  readonly piShuttle: {
    readonly version: string;
    readonly fileName: string;
    readonly sha256: string;
  };
  readonly gateway: {
    readonly packageVersion: string;
    readonly sourceCommit: string;
    readonly fileName: string;
    readonly sha256: string;
  };
  readonly piGuard: {
    readonly version: string;
    readonly sourceCommit: string;
    readonly sourceTag: string;
    readonly fileName: string;
    readonly sha256: string;
  };
  readonly policy: {
    readonly gatewayDependencies: Readonly<Record<string, string>>;
    readonly configurationVersion: string;
    readonly configFormatVersion: number;
    readonly nodeLaneVersion: string;
    readonly gitLaneVersion: string;
    readonly nodeRuntimeMinimum: string;
    readonly gitRuntimeMinimum: string;
    readonly piCompatibilityBaseline: string;
    readonly piRuntimeMinimum: string;
    readonly supportedLanes: readonly string[];
  };
}

export type EnvelopeResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly message: string };

type UnknownRecord = Readonly<Record<string, unknown>>;

/** Closed-object helper: reject unknown keys and non-object values. */
function closedObject(value: unknown, allowedKeys: readonly string[], label: string): UnknownRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as UnknownRecord;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) return null;
  }
  return record;
}

function fail(code: string, message: string): EnvelopeResult<ReleaseEnvelopeV1> {
  return { ok: false, code, message };
}

function requireString(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function requireNumber(record: UnknownRecord, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function requireStringRecord(record: UnknownRecord, key: string): Readonly<Record<string, string>> | null {
  const value = record[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string') return null;
    out[k] = v;
  }
  return out;
}

function requireStringArray(record: UnknownRecord, key: string): readonly string[] | null {
  const value = record[key];
  if (!Array.isArray(value)) return null;
  if (value.some((v) => typeof v !== 'string')) return null;
  return value as readonly string[];
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((v) => bSet.has(v));
}

/** Validate a parsed release envelope against the closed schema + exact pins. */
export function validateEnvelope(raw: unknown): EnvelopeResult<ReleaseEnvelopeV1> {
  const root = closedObject(raw, ['schemaVersion', 'releaseVersion', 'piShuttle', 'gateway', 'piGuard', 'policy'], 'envelope');
  if (root === null) return fail('ERR-REL-ENVELOPE-SCHEMA', 'release envelope must be a closed object with exactly schemaVersion/releaseVersion/piShuttle/gateway/piGuard/policy');

  if (requireNumber(root, 'schemaVersion') !== ENVELOPE_SCHEMA_VERSION) {
    return fail('ERR-REL-ENVELOPE-SCHEMA', `release envelope schemaVersion must be ${ENVELOPE_SCHEMA_VERSION}`);
  }

  const releaseVersion = requireString(root, 'releaseVersion');
  if (releaseVersion === null) return fail('ERR-REL-ENVELOPE-SCHEMA', 'releaseVersion must be a string');
  if (releaseVersion !== PI_SHUTTLE_VERSION) {
    return fail('ERR-REL-ENVELOPE-VERSION', `release envelope version mismatch: envelope ${releaseVersion}, installer ${PI_SHUTTLE_VERSION}`);
  }

  const piShuttle = closedObject(root['piShuttle'], ['version', 'fileName', 'sha256'], 'piShuttle');
  const gateway = closedObject(root['gateway'], ['packageVersion', 'sourceCommit', 'fileName', 'sha256'], 'gateway');
  const piGuard = closedObject(root['piGuard'], ['version', 'sourceCommit', 'sourceTag', 'fileName', 'sha256'], 'piGuard');
  const policy = closedObject(root['policy'], ['gatewayDependencies', 'configurationVersion', 'configFormatVersion', 'nodeLaneVersion', 'gitLaneVersion', 'nodeRuntimeMinimum', 'gitRuntimeMinimum', 'piCompatibilityBaseline', 'piRuntimeMinimum', 'supportedLanes'], 'policy');
  if (piShuttle === null || gateway === null || piGuard === null || policy === null) {
    return fail('ERR-REL-ENVELOPE-SCHEMA', 'piShuttle/gateway/piGuard/policy must be closed objects');
  }

  const checkAsset = (record: UnknownRecord): { readonly sha256: string; readonly fileName: string } | null => {
    const sha256 = requireString(record, 'sha256');
    const fileName = requireString(record, 'fileName');
    if (sha256 === null || !SHA256_HEX_RE.test(sha256)) return null;
    if (fileName === null || !RELEASE_FILE_NAME_RE.test(fileName)) return null;
    return { sha256, fileName };
  };

  const piShuttleAsset = checkAsset(piShuttle);
  const gatewayAsset = checkAsset(gateway);
  const piGuardAsset = checkAsset(piGuard);
  if (piShuttleAsset === null || gatewayAsset === null || piGuardAsset === null) {
    return fail('ERR-REL-ENVELOPE-SCHEMA', 'asset entries require fileName (single relative component) and a 64-hex sha256');
  }

  // Exact pin binding: every version/commit/tag/policy fact must equal the
  // compiled-in constants — a release built from different pins cannot
  // validate against this installer.
  const piShuttleVersion = requireString(piShuttle, 'version');
  if (typeof piShuttleVersion !== 'string' || piShuttleVersion !== PI_SHUTTLE_VERSION) {
    return fail('ERR-REL-ENVELOPE-VERSION', `piShuttle version mismatch: envelope ${piShuttleVersion ?? '(missing)'}, pinned ${PI_SHUTTLE_VERSION}`);
  }
  const gatewayVersion = requireString(gateway, 'packageVersion');
  const gatewayCommit = requireString(gateway, 'sourceCommit');
  if (typeof gatewayVersion !== 'string' || typeof gatewayCommit !== 'string' || gatewayVersion !== GATEWAY_PACKAGE_VERSION || gatewayCommit !== GATEWAY_PS1_BASELINE_COMMIT) {
    return fail('ERR-REL-ENVELOPE-PIN', `gateway pin mismatch: envelope ${gatewayVersion ?? '(missing)'}@${gatewayCommit ?? '(missing)'}, pinned ${GATEWAY_PACKAGE_VERSION}@${GATEWAY_PS1_BASELINE_COMMIT}`);
  }
  const piGuardVersion = requireString(piGuard, 'version');
  const piGuardCommit = requireString(piGuard, 'sourceCommit');
  const piGuardTag = requireString(piGuard, 'sourceTag');
  if (typeof piGuardVersion !== 'string' || typeof piGuardCommit !== 'string' || typeof piGuardTag !== 'string' || piGuardVersion !== PI_GUARD_VERSION || piGuardCommit !== PI_GUARD_COMMIT || piGuardTag !== PI_GUARD_TAG) {
    return fail('ERR-REL-ENVELOPE-PIN', `pi-guard pin mismatch: envelope ${piGuardVersion ?? '(missing)'}@${piGuardCommit ?? '(missing)'} (${piGuardTag ?? '(missing)'}), pinned ${PI_GUARD_VERSION}@${PI_GUARD_COMMIT} (${PI_GUARD_TAG})`);
  }

  const gatewayDependencies = requireStringRecord(policy, 'gatewayDependencies');
  if (gatewayDependencies === null) return fail('ERR-REL-ENVELOPE-SCHEMA', 'policy.gatewayDependencies must be a string map');
  const dependencyKeys = Object.keys(GATEWAY_DEPENDENCIES);
  const envelopeKeys = Object.keys(gatewayDependencies);
  if (dependencyKeys.length !== envelopeKeys.length || dependencyKeys.some((k) => gatewayDependencies[k] !== GATEWAY_DEPENDENCIES[k])) {
    return fail('ERR-REL-ENVELOPE-PIN', 'policy.gatewayDependencies must equal the pinned gateway dependency set exactly');
  }

  const configurationVersion = requireString(policy, 'configurationVersion');
  const configFormatVersion = requireNumber(policy, 'configFormatVersion');
  const nodeLaneVersion = requireString(policy, 'nodeLaneVersion');
  const gitLaneVersion = requireString(policy, 'gitLaneVersion');
  const nodeRuntimeMinimum = requireString(policy, 'nodeRuntimeMinimum');
  const gitRuntimeMinimum = requireString(policy, 'gitRuntimeMinimum');
  const piCompatibilityBaseline = requireString(policy, 'piCompatibilityBaseline');
  const piRuntimeMinimum = requireString(policy, 'piRuntimeMinimum');
  const supportedLanes = requireStringArray(policy, 'supportedLanes');
  if (
    configurationVersion !== COMPATIBILITY_MANIFEST.configurationVersion ||
    configFormatVersion !== COMPATIBILITY_MANIFEST.configFormatVersion ||
    nodeLaneVersion !== COMPATIBILITY_MANIFEST.node ||
    gitLaneVersion !== COMPATIBILITY_MANIFEST.git ||
    nodeRuntimeMinimum !== NODE_RUNTIME_MINIMUM ||
    gitRuntimeMinimum !== GIT_RUNTIME_MINIMUM ||
    piCompatibilityBaseline !== COMPATIBILITY_MANIFEST.piCompatibilityBaseline ||
    piRuntimeMinimum !== PI_RUNTIME_MINIMUM ||
    supportedLanes === null ||
    !sameStringSet(supportedLanes, COMPATIBILITY_MANIFEST.supportedLanes)
  ) {
    return fail('ERR-REL-ENVELOPE-PIN', 'policy facts must equal the pinned runtime compatibility manifest');
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      releaseVersion,
      piShuttle: { version: piShuttleVersion, fileName: piShuttleAsset.fileName, sha256: piShuttleAsset.sha256 },
      gateway: { packageVersion: gatewayVersion, sourceCommit: gatewayCommit, fileName: gatewayAsset.fileName, sha256: gatewayAsset.sha256 },
      piGuard: { version: piGuardVersion, sourceCommit: piGuardCommit, sourceTag: piGuardTag, fileName: piGuardAsset.fileName, sha256: piGuardAsset.sha256 },
      policy: {
        gatewayDependencies,
        configurationVersion,
        configFormatVersion,
        nodeLaneVersion,
        gitLaneVersion,
        nodeRuntimeMinimum,
        gitRuntimeMinimum,
        piCompatibilityBaseline,
        piRuntimeMinimum,
        supportedLanes,
      },
    },
  };
}

/** Parse + validate the envelope document. */
export function parseEnvelope(text: string): EnvelopeResult<ReleaseEnvelopeV1> {
  const parsed = parseJsonRejectingDuplicates(text);
  if (!parsed.ok) {
    return fail('ERR-REL-ENVELOPE-MALFORMED', `release envelope is not valid JSON: ${parsed.message}`);
  }
  return validateEnvelope(parsed.value);
}
