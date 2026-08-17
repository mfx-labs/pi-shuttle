/** Latest-channel component acquisition after effective selections are known. */
import { gatewayDescriptorForLane, PI_GUARD_VERSION, PI_SHUTTLE_VERSION } from '../../compat/manifest.js';
import type { InstallerSelections } from '../selection.js';
import { acquireVerifiedFile, releaseBaseUrlFor } from './acquire.js';
import type { AcquireResult, ReleaseFetcher } from './acquire.js';

export const LATEST_PI_GUARD_ARTIFACT = Object.freeze({
  fileName: `pi-guard-${PI_GUARD_VERSION}.tgz`,
  sha256: '057f1b636328e8c77857a4b590d051fcc52c0c9b015ca5dd1a773c21d7d24d01',
});

const LATEST_GATEWAY_DIGESTS: Readonly<Record<string, string>> = Object.freeze({
  'project-gateway-artifact-core-0.1.0.tgz': 'ab765e043ce2892788fb0d9282e57e143ae99c12ab50328363add8459baacde9',
  'project-gateway-macos-core-0.1.0.tgz': '183ded3d1d4ca1870f32207519d0525af93f2cd07102dd86510c472fc77864b2',
});

export type LatestArtifactPlan = {
  readonly gateway: { readonly fileName: string; readonly sha256: string };
  readonly piGuard: typeof LATEST_PI_GUARD_ARTIFACT;
};

export function latestArtifactPlan(lane: string): { readonly ok: true; readonly plan: LatestArtifactPlan } | { readonly ok: false; readonly message: string } {
  const descriptor = gatewayDescriptorForLane(lane);
  if (!descriptor.ok) return { ok: false, message: descriptor.message };
  const sha256 = LATEST_GATEWAY_DIGESTS[descriptor.descriptor.artifactFileName];
  if (sha256 === undefined) return { ok: false, message: `no latest Gateway digest is pinned for artifact ${descriptor.descriptor.artifactFileName}` };
  return {
    ok: true,
    plan: {
      gateway: { fileName: descriptor.descriptor.artifactFileName, sha256 },
      piGuard: LATEST_PI_GUARD_ARTIFACT,
    },
  };
}

export type LatestAcquireResult =
  | { readonly ok: true; readonly artifactDir?: string; readonly gatewaySha256?: string; readonly piGuardSha256?: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

export type LatestFileAcquirer = (baseUrl: string, fileName: string, expectedSha256: string, artifactDir: string, fetcher?: ReleaseFetcher) => Promise<AcquireResult & { readonly path?: string }>;

/** Acquire only selected, platform-relevant latest artifacts. */
export async function acquireLatestArtifacts(
  lane: string,
  selections: InstallerSelections,
  artifactDir: string,
  fetcher?: ReleaseFetcher,
  acquireFile: LatestFileAcquirer = acquireVerifiedFile,
): Promise<LatestAcquireResult> {
  if (!selections.gateway && !selections.piGuard) return { ok: true };
  const plan = latestArtifactPlan(lane);
  if (!plan.ok) return { ok: false, code: 'ERR-LATEST-IDENTITY', message: plan.message };
  const baseUrl = releaseBaseUrlFor(PI_SHUTTLE_VERSION);
  if (selections.gateway) {
    const gateway = await acquireFile(baseUrl, plan.plan.gateway.fileName, plan.plan.gateway.sha256, artifactDir, fetcher);
    if (!gateway.ok) return gateway;
  }
  if (selections.piGuard) {
    const piGuard = await acquireFile(baseUrl, plan.plan.piGuard.fileName, plan.plan.piGuard.sha256, artifactDir, fetcher);
    if (!piGuard.ok) return piGuard;
  }
  return {
    ok: true,
    artifactDir,
    ...(selections.gateway ? { gatewaySha256: plan.plan.gateway.sha256 } : {}),
    ...(selections.piGuard ? { piGuardSha256: plan.plan.piGuard.sha256 } : {}),
  };
}
