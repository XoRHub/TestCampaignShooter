import { SignJWT, jwtVerify } from 'jose';
import type { Role, AuthSource } from '@tcs/shared-types';

export interface SessionPayload {
  sub: string;
  email: string;
  displayName: string;
  roles: Role[];
  authSource: AuthSource;
}

export const SESSION_COOKIE = 'tcs_session';

export class SessionService {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlHours: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async issue(payload: SessionPayload): Promise<string> {
    return new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(payload.sub)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlHours}h`)
      .sign(this.key);
  }

  async verify(token: string): Promise<SessionPayload | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.key);
      return {
        sub: String(payload.sub),
        email: String(payload.email),
        displayName: String(payload.displayName),
        roles: (payload.roles as Role[]) ?? [],
        authSource: (payload.authSource as AuthSource) ?? 'local',
      };
    } catch {
      return undefined;
    }
  }
}
