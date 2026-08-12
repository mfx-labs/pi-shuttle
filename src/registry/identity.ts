/**
 * Deterministic project identity derivation (PS-2, approved ownership:
 * work-packages PS-2 "identity derivation helpers"; operator-cli-contract §3).
 *
 * The input MUST be the canonical project root (symlink-resolved) — PS-4
 * canonicalizes operator input through the host seam before derivation.
 * These are pi-shuttle's OWN path-derived opaque identifiers:
 *   workspaceId = "pgw:w:" + sha256(canonicalRoot).hex.slice(0, 32)
 *   storeId     = sha256(canonicalRoot).hex.slice(0, 32)
 *   locator     = <shareDir>/stores/<storeId>
 *
 * This is NOT the Gateway WP-6 configuration identity: that identity is
 * derived ONLY inside the Gateway `bootstrap` verb from the validated
 * trusted configuration (PS-1 baseline 7f3b4af...). pi-shuttle never
 * computes, invents, or verifies trusted configuration identity.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Deterministic store id (32 hex chars = first half of the SHA-256 of the canonical root). */
export function deriveStoreId(canonicalRoot: string): string {
  return createHash('sha256').update(canonicalRoot, 'utf8').digest('hex').slice(0, 32);
}

/** Deterministic workspace id (`pgw:w:` + store id). */
export function deriveWorkspaceId(canonicalRoot: string): string {
  return `pgw:w:${deriveStoreId(canonicalRoot)}`;
}

/** Deterministic trusted-store parent locator (approved layout: share/stores/<storeId>). */
export function deriveStoreLocator(shareDir: string, canonicalRoot: string): string {
  return join(shareDir, 'stores', deriveStoreId(canonicalRoot));
}
