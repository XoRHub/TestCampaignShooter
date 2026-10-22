'use client';

import { useEffect, useState } from 'react';
import { api, formatDate } from '../../../lib/api';
import { useMe } from '../../../lib/use-me';

interface AdapterManifestRow {
  id: string;
  url: string;
  enabled: boolean;
  lastFetchedAt?: string | null;
  lastHash?: string | null;
  lastError?: string | null;
  createdAt: string;
}

/**
 * Instance-level adapter manifests (docs/adapter-plugins.md §4/§7) — admin
 * only: a manifest's engines can run via the `local` process provider, i.e.
 * execute arbitrary commands on the server host.
 */
export default function AdapterManifestsPage() {
  const { can, loading: meLoading } = useMe();
  const [manifests, setManifests] = useState<AdapterManifestRow[] | undefined>();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<'add' | 'reload' | string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = () =>
    api<AdapterManifestRow[]>('/api/admin/adapter-manifests')
      .then(setManifests)
      .catch((err) => setError((err as Error).message));

  // Re-runs once `me` resolves (loading -> known roles).
  useEffect(() => {
    if (can('admin')) load();
  }, [meLoading]);

  const add = async () => {
    if (!url.trim()) return;
    setBusy('add');
    setError(undefined);
    try {
      await api('/api/admin/adapter-manifests', { method: 'POST', body: JSON.stringify({ url }) });
      setUrl('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    setError(undefined);
    try {
      await api(`/api/admin/adapter-manifests/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const reload = async () => {
    setBusy('reload');
    setError(undefined);
    try {
      setManifests(
        await api<AdapterManifestRow[]>('/api/admin/adapter-manifests/reload', { method: 'POST' }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  if (meLoading) return <p className="muted">Chargement…</p>;
  if (!can('admin')) {
    return <div className="error-box">Réservé aux administrateurs.</div>;
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Manifestes d&apos;adaptateurs (instance)</h1>
        <button className="btn" onClick={reload} disabled={busy !== undefined}>
          {busy === 'reload' ? 'Rechargement…' : '↻ Recharger tout'}
        </button>
      </div>
      <p className="muted">
        Étend/surcharge les moteurs de test pour <strong>toute l&apos;instance</strong>, sans
        redémarrage. Pour une surcharge propre à une seule campagne, utilisez le champ « Manifeste
        d&apos;adaptateurs » de son formulaire. Détails : docs/adapter-plugins.md.
      </p>

      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <div className="row">
          <input
            style={{ flex: 1 }}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/adapters/manifest.yaml"
          />
          <button
            className="btn primary"
            onClick={add}
            disabled={busy !== undefined || !url.trim()}
          >
            {busy === 'add' ? 'Ajout…' : '+ Ajouter'}
          </button>
        </div>
      </div>

      <div className="card">
        <table className="list">
          <thead>
            <tr>
              <th>URL</th>
              <th>Dernier fetch</th>
              <th>Hash</th>
              <th>Erreur</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {manifests?.map((m) => (
              <tr key={m.id}>
                <td>
                  <code className="chip">{m.url}</code>
                </td>
                <td className="muted">{formatDate(m.lastFetchedAt)}</td>
                <td className="muted">{m.lastHash ? `${m.lastHash.slice(0, 12)}…` : '—'}</td>
                <td>
                  {m.lastError ? (
                    <span className="badge bad">{m.lastError}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <button
                    className="btn danger small"
                    onClick={() => remove(m.id)}
                    disabled={busy !== undefined}
                  >
                    {busy === m.id ? '…' : 'Supprimer'}
                  </button>
                </td>
              </tr>
            ))}
            {manifests?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Aucun manifeste d&apos;instance — les moteurs built-in restent disponibles.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
