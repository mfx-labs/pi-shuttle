/**
 * PS-3 artifact acquisition/integrity model. Local-file artifact source
 * only in this gate; the future remote source is a documented seam that
 * stays DISABLED until official release artifacts/URLs exist (no
 * speculative endpoints, no network).
 *
 * Digest policy (truthful distinction): the release manifest represents
 * official artifact digests as `null` (not yet computed). When an expected
 * digest is provided (release manifest at PS-8, or a local strict
 * verification), a mismatch REFUSES the artifact. When no expected digest
 * is available, the SHA-256 is computed and recorded as a LOCAL verified
 * digest — never presented as an official release digest.
 */
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readJsonFileIfRegular } from './archive.js';

export type ArtifactResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly message: string };

export interface ComponentArtifactSpec {
  /** Expected package name inside the artifact (identity pin). */
  readonly name: string;
  /** Expected package version (exact pin; never ranges). */
  readonly version: string;
  /** Expected artifact file name in the artifact directory. */
  readonly fileName: string;
  /** Optional strict digest expectation (release/local-lane verification). */
  readonly expectedSha256?: string;
}

/** The artifact file path for a component under a local artifact directory. */
export function artifactFilePath(artifactDir: string, spec: ComponentArtifactSpec): string {
  return join(artifactDir, spec.fileName);
}

/** SHA-256 of a file (streamed; bounded memory). */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (d: Buffer) => hash.update(d));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

/** Deterministic byte/inventory digest of an extracted or installed package tree. */
export async function hashPackageTree(packageRoot: string): Promise<ArtifactResult<string>> {
  const entries: Array<{ readonly path: string; readonly type: 'directory' | 'file' }> = [];
  const visit = (path: string): void => {
    const stat = lstatSync(path);
    const rel = relative(packageRoot, path) || '.';
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      entries.push({ path: rel, type: 'directory' });
      for (const name of readdirSync(path).sort()) visit(join(path, name));
      return;
    }
    if (stat.isFile()) {
      entries.push({ path: rel, type: 'file' });
      return;
    }
    throw new Error(`unsupported package entry at ${path}`);
  };
  try {
    visit(packageRoot);
    const digest = createHash('sha256');
    for (const entry of entries) {
      digest.update(`${entry.type}\0${entry.path}\0`);
      if (entry.type === 'file') digest.update(`${await hashFile(join(packageRoot, entry.path))}\0`);
    }
    return { ok: true, value: digest.digest('hex') };
  } catch (err) {
    return { ok: false, code: 'ERR-PS3-PACKAGE-TREE', message: `package tree at ${packageRoot} could not be verified (${(err as Error).message || 'unknown error'})` };
  }
}

export interface VerifiedArtifact {
  readonly path: string;
  readonly sha256: string;
  /** True when the digest was checked against an expected value. */
  readonly digestVerifiedAgainstExpectation: boolean;
}

/** Verify the artifact file exists and its digest (when expected). */
export async function verifyArtifactFile(artifactDir: string, spec: ComponentArtifactSpec): Promise<ArtifactResult<VerifiedArtifact>> {
  const path = artifactFilePath(artifactDir, spec);
  let sha256: string;
  try {
    sha256 = await hashFile(path);
  } catch (err) {
    return { ok: false, code: 'ERR-PS3-ARTIFACT-UNAVAILABLE', message: `artifact ${path} could not be read (${(err as NodeJS.ErrnoException).code ?? 'unknown error'})` };
  }
  if (spec.expectedSha256 !== undefined && sha256 !== spec.expectedSha256) {
    return {
      ok: false,
      code: 'ERR-PS3-ARTIFACT-DIGEST-MISMATCH',
      message: `artifact ${path} digest mismatch: computed ${sha256}, expected ${spec.expectedSha256}`,
    };
  }
  return { ok: true, value: { path, sha256, digestVerifiedAgainstExpectation: spec.expectedSha256 !== undefined } };
}

/**
 * Locate the package root after extraction (npm-pack style `package/`
 * prefix, or bare). Only regular-file `package.json` entries are
 * accepted — a FIFO/symlink/special entry can never be opened
 * (SIR-PS3-001 defense in depth; the structural scan already rejects
 * special members before extraction).
 */
export function findPackageRoot(extractedDir: string): string | null {
  if (readJsonFileIfRegular(join(extractedDir, 'package.json')) !== null) {
    return extractedDir;
  }
  if (readJsonFileIfRegular(join(extractedDir, 'package', 'package.json')) !== null) {
    return join(extractedDir, 'package');
  }
  return null;
}

export interface PackageIdentity {
  readonly name: string;
  readonly version: string;
  /** The declared `bin` map (string or record). */
  readonly bin: Readonly<Record<string, string>>;
}

/** Read + shape-validate package.json identity from an extracted package root. */
export function readPackageIdentity(packageRoot: string): PackageIdentity | null {
  try {
    const text = readJsonFileIfRegular(join(packageRoot, 'package.json'));
    if (text === null) return null;
    const raw = JSON.parse(text) as { name?: unknown; version?: unknown; bin?: unknown };
    if (typeof raw.name !== 'string' || raw.name.length === 0) return null;
    if (typeof raw.version !== 'string' || raw.version.length === 0) return null;
    let bin: Readonly<Record<string, string>> = {};
    if (typeof raw.bin === 'string') {
      bin = { [raw.name]: raw.bin };
    } else if (typeof raw.bin === 'object' && raw.bin !== null) {
      const entries = Object.entries(raw.bin as Record<string, unknown>);
      if (entries.some(([, v]) => typeof v !== 'string')) return null;
      bin = Object.fromEntries(entries) as Readonly<Record<string, string>>;
    }
    return { name: raw.name, version: raw.version, bin };
  } catch {
    return null;
  }
}
