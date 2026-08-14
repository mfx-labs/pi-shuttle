/**
 * PS-8A focused tests: release envelope closed-schema validation and
 * exact-pin binding (src/installer/release/envelope.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPATIBILITY_MANIFEST,
  CONFIG_FORMAT_VERSION,
  CONFIGURATION_VERSION,
  GATEWAY_DEPENDENCIES,
  GATEWAY_PACKAGE_VERSION,
  GATEWAY_PS1_BASELINE_COMMIT,
  GIT_LANE_VERSION,
  GIT_RUNTIME_MINIMUM,
  NODE_LANE_VERSION,
  NODE_RUNTIME_MINIMUM,
  PI_COMPATIBILITY_BASELINE,
  PI_GUARD_COMMIT,
  PI_GUARD_TAG,
  PI_GUARD_VERSION,
  PI_RUNTIME_MINIMUM,
  PI_SHUTTLE_VERSION,
} from '../../src/compat/manifest.js';
import { parseEnvelope, validateEnvelope, ENVELOPE_SCHEMA_VERSION, SHA256_HEX_RE, RELEASE_FILE_NAME_RE } from '../../src/installer/release/envelope.js';

const SHA = 'a'.repeat(64);

/** A structurally valid envelope (mutable for mutation tests). */
function validEnvelope(): Record<string, unknown> {
  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    releaseVersion: PI_SHUTTLE_VERSION,
    piShuttle: { version: PI_SHUTTLE_VERSION, fileName: 'pi-shuttle-0.1.0.tgz', sha256: SHA },
    gateway: { packageVersion: GATEWAY_PACKAGE_VERSION, sourceCommit: GATEWAY_PS1_BASELINE_COMMIT, fileName: 'project-gateway-artifact-core-0.1.0.tgz', sha256: SHA },
    piGuard: { version: PI_GUARD_VERSION, sourceCommit: PI_GUARD_COMMIT, sourceTag: PI_GUARD_TAG, fileName: 'pi-guard-0.1.2.tgz', sha256: SHA },
    policy: {
      gatewayDependencies: { ...GATEWAY_DEPENDENCIES },
      configurationVersion: CONFIGURATION_VERSION,
      configFormatVersion: CONFIG_FORMAT_VERSION,
      nodeLaneVersion: NODE_LANE_VERSION,
      gitLaneVersion: GIT_LANE_VERSION,
      nodeRuntimeMinimum: NODE_RUNTIME_MINIMUM,
      gitRuntimeMinimum: GIT_RUNTIME_MINIMUM,
      piCompatibilityBaseline: PI_COMPATIBILITY_BASELINE,
      piRuntimeMinimum: PI_RUNTIME_MINIMUM,
      supportedLanes: [...COMPATIBILITY_MANIFEST.supportedLanes],
    },
  };
}

test('envelope: a structurally valid envelope validates', () => {
  const result = validateEnvelope(validEnvelope());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.schemaVersion, 1);
    assert.equal(result.value.piGuard.sourceTag, PI_GUARD_TAG);
  }
});

test('envelope: valid envelope round-trips through parseEnvelope', () => {
  const result = parseEnvelope(JSON.stringify(validEnvelope()));
  assert.equal(result.ok, true);
});

test('envelope: malformed JSON is refused', () => {
  const result = parseEnvelope('{not json');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'ERR-REL-ENVELOPE-MALFORMED');
});

test('envelope: duplicate JSON keys are refused', () => {
  const base = validEnvelope();
  const text = JSON.stringify(base).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":2');
  const result = parseEnvelope(text);
  assert.equal(result.ok, false);
});

test('envelope: unknown top-level keys are refused (closed schema)', () => {
  const env = validEnvelope();
  (env as Record<string, unknown>)['extra'] = 'x';
  assert.equal(validateEnvelope(env).ok, false);
});

test('envelope: unknown nested keys are refused', () => {
  const env = validEnvelope();
  (env.piShuttle as Record<string, unknown>)['url'] = 'https://evil.example';
  assert.equal(validateEnvelope(env).ok, false);
});

test('envelope: schemaVersion must be 1', () => {
  const env = validEnvelope();
  env.schemaVersion = 2;
  assert.equal(validateEnvelope(env).ok, false);
});

test('envelope: sha256 must be 64 hex characters', () => {
  for (const bad of ['abc', 'a'.repeat(63), 'g'.repeat(64), 'A'.repeat(64), '']) {
    const env = validEnvelope();
    (env.gateway as Record<string, unknown>).sha256 = bad;
    const result = validateEnvelope(env);
    assert.equal(result.ok, false, `sha256 ${JSON.stringify(bad)} must be refused`);
  }
  const ok = validEnvelope();
  (ok.gateway as Record<string, unknown>).sha256 = 'a'.repeat(64).toUpperCase().toLowerCase();
  assert.equal(validateEnvelope(ok).ok, true);
});

