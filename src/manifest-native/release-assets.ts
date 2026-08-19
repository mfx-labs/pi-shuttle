/**
 * Manifest-native flat release-asset naming contract (PUBLICATION-LAYOUT
 * correction). GitHub Release assets cannot represent slash-bearing names,
 * so every Gateway signed-metadata document is published as ONE flat
 * release-asset filename under the release tag. These file names are
 * TRANSPORT representation only and carry no authority: releaseId and
 * releaseManifestSha256 remain authenticated values that arrived through
 * the signed channel/manifest protocol, and the canonical keyring/channel
 * names are compiled stable policy. Pure derivation; fails closed.
 */
import { RELEASE_FILE_NAME_RE } from '../installer/release/document.js';
import { RELEASE_ID_RE, SHA256_HEX_RE } from './paths.js';

/** Flat release-asset name for the signed root keyring (stable policy). */
export const GATEWAY_META_KEYRING_ASSET = 'gateway-meta-keyring.json';
/** Flat release-asset name for the signed stable channel (stable policy). */
export const GATEWAY_META_STABLE_CHANNEL_ASSET = 'gateway-meta-stable-channel.json';
/** Deterministic prefix of the flat release-manifest asset name. */
export const GATEWAY_META_RELEASE_ASSET_PREFIX = 'gateway-meta-release-';

/**
 * Derive the flat release-manifest release-asset file name for an
 * already-validated signed selection:
 * `gateway-meta-release-<releaseId>-<releaseManifestSha256>.json`.
 * Pure; fails closed (returns null) on any non-canonical input. The
 * releaseId grammar and the lowercase 64-hex digest grammar exclude '/',
 * '\', NUL, and dot components, so the result is always exactly ONE safe
 * filename component; it is additionally validated against the shared
 * safe-file-name grammar.
 */
export function releaseManifestAssetName(releaseId: string, releaseManifestSha256: string): string | null {
  if (!RELEASE_ID_RE.test(releaseId)) return null;
  if (!SHA256_HEX_RE.test(releaseManifestSha256)) return null;
  const name = `${GATEWAY_META_RELEASE_ASSET_PREFIX}${releaseId}-${releaseManifestSha256}.json`;
  return RELEASE_FILE_NAME_RE.test(name) ? name : null;
}

/**
 * The complete flat Gateway metadata asset set for a validated release
 * selection: keyring, stable channel, and the derived release manifest.
 * Fails closed (null) whenever the release selection cannot derive a
 * canonical flat release-manifest asset name.
 */
export function flatGatewayMetadataAssets(releaseId: string, releaseManifestSha256: string): Readonly<{ readonly keyring: string; readonly stableChannel: string; readonly releaseManifest: string }> | null {
  const releaseManifest = releaseManifestAssetName(releaseId, releaseManifestSha256);
  if (releaseManifest === null) return null;
  return Object.freeze({
    keyring: GATEWAY_META_KEYRING_ASSET,
    stableChannel: GATEWAY_META_STABLE_CHANNEL_ASSET,
    releaseManifest,
  });
}