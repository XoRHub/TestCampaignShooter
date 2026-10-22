'use client';

import Link from 'next/link';
import { useMe } from '../lib/use-me';
import { api } from '../lib/api';

export function TopNav() {
  const { me, can } = useMe();

  return (
    <nav className="topnav">
      <Link href="/" className="brand">
        🎯 TestCampaignShooter
      </Link>
      <Link href="/">Campagnes</Link>
      {me && <Link href="/projects">Projets</Link>}
      {can('admin') && <Link href="/admin/adapter-manifests">Manifestes</Link>}
      <span className="spacer" />
      {me ? (
        <>
          <span className="who">
            {me.displayName} · {me.roles.join(', ')}
          </span>
          <button
            className="btn small"
            onClick={() => {
              void api('/api/auth/logout', { method: 'POST' }).then(() => {
                window.location.href = '/login';
              });
            }}
          >
            Déconnexion
          </button>
        </>
      ) : (
        <Link href="/login">Connexion</Link>
      )}
    </nav>
  );
}
