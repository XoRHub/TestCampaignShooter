'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthMethods } from '@tcs/shared-types';
import { API_URL, api } from '../../lib/api';

/** Login page — adapts to whichever auth methods the server has enabled. */
export default function LoginPage() {
  const router = useRouter();
  const [methods, setMethods] = useState<AuthMethods | undefined>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<AuthMethods>('/api/auth/methods').then(setMethods).catch(() => setMethods(undefined));
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      router.push('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 380, margin: '60px auto' }}>
      <h1>Connexion</h1>
      {!methods && <p className="muted">Chargement des méthodes d&apos;authentification…</p>}

      {methods?.oidc && (
        <div className="card">
          <a className="btn primary" href={`${API_URL}${methods.oidcLoginUrl}`}>
            Se connecter avec le SSO (OIDC)
          </a>
        </div>
      )}

      {methods?.password && (
        <form className="card" onSubmit={submit}>
          <label className="field">
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="field">
            Mot de passe
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <div className="error-box">{error}</div>}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      )}

      {methods && !methods.password && !methods.oidc && (
        <div className="error-box">Aucune méthode d&apos;authentification n&apos;est activée côté serveur.</div>
      )}
    </div>
  );
}
