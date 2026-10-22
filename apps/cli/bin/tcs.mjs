#!/usr/bin/env node
// Boot the TypeScript CLI through the tsx runtime (sources are run directly).
import { register } from 'tsx/esm/api';
register();
await import('../src/index.ts');
