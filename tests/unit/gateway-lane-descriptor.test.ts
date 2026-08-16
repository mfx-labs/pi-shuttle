/**
 * ADR-002 fault domain A — per-host-lane Gateway distribution descriptor:
 * focused tests for the descriptor map, the fail-closed selector, the
 * three lane resolutions, the null-digest semantics, and the transitional
 * legacy aliases. No installer/doctor/lifecycle behavior is exercised.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPATIBILITY_MANIFEST,
  DARWIN_ARM64_HOST_LANE,
  DARWIN_X86_64_HOST_LANE,
  GATEWAY_DEPENDENCY_PACKAGES,
  GATEWAY_LANE_DESCRIPTORS,
  GATEWAY_PACKAGE_VERSION,
  GATEWAY_PS1_BASELINE_COMMIT,
  HISTORICAL_GATEWAY_DESCRIPTOR,
  LINUX_HOST_LANE,
  MACOS_INTEL_GATEWAY_DESCRIPTOR,
  gatewayDescriptorForLane,
  isValidGatewayLaneDescriptor,
} from '../../src/compat/manifest.js';

const DEPENDENCY_PINS = {
  '@modelcontextprotocol/server': '2.0.0',
  'ajv': '8.20.0',
  'zod': '4.4.3',
};

test('descriptor map binds exactly the three accepted host lanes and is frozen', () => {
  assert.deepEqual(
    Object.keys(GATEWAY_LANE_DESCRIPTORS).sort(),
    [LINUX_HOST_LANE, DARWIN_ARM64_HOST_LANE, DARWIN_X86_64_HOST_LANE].sort(),
  );
  assert.ok(Object.isFrozen(GATEWAY_LANE_DESCRIPTORS), 'descriptor map must be frozen');
  assert.ok(Object.isFrozen(HISTORICAL_GATEWAY_DESCRIPTOR), 'historical descriptor must be frozen');
  assert.ok(Object.isFrozen(MACOS_INTEL_GATEWAY_DESCRIPTOR), 'Intel fork descriptor must be frozen');
});

test('linux resolves to the historical descriptor, byte-for-byte preserved', () => {
  const result = gatewayDescriptorForLane(LINUX_HOST_LANE);
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.descriptor, HISTORICAL_GATEWAY_DESCRIPTOR, 'linux must resolve to the same frozen historical descriptor');
    assert.deepEqual({ ...result.descriptor, dependencies: { ...result.descriptor.dependencies } }, {
      repository: 'mfx-labs/project-gateway',
      commit: '55f764290a4567a20557f1db19d2a6fb97572a97',
      version: '0.1.0',
      packageName: '@project-gateway/artifact-core',
      artifactFileName: 'project-gateway-artifact-core-0.1.0.tgz',
      artifactSha256: null,
      binName: 'project-gateway-mcp',
      dependencies: DEPENDENCY_PINS,
    });
  }
});

test('darwin-arm64 resolves to the SAME historical descriptor — never the macOS fork', () => {
  const result = gatewayDescriptorForLane(DARWIN_ARM64_HOST_LANE);
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.descriptor, HISTORICAL_GATEWAY_DESCRIPTOR, 'arm64 must share the frozen historical descriptor');
    assert.equal(result.descriptor.repository, 'mfx-labs/project-gateway');
    assert.equal(result.descriptor.packageName, '@project-gateway/artifact-core');
    assert.equal(result.descriptor.binName, 'project-gateway-mcp');
    assert.notEqual(result.descriptor, MACOS_INTEL_GATEWAY_DESCRIPTOR, 'arm64 must never resolve to the macOS fork');
  }
});

test('darwin-x86_64 resolves ONLY to the macOS fork descriptor', () => {
  const result = gatewayDescriptorForLane(DARWIN_X86_64_HOST_LANE);
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.descriptor, MACOS_INTEL_GATEWAY_DESCRIPTOR);
    assert.deepEqual({ ...result.descriptor, dependencies: { ...result.descriptor.dependencies } }, {
      repository: 'mfx-labs/project-gateway-macos',
      commit: 'a90284b06420effb1ec1eeef14e7ed82e02c64e9',
      version: '0.1.0',
      packageName: '@project-gateway/macos-core',
      artifactFileName: 'project-gateway-macos-core-0.1.0.tgz',
      artifactSha256: null,
      binName: 'project-gateway-macos-mcp',
      dependencies: DEPENDENCY_PINS,
    });
    assert.notEqual(result.descriptor, HISTORICAL_GATEWAY_DESCRIPTOR, 'Intel must never resolve to the historical descriptor');
  }
});

test('selector fails closed for unbound lanes — never falls back', () => {
  for (const lane of ['win32-x64', 'macos-x86_64', 'darwin-x64', 'linux-x86_64', 'darwin-ia32', '']) {
    const result = gatewayDescriptorForLane(lane);
    assert.equal(result.ok, false, `lane ${JSON.stringify(lane)} must be refused`);
    if (!result.ok) assert.equal(result.code, 'ERR-MANIFEST-NO-GATEWAY-LANE', `lane ${JSON.stringify(lane)}`);
  }
});

test('descriptor validation rejects missing or malformed mandatory fields', () => {
  const base = { ...HISTORICAL_GATEWAY_DESCRIPTOR } as Record<string, unknown>;
  assert.equal(isValidGatewayLaneDescriptor(base), true, 'a complete descriptor is valid');
  for (const key of ['repository', 'commit', 'version', 'packageName', 'artifactFileName', 'artifactSha256', 'binName', 'dependencies']) {
    const missing = { ...base };
    delete missing[key];
    assert.equal(isValidGatewayLaneDescriptor(missing), false, `missing mandatory field: ${key}`);
  }
  assert.equal(isValidGatewayLaneDescriptor(null), false);
  assert.equal(isValidGatewayLaneDescriptor('not-an-object'), false);
  assert.equal(isValidGatewayLaneDescriptor([]), false, 'a top-level array is never a descriptor');
  assert.equal(isValidGatewayLaneDescriptor({}), false);
  assert.equal(isValidGatewayLaneDescriptor({ ...base, repository: '' }), false, 'empty repository refused');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, commit: '55f7642' }), false, 'short commit refused');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, commit: 'z5f764290a4567a20557f1db19d2a6fb97572a97' }), false, 'non-hex commit refused');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, artifactSha256: 'abcd' }), false, 'malformed sha256 refused');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, artifactSha256: 'a'.repeat(64) }), true, 'well-formed sha256 accepted');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, binName: '' }), false, 'empty binName refused');
});

test('descriptor contract is exactly eight own enumerable fields — extra fields refused', () => {
  const base = { ...HISTORICAL_GATEWAY_DESCRIPTOR } as Record<string, unknown>;
  assert.equal(Object.keys(base).length, 8, 'a valid descriptor has exactly eight own enumerable fields');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, extraTopLevel: 'x' }), false, 'unexpected extra top-level field refused');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, artifactSha256: null, extra: null }), false, 'extra null field refused');
});

test('dependencies validation: plain non-array object with exactly the expected pins', () => {
  const base = { ...HISTORICAL_GATEWAY_DESCRIPTOR } as Record<string, unknown>;
  assert.equal(isValidGatewayLaneDescriptor({ ...base, dependencies: ['1.2.3'] }), false, 'dependencies array refused (typeof [] === "object" does not pass)');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, dependencies: 'ajv' }), false, 'dependencies string refused');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, dependencies: null }), false, 'dependencies null refused');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, dependencies: { 'ajv': '8.20.0' } }), false, 'missing required pins refused');
  assert.equal(isValidGatewayLaneDescriptor({
    ...base,
    dependencies: { '@modelcontextprotocol/server': '2.0.0', 'ajv': '8.20.0', 'zod': '4.4.3', 'unexpected-pkg': '1.0.0' },
  }), false, 'unexpected dependency key refused');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, dependencies: { '@modelcontextprotocol/server': '2.0.0', 'ajv': '8.20.0', 'zod': '' } }), false, 'empty dependency pin refused');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, dependencies: { '@modelcontextprotocol/server': '2.0.0', 'ajv': '8.20.0', 'zod': '4.4.3' } }), true, 'exact pinned dependencies accepted');
  assert.equal(isValidGatewayLaneDescriptor({ ...base, dependencies: { '@modelcontextprotocol/server': '2.0.0', 'ajv': '8.20.0', 'zod': '4.4.9' } }), true, 'non-empty non-pinned version accepted (string shape, not equality)');
});

test('nested dependency state remains frozen', () => {
  assert.ok(Object.isFrozen(HISTORICAL_GATEWAY_DESCRIPTOR.dependencies), 'historical descriptor dependencies must be frozen');
  assert.ok(Object.isFrozen(MACOS_INTEL_GATEWAY_DESCRIPTOR.dependencies), 'Intel fork descriptor dependencies must be frozen');
  assert.ok(Object.isFrozen(GATEWAY_DEPENDENCY_PACKAGES), 'dependency package name list must be frozen');
  assert.deepEqual([...GATEWAY_DEPENDENCY_PACKAGES].sort(), ['@modelcontextprotocol/server', 'ajv', 'zod'].sort());
});

test('artifactSha256 null means not yet release-materialized — identity claim only', () => {
  assert.equal(HISTORICAL_GATEWAY_DESCRIPTOR.artifactSha256, null);
  assert.equal(MACOS_INTEL_GATEWAY_DESCRIPTOR.artifactSha256, null);
  assert.equal(COMPATIBILITY_MANIFEST.gatewayArtifactSha256, null);
});

test('transitional legacy aliases derive from the historical descriptor with the old pin values', () => {
  assert.equal(GATEWAY_PACKAGE_VERSION, HISTORICAL_GATEWAY_DESCRIPTOR.version);
  assert.equal(GATEWAY_PACKAGE_VERSION, '0.1.0');
  assert.equal(GATEWAY_PS1_BASELINE_COMMIT, HISTORICAL_GATEWAY_DESCRIPTOR.commit);
  assert.equal(GATEWAY_PS1_BASELINE_COMMIT, '55f764290a4567a20557f1db19d2a6fb97572a97');
  assert.equal(COMPATIBILITY_MANIFEST.gateway, HISTORICAL_GATEWAY_DESCRIPTOR.version);
  assert.equal(COMPATIBILITY_MANIFEST.gatewayCommit, HISTORICAL_GATEWAY_DESCRIPTOR.commit);
  assert.equal(COMPATIBILITY_MANIFEST.gatewayDependencies, HISTORICAL_GATEWAY_DESCRIPTOR.dependencies);
});

test('the closed manifest exposes the descriptor map as the lane-selection authority', () => {
  assert.equal(COMPATIBILITY_MANIFEST.gatewayLanes, GATEWAY_LANE_DESCRIPTORS);
  assert.equal(COMPATIBILITY_MANIFEST.gatewayLanes[LINUX_HOST_LANE], HISTORICAL_GATEWAY_DESCRIPTOR);
  assert.equal(COMPATIBILITY_MANIFEST.gatewayLanes[DARWIN_ARM64_HOST_LANE], HISTORICAL_GATEWAY_DESCRIPTOR);
  assert.equal(COMPATIBILITY_MANIFEST.gatewayLanes[DARWIN_X86_64_HOST_LANE], MACOS_INTEL_GATEWAY_DESCRIPTOR);
  // Support claims unchanged by A: v0.1.0 Linux-only; darwin lanes gated.
  assert.deepEqual([...COMPATIBILITY_MANIFEST.supportedLanes], [LINUX_HOST_LANE]);
  assert.deepEqual([...COMPATIBILITY_MANIFEST.gatedLanes], [DARWIN_ARM64_HOST_LANE, DARWIN_X86_64_HOST_LANE]);
});
