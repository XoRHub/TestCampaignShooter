import * as oidc from 'openid-client';
import type { Role } from '@tcs/shared-types';
import { roles as knownRoles } from '@tcs/shared-types';
import type { AppConfig } from '../config.js';

export interface OidcService {
  buildLoginUrl(state: string, nonce: string): string;
  handleCallback(
    currentUrl: URL,
    expectedState: string,
    expectedNonce: string,
  ): Promise<{ subject: string; email: string; displayName: string; roles: Role[] }>;
}

/** Extracts application roles from a claims object (claim path configurable). */
export function rolesFromClaims(claims: Record<string, unknown>, claimPath: string): Role[] {
  let value: unknown = claims;
  for (const segment of claimPath.split('.')) {
    if (value === null || typeof value !== 'object') return [];
    value = (value as Record<string, unknown>)[segment];
  }
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is Role => (knownRoles as readonly string[]).includes(r as string));
}

export async function createOidcService(config: AppConfig): Promise<OidcService> {
  const discovered = await oidc.discovery(
    new URL(config.OIDC_ISSUER!),
    config.OIDC_CLIENT_ID!,
    config.OIDC_CLIENT_SECRET,
  );
  const redirectUri = `${config.PUBLIC_BASE_URL}/api/auth/oidc/callback`;

  return {
    buildLoginUrl(state, nonce) {
      return oidc
        .buildAuthorizationUrl(discovered, {
          redirect_uri: redirectUri,
          scope: config.OIDC_SCOPES,
          state,
          nonce,
        })
        .toString();
    },

    async handleCallback(currentUrl, expectedState, expectedNonce) {
      const tokens = await oidc.authorizationCodeGrant(discovered, currentUrl, {
        expectedState,
        expectedNonce,
      });
      const claims = tokens.claims();
      if (!claims?.sub) throw new Error('OIDC callback: missing "sub" claim');
      const email = String(claims.email ?? `${claims.sub}@oidc.local`);
      const displayName = String(claims.name ?? claims.preferred_username ?? email);
      return {
        subject: String(claims.sub),
        email,
        displayName,
        roles: rolesFromClaims(claims as Record<string, unknown>, config.OIDC_ROLES_CLAIM),
      };
    },
  };
}
