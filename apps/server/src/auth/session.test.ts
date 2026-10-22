import { describe, expect, it } from 'vitest';
import { SessionService, type SessionPayload } from './session.js';

const payload: SessionPayload = {
  sub: 'user-1',
  email: 'alice@example.test',
  displayName: 'Alice',
  roles: ['editor'],
  authSource: 'local',
};

describe('SessionService', () => {
  it('issues a token that verifies back to the original payload', async () => {
    const service = new SessionService('a-very-long-test-secret-key-value', 8);
    const token = await service.issue(payload);
    const verified = await service.verify(token);
    expect(verified).toEqual(payload);
  });

  it('rejects a token signed with a different secret', async () => {
    const issuer = new SessionService('secret-one-secret-one-secret-one', 8);
    const verifier = new SessionService('secret-two-secret-two-secret-two', 8);
    const token = await issuer.issue(payload);
    await expect(verifier.verify(token)).resolves.toBeUndefined();
  });

  it('rejects a garbage token instead of throwing', async () => {
    const service = new SessionService('a-very-long-test-secret-key-value', 8);
    await expect(service.verify('not-a-jwt')).resolves.toBeUndefined();
  });

  it('rejects an expired token', async () => {
    const service = new SessionService('a-very-long-test-secret-key-value', -1);
    const token = await service.issue(payload);
    await expect(service.verify(token)).resolves.toBeUndefined();
  });

  it('defaults roles/authSource when absent from the token claims', async () => {
    const service = new SessionService('a-very-long-test-secret-key-value', 8);
    const token = await service.issue({ ...payload, roles: [], authSource: 'oidc' });
    const verified = await service.verify(token);
    expect(verified?.roles).toEqual([]);
    expect(verified?.authSource).toBe('oidc');
  });
});