test('envelope: file names must be single safe components', () => {
  for (const bad of ['../evil.tgz', 'a/b.tgz', '/abs.tgz', '', 'a b.tgz', '.hidden']) {
    const env = validEnvelope();
    (env.piShuttle as Record<string, unknown>).fileName = bad;
    assert.equal(validateEnvelope(env).ok, false, `file name ${JSON.stringify(bad)} must be refused`);
  }
  assert.equal(RELEASE_FILE_NAME_RE.test('pi-shuttle-0.1.0.tgz'), true);
});

test('envelope: release version must equal the pinned pi-shuttle version', () => {
  const env = validEnvelope();
  env.releaseVersion = '9.9.9';
  const result = validateEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'ERR-REL-ENVELOPE-VERSION');
});

test('envelope: gateway source commit must equal the pinned baseline', () => {
  const env = validEnvelope();
  (env.gateway as Record<string, unknown>).sourceCommit = 'deadbeef'.padEnd(40, '0');
  const result = validateEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'ERR-REL-ENVELOPE-PIN');
});

test('envelope: pi-guard commit and tag must equal the pins', () => {
  const env = validEnvelope();
  (env.piGuard as Record<string, unknown>).sourceTag = 'v9.9.9';
  const result = validateEnvelope(env);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'ERR-REL-ENVELOPE-PIN');
});

test('envelope: gateway dependency set must match exactly (no additions, no drifts)', () => {
  const env = validEnvelope();
  (env.policy as Record<string, unknown>).gatewayDependencies = { ...GATEWAY_DEPENDENCIES, 'extra': '1.0.0' };
  assert.equal(validateEnvelope(env).ok, false);
  const env2 = validEnvelope();
  (env2.policy as Record<string, unknown>).gatewayDependencies = { '@modelcontextprotocol/server': '9.9.9' };
  assert.equal(validateEnvelope(env2).ok, false);
});

test('envelope: supported lanes must equal the manifest lane set (v0.1.0: Linux only)', () => {
  const env = validEnvelope();
  (env.policy as Record<string, unknown>).supportedLanes = [...COMPATIBILITY_MANIFEST.supportedLanes, 'darwin-arm64-posix-utf8-node22'];
  assert.equal(validateEnvelope(env).ok, false, 'a darwin lane addition must not validate against the Linux-only manifest');
  const env2 = validEnvelope();
  (env2.policy as Record<string, unknown>).supportedLanes = [...COMPATIBILITY_MANIFEST.supportedLanes, 'windows-x86_64'];
  assert.equal(validateEnvelope(env2).ok, false);
  // The exact v0.1.0 lane set (Linux only) validates:
  const env3 = validEnvelope();
  (env3.policy as Record<string, unknown>).supportedLanes = ['linux-x86_64-posix-utf8-node22'];
  assert.equal(validateEnvelope(env3).ok, true, 'the Linux-only lane set equals the v0.1.0 manifest claim');
});

test('envelope: policy facts must equal the runtime compatibility manifest', () => {
  const env = validEnvelope();
  (env.policy as Record<string, unknown>).nodeRuntimeMinimum = '1.0.0';
  assert.equal(validateEnvelope(env).ok, false);
  const env2 = validEnvelope();
  (env2.policy as Record<string, unknown>).configFormatVersion = 2;
  assert.equal(validateEnvelope(env2).ok, false);
  const env3 = validEnvelope();
  (env3.policy as Record<string, unknown>).piCompatibilityBaseline = '0.99.0';
  assert.equal(validateEnvelope(env3).ok, false);
});

test('envelope: missing policy keys are refused', () => {
  const env = validEnvelope();
  delete (env.policy as Record<string, unknown>).supportedLanes;
  assert.equal(validateEnvelope(env).ok, false);
});

test('envelope: wrong value types are refused', () => {
  const env = validEnvelope();
  env.releaseVersion = 42;
  assert.equal(validateEnvelope(env).ok, false);
  const env2 = validEnvelope();
  (env2.piGuard as Record<string, unknown>).sourceTag = null;
  assert.equal(validateEnvelope(env2).ok, false);
  const env3 = validEnvelope();
  env3.policy = ['not', 'an', 'object'];
  assert.equal(validateEnvelope(env3).ok, false);
});

test('envelope: sha256 and file-name grammars are exported and closed', () => {
  assert.equal(SHA256_HEX_RE.test(SHA), true);
  assert.equal(RELEASE_FILE_NAME_RE.test('a'), true);
  assert.equal(RELEASE_FILE_NAME_RE.test('a/b'), false);
  assert.equal(RELEASE_FILE_NAME_RE.test('..'), false);
  assert.equal(RELEASE_FILE_NAME_RE.test('a..b'), true);
  assert.equal(RELEASE_FILE_NAME_RE.test('.a'), false);
});
