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
 */
export const PI_SHUTTLE_VERSION = '0.1.0';
export const GATEWAY_PACKAGE_VERSION = '0.1.0';
export const GATEWAY_PS1_BASELINE_COMMIT = '55f764290a4567a20557f1db19d2a6fb97572a97';
export const GATEWAY_DEPENDENCIES: Readonly<Record<string, string>> = {
  '@modelcontextprotocol/server': '2.0.0',
  'ajv': '8.20.0',
  'zod': '4.4.3',
};
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
/** darwin arm64 lane (PS-6, Gateway ADR-042): accepted first-class lane. */
export const DARWIN_ARM64_HOST_LANE = 'darwin-arm64-posix-utf8-node22';
/** darwin Intel/x64 lane (PS-6I, Gateway ADR-043): accepted first-class lane. */
export const DARWIN_X86_64_HOST_LANE = 'darwin-x86_64-posix-utf8-node22';

/** The closed compatibility-manifest shape (product-contract §6). */
export interface CompatibilityManifest {
  readonly piShuttle: string;
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
  /** Host lanes claimed as supported (evidence-bound). */
  readonly supportedLanes: readonly string[];
  /** Host lanes targeted but NOT claimed (empty: no gated lanes remain after the PS-6 promotion). */
  readonly gatedLanes: readonly string[];
}

/** The single pinned manifest. Frozen; the only claim source. */
export const COMPATIBILITY_MANIFEST: CompatibilityManifest = Object.freeze({
  piShuttle: PI_SHUTTLE_VERSION,
  gateway: GATEWAY_PACKAGE_VERSION,
  gatewayCommit: GATEWAY_PS1_BASELINE_COMMIT,
  gatewayArtifactSha256: null,
  piGuard: PI_GUARD_VERSION,
  piGuardCommit: PI_GUARD_COMMIT,
  piGuardArtifactSha256: null,
  piCompatibilityBaseline: PI_COMPATIBILITY_BASELINE,
  node: NODE_LANE_VERSION,
  git: GIT_LANE_VERSION,
  gatewayDependencies: Object.freeze({ ...GATEWAY_DEPENDENCIES }),
  configurationVersion: CONFIGURATION_VERSION,
  configFormatVersion: CONFIG_FORMAT_VERSION,
  supportedLanes: Object.freeze([LINUX_HOST_LANE, DARWIN_ARM64_HOST_LANE, DARWIN_X86_64_HOST_LANE]),
  gatedLanes: Object.freeze([]),
});
