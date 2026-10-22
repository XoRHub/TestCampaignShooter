import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdapterManifestParseError } from './manifest.js';
import { fetchManifest, ManifestFetchError } from './fetch-manifest.js';

const VALID_MANIFEST = `
apiVersion: tcs.io/v1
kind: AdapterManifest
engines:
  - engine: playwright
    displayName: Playwright (Node)
    defaultImage: mcr.microsoft.com/playwright:v1.48.0-noble
    defaultJunitPath: results/junit.xml
    defaultCommand: [npx, playwright, test, '{{testFile}}', --reporter=junit]
`;

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'content-type': 'application/yaml' });
      res.end(VALID_MANIFEST);
    } else if (req.url === '/invalid') {
      res.writeHead(200);
      res.end('engines: [{engine: missing-fields}]');
    } else if (req.url === '/not-found') {
      res.writeHead(404);
      res.end('nope');
    } else if (req.url === '/oversized-header') {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(10_000_000) });
      res.end(VALID_MANIFEST); // body itself is small — the header lies, must still be rejected
    } else if (req.url === '/oversized-body') {
      // Multiple writes -> Node uses chunked transfer-encoding, no
      // content-length header — exercises the post-download size check.
      res.writeHead(200);
      for (let i = 0; i < 20; i++) res.write('x'.repeat(100_000));
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('fetchManifest', () => {
  it('fetches, parses and hashes a valid manifest', async () => {
    const { adapters, hash } = await fetchManifest(`${baseUrl}/ok`);
    expect(adapters.map((a) => a.engine)).toEqual(['playwright']);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an unreachable host', async () => {
    await expect(fetchManifest('http://127.0.0.1:1')).rejects.toThrow(ManifestFetchError);
  });

  it('rejects a non-2xx response', async () => {
    await expect(fetchManifest(`${baseUrl}/not-found`)).rejects.toThrow(/HTTP 404/);
  });

  it('propagates manifest validation errors', async () => {
    await expect(fetchManifest(`${baseUrl}/invalid`)).rejects.toThrow(AdapterManifestParseError);
  });

  it('rejects an oversized manifest based on the content-length header', async () => {
    await expect(fetchManifest(`${baseUrl}/oversized-header`)).rejects.toThrow(ManifestFetchError);
  });

  it('rejects an oversized manifest served without a content-length header (chunked)', async () => {
    await expect(fetchManifest(`${baseUrl}/oversized-body`)).rejects.toThrow(/size limit/);
  });
});
