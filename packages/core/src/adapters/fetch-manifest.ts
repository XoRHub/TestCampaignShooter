import { createHash } from 'node:crypto';
import { parseAdapterManifest } from './manifest.js';
import type { EngineAdapter } from './types.js';

const MAX_MANIFEST_BYTES = 1_000_000; // plenty for a declarative engine list
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export class ManifestFetchError extends Error {}

export interface FetchedManifest {
  adapters: EngineAdapter[];
  /** sha256 (hex) of the raw manifest content — for audit/reproducibility. */
  hash: string;
}

/**
 * Downloads and parses one adapter manifest. Enforces a fetch timeout and a
 * size cap so a slow/huge remote manifest can't hang a run launch, the
 * server boot, or a CLI invocation. Never executes anything from the
 * manifest — see `parseAdapterManifest` (purely declarative). Shared by
 * `apps/server` (instance + per-campaign manifests) and `apps/cli`
 * (`--adapter-manifest`), which is why it lives here rather than in the
 * server's Prisma-dependent `AdapterManifestService`.
 */
export async function fetchManifest(
  url: string,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<FetchedManifest> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new ManifestFetchError(`cannot reach "${url}": ${(err as Error).message}`);
  }
  if (!response.ok) {
    throw new ManifestFetchError(`"${url}" returned HTTP ${response.status}`);
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_MANIFEST_BYTES) {
    throw new ManifestFetchError(`"${url}" exceeds the ${MAX_MANIFEST_BYTES}-byte manifest size limit`);
  }
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_MANIFEST_BYTES) {
    throw new ManifestFetchError(`"${url}" exceeds the ${MAX_MANIFEST_BYTES}-byte manifest size limit`);
  }
  const adapters = parseAdapterManifest(raw); // throws AdapterManifestParseError on invalid content
  const hash = createHash('sha256').update(raw).digest('hex');
  return { adapters, hash };
}
