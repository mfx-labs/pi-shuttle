/**
 * pi-shuttle compatibility representation (PS-2): the pinned version/
 * compatibility facts the installer (PS-3) will later enforce. Truthful
 * only: artifact SHA-256 digests are NOT known in this gate and are
 * represented as `null` (computed at release), mirroring the approved
 * product-contract §6 example (`"<computed-at-release>"`). No `latest`, no
 * semver ranges, no unverified Pi 0.84.x claims.
 *
 * Pins preserved from the approved contract + later gate facts:
 *   gateway committed baseline 55f764290a4567a20557f1db19d2a6fb97572a97
 *     (PS-6I local baseline: the exact source closure the packaged
 *     artifact is built from; product-contract §6 "gatewayCommit pins the
 *     exact source closure for the packaged artifact". Supersedes the
 *     PS-6R public baseline 28f1d3a12382bc145376c8d8a2d87d89495785ec,
 *     which predates the darwin-x86_64 trusted host lane (ADR-043); the
 *     public repository is updated by a separate human-gated push)
 *   pi-guard v0.1.2 (commit 7a7580cc4cbd7926797564c72269394fc29a860a)
 *   Pi compatibility baseline 0.83.0 (SUPPORTED_PI_LANE)
 *
 * Current support decision (human-approved E1 promotion):
 *   pi-shuttle supports Linux x86_64 and macOS x86_64. The darwin-arm64
 *   target remains technically eligible and distribution-bound but is NOT
 *   support-promoted because physical Apple Silicon evidence is pending.
 *
 * ADR-002 fault domain A (per-lane Gateway distribution identity):
 *   the single global Gateway identity is superseded by the authoritative
 *   per-host-lane Gateway descriptor map (GATEWAY_LANE_DESCRIPTORS) with
 *   exactly one fail-closed selector (gatewayDescriptorForLane). The
 *   legacy global Gateway constants/fields remain ONLY as transitional
 *   aliases derived from the historical descriptor so untouched B/C
 *   consumers keep compiling; they MUST NOT participate in lane
 *   selection. Lane support claims remain target-scoped and independent
 *   from runtime eligibility.
 */
export const PI_SHUTTLE_VERSION = '0.1.4';
export const PI_GUARD_VERSION = '0.1.2';
export const PI_GUARD_COMMIT = '7a7580cc4cbd7926797564c72269394fc29a860a';
/** pi-guard release tag at the pinned commit (release-envelope binding). */
export const PI_GUARD_TAG = 'v0.1.2';
export const PI_COMPATIBILITY_BASELINE = '0.83.0';
export const SUPPORTED_PI_LANE = 'pi-0.83.0-extension-api-v1';

// PS-6R runtime compatibility: the exact versions below are the VALIDATED
// CI/evidence baselines (release evidence; reported by doctor/help). They
// are NOT runtime equality gates. The RUNTIME REQUIREMENTS are the
// *_RUNTIME_MINIMUM constants, enforced as minimum-version + capability
// checks by the shared compatibility layer (compat/versions.ts + the
// pi-guard compatibility probe). Human-approved policy (PS-6R).
export const NODE_LANE_VERSION = '22.23.2';
export const GIT_LANE_VERSION = '2.45.4';
export const NODE_RUNTIME_MINIMUM = '22.19.0';
export const GIT_RUNTIME_MINIMUM = '2.30.0';
export const PI_RUNTIME_MINIMUM = '0.83.0';
export const CONFIGURATION_VERSION = '2';
export const CONFIG_FORMAT_VERSION = 1;

/** Gateway host lanes (inherited constants; the Gateway owns their semantics). */
export const LINUX_HOST_LANE = 'linux-x86_64-posix-utf8-node22';
/** darwin arm64 target (PS-6, Gateway ADR-042): technically eligible; NOT support-promoted. */
export const DARWIN_ARM64_HOST_LANE = 'darwin-arm64-posix-utf8-node22';
/** darwin Intel/x64 target (PS-6I, Gateway ADR-043): physically accepted and support-promoted. */
export const DARWIN_X86_64_HOST_LANE = 'darwin-x86_64-posix-utf8-node22';

