/** Application roles, ordered from least to most privileged. */
export const roles = ['viewer', 'editor', 'admin'] as const;
export type Role = (typeof roles)[number];

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

export function hasRole(userRoles: readonly string[], required: Role): boolean {
  return userRoles.some((r) => ROLE_RANK[r as Role] !== undefined && ROLE_RANK[r as Role] >= ROLE_RANK[required]);
}

export type AuthSource = 'oidc' | 'local';

/** Advertised by `GET /api/auth/methods` so the portal adapts its login form. */
export interface AuthMethods {
  oidc: boolean;
  password: boolean;
  oidcLoginUrl?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
  authSource: AuthSource;
  active: boolean;
}
