'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, formatDate } from '../../lib/api';
import { useMe } from '../../lib/use-me';

interface ProjectRow {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  campaignCount?: number;
  memberCount?: number;
  createdBy?: { displayName: string; email: string };
}

/** Projects group campaigns and restrict visibility to the creator + members (API/portal only). */
export default function ProjectsPage() {
  const { can } = useMe();
  const [projects, setProjects] = useState<ProjectRow[] | undefined>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState<'create' | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = () => api<ProjectRow[]>('/api/projects').then(setProjects).catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setBusy('create');
    setError(undefined);
    try {
      await api('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, description: description || undefined }),
      });
      setName('');
      setDescription('');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div>
      <h1>Projets</h1>
      <p className="muted">
        Un projet regroupe des campagnes et n&apos;est visible que par son créateur et les
        personnes qu&apos;il y a affectées (le créateur voit et gère toutes les campagnes du
        projet). Une campagne sans projet reste visible par tout le monde, comme aujourd&apos;hui.
      </p>

      {error && <div className="error-box">{error}</div>}

      {can('editor') && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>+ Nouveau projet</h2>
          <label className="field">
            Nom
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Paiements" />
          </label>
          <label className="field">
            Description (optionnel)
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button className="btn primary" onClick={create} disabled={busy !== undefined || !name.trim()}>
            {busy === 'create' ? 'Création…' : 'Créer le projet'}
          </button>
        </div>
      )}

      <div className="card">
        <table className="list">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Créateur</th>
              <th>Campagnes</th>
              <th>Membres</th>
              <th>Modifié</th>
            </tr>
          </thead>
          <tbody>
            {projects?.map((project) => (
              <tr key={project.id}>
                <td>
                  <Link href={`/projects/${project.id}`}>{project.name}</Link>
                  {project.description && <div className="muted">{project.description}</div>}
                </td>
                <td className="muted">{project.createdBy?.displayName ?? '—'}</td>
                <td>{project.campaignCount ?? 0}</td>
                <td>{project.memberCount ?? 0}</td>
                <td className="muted">{formatDate(project.updatedAt)}</td>
              </tr>
            ))}
            {projects?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Aucun projet accessible — vous n&apos;en avez créé aucun et n&apos;avez été
                  affecté à aucun.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