// ─── ADR-002 A: per-host-lane Gateway distribution descriptors ────────────

/**
 * One Gateway distribution identity for one accepted host lane
 * (product-contract §6.1 / ADR-002). Exactly eight mandatory fields —
 * a descriptor with any field missing, empty, or malformed is invalid
 * and must never be selected.
 */
export interface GatewayLaneDescriptor {
  readonly repository: string;
  /** Full 40-hex source-closure commit (never a branch/tag/floating ref). */
  readonly commit: string;
  readonly version: string;
  readonly packageName: string;
  /** npm-pack tarball filename (hyphen form) in the artifact directory. */
  readonly artifactFileName: string;
  /**
   * null = artifact NOT yet release-materialized. A null digest is an
   * identity claim only: the descriptor must never be treated as a
   * verified or downloadable artifact. 64-hex once computed at release.
   */
  readonly artifactSha256: string | null;
  readonly binName: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

/** The exact dependency pins shared by every Gateway descriptor (product-contract §6). */
const GATEWAY_DEPENDENCY_PINS: Readonly<Record<string, string>> = Object.freeze({
  '@modelcontextprotocol/server': '2.0.0',
  'ajv': '8.20.0',
  'zod': '4.4.3',
});

/** The exact dependency package names a Gateway descriptor may declare (frozen; ADR-002 A strictness). */
export const GATEWAY_DEPENDENCY_PACKAGES: readonly string[] = Object.freeze(Object.keys(GATEWAY_DEPENDENCY_PINS));

/**
 * Historical Gateway descriptor (`mfx-labs/project-gateway`): the identity
 * for the linux and darwin-arm64 lanes, byte-for-byte preserved from the
 * pre-ADR-002 global pins. Unchanged by this domain.
 */
export const HISTORICAL_GATEWAY_DESCRIPTOR: GatewayLaneDescriptor = Object.freeze({
  repository: 'mfx-labs/project-gateway',
  commit: '55f764290a4567a20557f1db19d2a6fb97572a97',
  version: '0.1.0',
  packageName: '@project-gateway/artifact-core',
  artifactFileName: 'project-gateway-artifact-core-0.1.0.tgz',
  artifactSha256: null,
  binName: 'project-gateway-mcp',
  dependencies: GATEWAY_DEPENDENCY_PINS,
});

/**
 * macOS Gateway descriptor (`mfx-labs/project-gateway-macos`): the shared
 * distribution identity for both Darwin host targets, bound to the
 * PGM-DIST-2 provenance-complete dual-architecture candidate. This is a
 * distribution binding only, not a macOS support or runtime-acceptance claim.
 */
export const MACOS_INTEL_GATEWAY_DESCRIPTOR: GatewayLaneDescriptor = Object.freeze({
  repository: 'mfx-labs/project-gateway-macos',
  commit: 'a18bd287c9ccada7fd31932dbe9937062d0b6bc1',
  version: '0.1.0',
  packageName: '@project-gateway/macos-core',
  artifactFileName: 'project-gateway-macos-core-0.1.0.tgz',
  artifactSha256: null,
  binName: 'project-gateway-macos-mcp',
  dependencies: GATEWAY_DEPENDENCY_PINS,
});

/** The authoritative per-host-lane Gateway descriptor map (ADR-002; the ONLY lane-selection authority). */
export const GATEWAY_LANE_DESCRIPTORS: Readonly<Record<string, GatewayLaneDescriptor>> = Object.freeze({
  [LINUX_HOST_LANE]: HISTORICAL_GATEWAY_DESCRIPTOR,
  [DARWIN_ARM64_HOST_LANE]: MACOS_INTEL_GATEWAY_DESCRIPTOR,
  [DARWIN_X86_64_HOST_LANE]: MACOS_INTEL_GATEWAY_DESCRIPTOR,
});

/** The closed mandatory field set: exactly eight own enumerable fields. */
const GATEWAY_DESCRIPTOR_FIELDS = Object.freeze(['repository', 'commit', 'version', 'packageName', 'artifactFileName', 'artifactSha256', 'binName', 'dependencies'] as const);
const GATEWAY_DESCRIPTOR_STRING_FIELDS = Object.freeze(['repository', 'commit', 'version', 'packageName', 'artifactFileName', 'binName'] as const);
const GATEWAY_DESCRIPTOR_FIELD_SET: ReadonlySet<string> = new Set(GATEWAY_DESCRIPTOR_FIELDS);

/**
 * Mandatory-field validation (fail-closed predicate). A descriptor is
 * valid ONLY when it carries exactly the eight mandatory own enumerable
 * fields (missing fields AND unexpected extra fields are both refused),
 * all string fields are non-empty, commit is 40-hex, artifactSha256 is
 * null or 64-hex, and `dependencies` is a plain non-array object whose
 * keys are exactly the expected dependency package names with non-empty
 * string values.
 */
export function isValidGatewayLaneDescriptor(value: unknown): value is GatewayLaneDescriptor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  // Exactly eight own enumerable fields — no missing, no extra.
  const keys = Object.keys(record);
  if (keys.length !== GATEWAY_DESCRIPTOR_FIELDS.length || !keys.every((key) => GATEWAY_DESCRIPTOR_FIELD_SET.has(key))) return false;
  for (const field of GATEWAY_DESCRIPTOR_STRING_FIELDS) {
    const v = record[field];
    if (typeof v !== 'string' || v.length === 0) return false;
  }
  if (!(record['commit'] as string).match(/^[0-9a-f]{40}$/)) return false;
  const sha = record['artifactSha256'];
  if (sha !== null && (typeof sha !== 'string' || !sha.match(/^[0-9a-f]{64}$/))) return false;
  // dependencies: plain non-array object; keys exactly the expected
  // package names; values non-empty strings. Arrays fail here even
  // though typeof [] === "object".
  const deps = record['dependencies'];
  if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) return false;
  const depKeys = Object.keys(deps);
  if (depKeys.length !== GATEWAY_DEPENDENCY_PACKAGES.length || !depKeys.every((key) => GATEWAY_DEPENDENCY_PACKAGES.includes(key))) return false;
  if (Object.entries(deps as Readonly<Record<string, unknown>>).some(([, v]) => typeof v !== 'string' || v.length === 0)) return false;
  return true;
}

