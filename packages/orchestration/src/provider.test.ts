import { describe, expect, it } from 'vitest';
import type { OrchestrationProvider } from './provider.js';
import { createProvider, listProviderNames, registerProviderFactory } from './provider.js';

function fakeProvider(name: string): OrchestrationProvider {
  return {
    name,
    submit: async () => ({ provider: name, externalId: 'x' }),
    watch: async () => {},
    getState: async () => ({ run: {} as never, tests: [] }),
    retryFailed: async (handle) => handle,
    cancel: async () => {},
    getLogs: async () => '',
    getArtifacts: async () => [],
  };
}

describe('orchestration provider registry', () => {
  it('starts empty', () => {
    expect(listProviderNames()).toEqual([]);
  });

  it('registers a factory and instantiates it by name', () => {
    registerProviderFactory('fake-a', () => fakeProvider('fake-a'));
    const provider = createProvider('fake-a', {});
    expect(provider.name).toBe('fake-a');
  });

  it('passes the given config through to the factory', () => {
    let received: Record<string, string | undefined> | undefined;
    registerProviderFactory('fake-b', (config) => {
      received = config;
      return fakeProvider('fake-b');
    });
    createProvider('fake-b', { FOO: 'bar' });
    expect(received).toEqual({ FOO: 'bar' });
  });

  it('rejects registering the same provider name twice', () => {
    registerProviderFactory('fake-c', () => fakeProvider('fake-c'));
    expect(() => registerProviderFactory('fake-c', () => fakeProvider('fake-c'))).toThrow(
      /already registered/,
    );
  });

  it('lists registered provider names sorted alphabetically', () => {
    expect(listProviderNames()).toEqual(['fake-a', 'fake-b', 'fake-c']);
  });

  it('throws a clear error for an unknown provider name', () => {
    expect(() => createProvider('nope', {})).toThrow(/Unknown orchestration provider "nope"/);
    expect(() => createProvider('nope', {})).toThrow(/fake-a/);
  });
});
