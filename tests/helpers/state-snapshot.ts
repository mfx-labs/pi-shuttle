import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { join } from 'node:path';

type ObjectType = 'missing' | 'file' | 'directory' | 'symlink' | 'fifo' | 'socket' | 'character-device' | 'block-device' | 'other';

interface SnapshotEntry {
  readonly relativePath: string;
  readonly type: Exclude<ObjectType, 'missing'>;
  readonly symlinkTarget: string | null;
  readonly sha256: string | null;
}

export interface RecursivePathSnapshot {
  readonly label: string;
  readonly path: string;
  readonly exists: boolean;
  readonly type: ObjectType;
  readonly symlinkTarget: string | null;
  readonly inventory: readonly string[];
  readonly entries: readonly SnapshotEntry[];
}

function objectType(stat: Stats): Exclude<ObjectType, 'missing'> {
  if (stat.isFile()) return 'file';
  if (stat.isDirectory()) return 'directory';
  if (stat.isSymbolicLink()) return 'symlink';
  if (stat.isFIFO()) return 'fifo';
  if (stat.isSocket()) return 'socket';
  if (stat.isCharacterDevice()) return 'character-device';
  if (stat.isBlockDevice()) return 'block-device';
  return 'other';
}

/** Test-only, deterministic, non-following recursive state snapshot. */
export function recursiveStateSnapshot(paths: Readonly<Record<string, string>>): readonly RecursivePathSnapshot[] {
  return Object.entries(paths).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([label, path]) => {
    let root: Stats;
    try {
      root = lstatSync(path);
    } catch (err) {
      if (['ENOENT', 'ENOTDIR'].includes((err as NodeJS.ErrnoException).code ?? '')) {
        return { label, path, exists: false, type: 'missing', symlinkTarget: null, inventory: [], entries: [] };
      }
      throw err;
    }

    const entries: SnapshotEntry[] = [];
    const visit = (candidate: string, relativePath: string): void => {
      const stat = lstatSync(candidate);
      const type = objectType(stat);
      entries.push({
        relativePath,
        type,
        symlinkTarget: type === 'symlink' ? readlinkSync(candidate) : null,
        sha256: type === 'file' ? createHash('sha256').update(readFileSync(candidate)).digest('hex') : null,
      });
      if (type === 'directory') {
        for (const name of readdirSync(candidate).sort()) visit(join(candidate, name), relativePath === '.' ? name : join(relativePath, name));
      }
    };
    visit(path, '.');
    entries.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
    return {
      label,
      path,
      exists: true,
      type: objectType(root),
      symlinkTarget: root.isSymbolicLink() ? readlinkSync(path) : null,
      inventory: entries.map((entry) => entry.relativePath),
      entries,
    };
  });
}