export type GatewayDescriptorResult =
  | { readonly ok: true; readonly descriptor: GatewayLaneDescriptor }
  | { readonly ok: false; readonly code: 'ERR-MANIFEST-NO-GATEWAY-LANE' | 'ERR-MANIFEST-INVALID-GATEWAY-DESCRIPTOR'; readonly message: string };

/**
 * Fail-closed Gateway identity selection for an accepted host lane.
 * NEVER falls back to another lane: an unbound lane or a malformed
 * descriptor is a typed refusal. A descriptor with artifactSha256 null
 * is returned as identity only — consumers must never treat it as a
 * verified or downloadable artifact.
 */
export function gatewayDescriptorForLane(lane: string): GatewayDescriptorResult {
  const descriptor = GATEWAY_LANE_DESCRIPTORS[lane];
  if (descriptor === undefined) {
    return {
      ok: false,
      code: 'ERR-MANIFEST-NO-GATEWAY-LANE',
      message: `no Gateway distribution descriptor is bound for host lane ${JSON.stringify(lane)}; bound lanes: ${Object.keys(GATEWAY_LANE_DESCRIPTORS).join(', ')}`,
    };
  }
  if (!isValidGatewayLaneDescriptor(descriptor)) {
    return {
      ok: false,
      code: 'ERR-MANIFEST-INVALID-GATEWAY-DESCRIPTOR',
      message: `the Gateway distribution descriptor bound for host lane ${lane} is malformed; refusing to select it`,
    };
  }
  return { ok: true, descriptor };
}

