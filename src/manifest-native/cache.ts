/**
 * Manifest-native signed selection-chain cache Schema 1 (NEW-STATE
 * Slice A). The cache stores the COMPLETE signed documents as embedded
 * JSON text so the installed-evidence verifier re-parses the exact bytes
 * (text-level duplicate-key rejection and signature verification stay
 * possible; embedding parsed objects would silently collapse duplicate
 * keys and destroy tamper evidence).
 *
 * The cache is content-derived: its identity is the verified
 * (releaseId, releaseManifestSha256) pair and its canonical location is
 * manifests/<releaseId>/<releaseManifestSha256>.json — no path is stored
 * inside the cache or accepted from caller input. Publication is NOT
 * wired into production fresh install in this slice.
 */
import { parseJsonRejectingDuplicates } from '../config/json.js';
import { canonicalizeJcs } from '../installer/release/trust.js';
import type { VerifiedInstalledEvidence } from '../installer/release/trust.js';
import { RELEASE_ID_RE, SHA256_HEX_RE } from './paths.js';

export const CACHE_SCHEMA_VERSION = 1;
/** Cache document byte ceiling: 200 KiB. */
export const MAX_CACHE_BYTES = 200 * 1024;

const parsedCacheType: unique symbol = Symbol('ParsedManifestNativeCache');

/**
 * Cache document shape used by the serializer (and produced by parsing).
 * The parsed brand adds runtime provenance on top of this shape.
 */
export interface ManifestNativeCacheDocument {
  readonly cacheSchemaVersion: 1;
  readonly keyringText: string;
  readonly channelText: string;
  readonly releaseManifestText: string;
}

/** A parsed Schema-1 selection-chain cache (envelope only; not yet verified). */
export interface ParsedManifestNativeCache extends ManifestNativeCacheDocument {
  readonly [parsedCacheType]: true;
}

export type CacheResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly message: string };

const CACHE_KEYS: readonly string[] = ['cacheSchemaVersion', 'keyring', 'channel', 'releaseManifest'];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse the cache envelope; each embedded signed document must be valid JSON text. */
export function parseManifestNativeCache(text: string): CacheResult<ParsedManifestNativeCache> {
  if (Buffer.byteLength(text, 'utf8') > MAX_CACHE_BYTES) {
    return { ok: false, code: 'ERR-MN-CACHE-SIZE', message: `cache exceeds the ${MAX_CACHE_BYTES}-byte ceiling` };
  }
  const parsed = parseJsonRejectingDuplicates(text);
  if (!parsed.ok) {
    return { ok: false, code: parsed.message.startsWith('duplicate object key') ? 'ERR-MN-CACHE-DUPLICATE-KEY' : 'ERR-MN-CACHE-JSON', message: parsed.message };
  }
  if (!isRecord(parsed.value) || !Object.keys(parsed.value).every((key) => CACHE_KEYS.includes(key))) {
    return { ok: false, code: 'ERR-MN-CACHE-SCHEMA', message: 'cache has unknown fields or is not an object' };
  }
  if (parsed.value['cacheSchemaVersion'] !== CACHE_SCHEMA_VERSION) {
    return { ok: false, code: 'ERR-MN-CACHE-SCHEMA', message: `cache cacheSchemaVersion must be exactly ${CACHE_SCHEMA_VERSION}` };
  }
  const documents: Array<{ readonly name: string; readonly text: unknown }> = [
    { name: 'keyring', text: parsed.value['keyring'] },
    { name: 'channel', text: parsed.value['channel'] },
    { name: 'releaseManifest', text: parsed.value['releaseManifest'] },
  ];
  for (const document of documents) {
    if (typeof document.text !== 'string' || document.text.length === 0) {
      return { ok: false, code: 'ERR-MN-CACHE-SCHEMA', message: `cache.${document.name} must be a non-empty JSON text string` };
    }
    const docParse = parseJsonRejectingDuplicates(document.text);
    if (!docParse.ok || !isRecord(docParse.value)) {
      return { ok: false, code: 'ERR-MN-CACHE-SCHEMA', message: `cache.${document.name} is not valid JSON text` };
    }
  }
  const value = Object.freeze({
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    keyringText: documents[0]!.text as string,
    channelText: documents[1]!.text as string,
    releaseManifestText: documents[2]!.text as string,
  }) as ParsedManifestNativeCache;
  return { ok: true, value };
}

/** Deterministic canonical serialization (single trailing newline). */
export function serializeManifestNativeCache(cache: ManifestNativeCacheDocument): string {
  return `${canonicalizeJcs({
    cacheSchemaVersion: cache.cacheSchemaVersion,
    keyring: cache.keyringText,
    channel: cache.channelText,
    releaseManifest: cache.releaseManifestText,
  })}\n`;
}

export type CacheIdentity = { readonly releaseId: string; readonly releaseManifestSha256: string };

/**
 * Immutable cache identity from an installed-evidence-verified selection:
 * the (releaseId, releaseManifestSha256) pair that names the canonical
 * cache path. Only ever computed from verified content.
 */
export function cacheIdentityFromVerifiedSelection(selection: VerifiedInstalledEvidence): CacheIdentity {
  return Object.freeze({
    releaseId: selection.channel.releaseId,
    releaseManifestSha256: selection.releaseManifestSha256,
  });
}

/** Grammar guard for cache-path identity components (fail closed). */
export function isCanonicalCacheIdentity(releaseId: string, releaseManifestSha256: string): boolean {
  return RELEASE_ID_RE.test(releaseId) && SHA256_HEX_RE.test(releaseManifestSha256);
}
