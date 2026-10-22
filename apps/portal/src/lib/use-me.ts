'use client';

import { useEffect, useState } from 'react';
import { hasRole, type Role, type UserProfile } from '@tcs/shared-types';
import { api } from './api';

type Me = Pick<UserProfile, 'email' | 'displayName' | 'roles'> & { sub: string };

export function useMe(): { me: Me | undefined; loading: boolean; can: (role: Role) => boolean } {
  const [me, setMe] = useState<Me | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Me>('/api/auth/me')
      .then(setMe)
      .catch(() => setMe(undefined))
      .finally(() => setLoading(false));
  }, []);

  return { me, loading, can: (role) => (me ? hasRole(me.roles, role) : false) };
}
