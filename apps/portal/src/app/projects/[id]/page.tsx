'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatDate } from '../../../lib/api';
import { useMe } from '../../../lib/use-me';

interface ProjectDetail {
  id: string;
  name: string;
  description?: string;
  deletedAt?: string | null;
  createdAt: string;
  createdBy?: { id: string; displayName: string; email: string };
  members: { userId: string; email: string; displayName: string; addedAt: string }[];
}

interface CampaignRow {
  id: string;
  name: string;
  description?: string;
  runCount?: number;
  updatedAt: string;
  createdBy?: { displayName: string };
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { me, can } = useMe();
  const [project, setProject] = useState<ProjectDetail | undefined>();
  const [campaigns, setCampaigns] = useState<CampaignRow[] | undefined>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api<ProjectDetail>(`/api/projects/${id}`)
      .then((p) => {
        setProject(p);
        setName(p.name);
        setDescription(p.description ?? '');
      })
      .catch((e) => setError(e.message));
    api<CampaignRow[]>(`/api/campaigns?projectId=${id}`).then(setCampaigns).catch(() => undefined);
  }, [id]);

  useEffect(reload, [reload]);

  const canManage = !!project && (can('admin') || project.createdBy?.id === me?.sub);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/api/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, description: description || undefined }),
      });
      setEditing(false);
      reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Supprimer ce projet ?')) return;
    await api(`/api/projects/${id}`, { method: 'DELETE' });
    router.push('/projects');
  };

  const addMember = async () => {
    if (!memberEmail.trim()) return;
    setError(undefined);
    try {
      await api(`/api/projects/${id}/members`, { method: 'POST', body: JSON.stringify({ email: memberEmail }) });
      setMemberEmail('');
      reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeMember = async (userId: string) => {
    await api(`/api/projects/${id}/members/${userId}`, { method: 'DELETE' });
    reload();
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>
          {project?.name ?? '…'}{' '}
          {project?.deletedAt && (
            <span className="badge warn">
              <span className="dot" />
              supprimé
            </span>
          )}
        </h1>
        {canManage && !project?.deletedAt && (
          <div className="row">
            <button className="btn" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Annuler' : 'Modifier'}
            </button>
            <button className="btn danger" onClick={remove}>
              Supprimer
            </button>
          </div>
        )}
      </div>
      {error && <div className="error-box">{error}</div>}

      {editing ? (
        <div className="card">
          <label className="field">
            Nom
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>
            Enregistrer
          </button>
        </div>
      ) : (
        project && (
          <p className="muted">
            {project.description ? `${project.description} · ` : ''}créé par{' '}
            <strong>{project.createdBy?.displayName ?? '?'}</strong> le {formatDate(project.createdAt)}
          </p>
        )
      )}

      <h2>Membres</h2>
      <div className="card">
        <p className="muted">
          Le créateur voit et gère toutes les campagnes du projet ; les membres ci-dessous ont
          aussi accès à toutes ses campagnes.
        </p>
        <table className="list">
          <thead>
            <tr>
              <th>Utilisateur</th>
              <th>Affecté le</th>
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {project?.members.map((m) => (
              <tr key={m.userId}>
                <td>
                  {m.displayName} <span className="muted">({m.email})</span>
                </td>
                <td className="muted">{formatDate(m.addedAt)}</td>
                {canManage && (
                  <td>
                    <button className="btn danger small" onClick={() => removeMember(m.userId)}>
                      Retirer
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {project?.members.length === 0 && (
              <tr>
                <td colSpan={canManage ? 3 : 2} className="muted">
                  Aucun membre — seul le créateur a accès pour l&apos;instant.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {canManage && (
          <div className="row" style={{ marginTop: 12 }}>
            <input
              style={{ flex: 1 }}
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              placeholder="email@example.com"
            />
            <button className="btn" onClick={addMember} disabled={!memberEmail.trim()}>
              + Affecter
            </button>
          </div>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Campagnes du projet</h2>
        {can('editor') && (
          <Link className="btn primary" href={`/campaigns/new?projectId=${id}`}>
            + Nouvelle campagne
          </Link>
        )}
      </div>
      <div className="card">
        <table className="list">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Créateur</th>
              <th>Runs</th>
              <th>Modifiée</th>
            </tr>
          </thead>
          <tbody>
            {campaigns?.map((campaign) => (
              <tr key={campaign.id}>
                <td>
                  <Link href={`/campaigns/${campaign.id}`}>{campaign.name}</Link>
                  {campaign.description && <div className="muted">{campaign.description}</div>}
                </td>
                <td className="muted">{campaign.createdBy?.displayName ?? '—'}</td>
                <td>{campaign.runCount ?? 0}</td>
                <td className="muted">{formatDate(campaign.updatedAt)}</td>
              </tr>
            ))}
            {campaigns?.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Aucune campagne dans ce projet pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