// ─── Transitional legacy aliases (ADR-002 A) ──────────────────────────────
//
// Derived EXCLUSIVELY from HISTORICAL_GATEWAY_DESCRIPTOR so untouched B/C
// consumers keep compiling with byte-identical values. They MUST NOT
// participate in lane selection — gatewayDescriptorForLane is the only
// selector. Remaining consumers to migrate in later domains:
//   - src/installer/install.ts        (GATEWAY_PACKAGE_VERSION, GATEWAY_PS1_BASELINE_COMMIT)
//   - src/installer/release/envelope.ts (GATEWAY_DEPENDENCIES, GATEWAY_PACKAGE_VERSION, GATEWAY_PS1_BASELINE_COMMIT, COMPATIBILITY_MANIFEST gateway fields)
//   - src/command/doctor.ts           (GATEWAY_PACKAGE_VERSION; GATEWAY_PACKAGE_NAME is local to components.ts)
//   - src/command/help.ts             (versionText: GATEWAY_PACKAGE_VERSION, GATEWAY_PS1_BASELINE_COMMIT — lane-unaware until B/C)
//   - src/installer/components.ts     (own local GATEWAY_PACKAGE_NAME / GATEWAY_ARTIFACT_FILE constants — not manifest-derived)
//   - tests: manifest.test.ts, installer-flow.test.ts, doctor.test.ts, release-*.test.ts
export const GATEWAY_PACKAGE_VERSION = HISTORICAL_GATEWAY_DESCRIPTOR.version;
export const GATEWAY_PS1_BASELINE_COMMIT = HISTORICAL_GATEWAY_DESCRIPTOR.commit;
export const GATEWAY_DEPENDENCIES = HISTORICAL_GATEWAY_DESCRIPTOR.dependencies;

/** The closed compatibility-manifest shape (product-contract §6). */
export interface CompatibilityManifest {
  readonly piShuttle: string;
  /**
   * TRANSITIONAL (ADR-002 A): legacy global Gateway identity fields,
   * derived from HISTORICAL_GATEWAY_DESCRIPTOR for untouched B/C
   * consumers. NOT lane-selection authority — `gatewayLanes` is.
   */
  readonly gateway: string;
  readonly gatewayCommit: string;
  /** Computed at release (PS-3/PS-8); null = not yet known (truthful). */
  readonly gatewayArtifactSha256: string | null;
  readonly piGuard: string;
  readonly piGuardCommit: string;
  /** Computed at release; null = not yet known (truthful). */
  readonly piGuardArtifactSha256: string | null;
  readonly piCompatibilityBaseline: string;
  readonly node: string;
  readonly git: string;
  readonly gatewayDependencies: Readonly<Record<string, string>>;
  readonly configurationVersion: string;
  readonly configFormatVersion: number;
  /** Host targets claimed as supported (evidence-bound). */
  readonly supportedLanes: readonly string[];
  /** Descriptor-bound host targets that are technically eligible but NOT support-promoted. */
  readonly gatedLanes: readonly string[];
  /** Per-host-lane Gateway distribution descriptors (ADR-002; the lane-selection authority). */
  readonly gatewayLanes: Readonly<Record<string, GatewayLaneDescriptor>>;
}

/** The single pinned manifest. Frozen; the only claim source. */
export const COMPATIBILITY_MANIFEST: CompatibilityManifest = Object.freeze({
  piShuttle: PI_SHUTTLE_VERSION,
  gateway: HISTORICAL_GATEWAY_DESCRIPTOR.version,
  gatewayCommit: HISTORICAL_GATEWAY_DESCRIPTOR.commit,
  gatewayArtifactSha256: HISTORICAL_GATEWAY_DESCRIPTOR.artifactSha256,
  piGuard: PI_GUARD_VERSION,
  piGuardCommit: PI_GUARD_COMMIT,
  piGuardArtifactSha256: null,
  piCompatibilityBaseline: PI_COMPATIBILITY_BASELINE,
  node: NODE_LANE_VERSION,
  git: GIT_LANE_VERSION,
  gatewayDependencies: HISTORICAL_GATEWAY_DESCRIPTOR.dependencies,
  configurationVersion: CONFIGURATION_VERSION,
  configFormatVersion: CONFIG_FORMAT_VERSION,
  supportedLanes: Object.freeze([LINUX_HOST_LANE, DARWIN_X86_64_HOST_LANE]),
  gatedLanes: Object.freeze([DARWIN_ARM64_HOST_LANE]),
  gatewayLanes: GATEWAY_LANE_DESCRIPTORS,
});
