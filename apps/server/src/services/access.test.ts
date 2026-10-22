import { describe, expect, it } from 'vitest';
import { hasProjectAccess, isProjectCreator } from './access.js';

const project = { createdById: 'creator-1', members: [{ userId: 'member-1' }, { userId: 'member-2' }] };

describe('hasProjectAccess', () => {
  it('grants access to the creator', () => {
    expect(hasProjectAccess(project, 'creator-1', false)).toBe(true);
  });

  it('grants access to a member', () => {
    expect(hasProjectAccess(project, 'member-1', false)).toBe(true);
    expect(hasProjectAccess(project, 'member-2', false)).toBe(true);
  });

  it('denies access to a stranger', () => {
    expect(hasProjectAccess(project, 'stranger', false)).toBe(false);
  });

  it('always grants access to an admin, even a stranger', () => {
    expect(hasProjectAccess(project, 'stranger', true)).toBe(true);
  });

  it('does not treat an empty members list as open access', () => {
    expect(hasProjectAccess({ createdById: 'creator-1', members: [] }, 'anyone', false)).toBe(false);
  });
});

describe('isProjectCreator', () => {
  it('is true only for the creator or an admin', () => {
    expect(isProjectCreator(project, 'creator-1', false)).toBe(true);
    expect(isProjectCreator(project, 'stranger', true)).toBe(true);
  });

  it('is false for a mere member', () => {
    expect(isProjectCreator(project, 'member-1', false)).toBe(false);
  });
});
