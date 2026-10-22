'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SelectionRule, TestsSource } from '@tcs/shared-types';
import { api, formatDate, formatDuration } from '../../../lib/api';
import { useMe } from '../../../lib/use-me';
import { StatusBadge } from '../../../components/status';
import { BarTrend, StatTile } from '../../../components/charts';

interface CampaignDetail {
  id: string;
  name: string;
  description?: string;
  selectionRule: SelectionRule;
  source: TestsSource;
  parallelism: number;
  version: number;
  deletedAt?: string | null;
  scheduleCron?: string | null;
  scheduleEnabled?: boolean;
  nextScheduledAt?: string;
  createdBy?: { displayName: string; email: string };
  createdAt: string;
}

interface RunRow {
  id: string;
  status: string;
  createdAt: string;
  finishedAt?: string;
  campaignVersion: number;
  triggeredBy?: { displayName: string };
  _count?: { results: number };
}

interface RunMetric {
  runId: string;
  createdAt: string;
  status: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  successRatio: number;
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { can } = useMe();
  const [campaign, setCampaign] = useState<CampaignDetail | undefined>();
  const [runs, setRuns] = useState<RunRow[] | undefined>();
  const [metrics, setMetrics] = useState<RunMetric[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api<CampaignDetail>(`/api/campaigns/${id}`).then(setCampaign).catch((e) => setError(e.message));
    api<{ items: RunRow[] }>(`/api/campaigns/${id}/runs`).then((r) => setRuns(r.items)).catch(() => undefined);
    api<RunMetric[]>(`/api/campaigns/${id}/metrics`).then(setMetrics).catch(() => undefined);
  }, [id]);

  useEffect(reload, [reload]);

  const launch = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const run = await api<{ id: string }>(`/api/campaigns/${id}/runs`, { method: 'POST', body: '{}' });
      router.push(`/runs/${run.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Supprimer cette campagne ?')) return;
    await api(`/api/campaigns/${id}`, { method: 'DELETE' });
    router.push('/');
  };

  const last = metrics?.at(-1);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>
          {campaign?.name ?? '…'}{' '}
          {campaign?.deletedAt && <span className="badge warn"><span className="dot" />supprimée</span>}
        </h1>
        <div className="row">
          {can('editor') && !campaign?.deletedAt && (
            <>
              <button className="btn primary" onClick={launch} disabled={busy}>
                {busy ? 'Lancement…' : '▶ Lancer'}
              </button>
              <Link className="btn" href={`/campaigns/${id}/edit`}>
                Modifier
              </Link>
              <button className="btn danger" onClick={remove}>
                Supprimer
              </button>
            </>
          )}
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}
      {campaign && (
        <p className="muted">
          {campaign.description ? `${campaign.description} · ` : ''}créée par{' '}
          <strong>{campaign.createdBy?.displayName ?? '?'}</strong> le {formatDate(campaign.createdAt)} ·
          version {campaign.version} · parallélisme {campaign.parallelism} · source{' '}
          <code className="chip">
            {campaign.source.type === 'git' ? campaign.source.url : campaign.source.path}
          </code>
          {campaign.scheduleEnabled && campaign.scheduleCron && (
            <>
              {' '}
              · ⏰ planifiée <code className="chip">{campaign.scheduleCron}</code>
              {campaign.nextScheduledAt && <> (prochain : {formatDate(campaign.nextScheduledAt)})</>}
            </>
          )}
        </p>
      )}

      {last && (
        <div className="grid tiles" style={{ marginBottom: 16 }}>
          <StatTile label="Dernier run — tests" value={last.total} />
          <StatTile label="Succès" value={last.passed} tone="good" />
          <StatTile label="Échecs" value={last.failed} tone={last.failed > 0 ? 'bad' : undefined} />
          <StatTile label="Durée cumulée" value={formatDuration(last.durationMs)} />
        </div>
      )}

      {metrics && metrics.length > 0 && (
        <div className="grid cols-2">
          <BarTrend
            title="Taux de réussite par run (%)"
            points={metrics.map((m) => ({
              id: m.runId,
              label: new Date(m.createdAt).toLocaleDateString(),
              value: m.successRatio * 100,
              hint: `${m.passed}/${m.total}`,
            }))}
            format={(v) => `${v.toFixed(0)}%`}
            max={100}
          />
          <BarTrend
            title="Durée cumulée par run"
            points={metrics.map((m) => ({
              id: m.runId,
              label: new Date(m.createdAt).toLocaleDateString(),
              value: m.durationMs / 1000,
            }))}
            format={(v) => `${v.toFixed(1)}s`}
          />
        </div>
      )}

      <h2>Historique des runs</h2>
      <div className="card">
        <table className="list">
          <thead>
            <tr>
              <th>Run</th>
              <th>Statut</th>
              <th>Déclenché par</th>
              <th>Date</th>
              <th>Résultats</th>
            </tr>
          </thead>
          <tbody>
            {runs?.map((run) => (
              <tr key={run.id}>
                <td>
                  <Link href={`/runs/${run.id}`}>{run.id.slice(0, 12)}…</Link>
                  <span className="muted"> (v{run.campaignVersion})</span>
                </td>
                <td>
                  <StatusBadge status={run.status} />
                </td>
                <td className="muted">{run.triggeredBy?.displayName ?? '—'}</td>
                <td className="muted">{formatDate(run.createdAt)}</td>
                <td>{run._count?.results ?? 0}</td>
              </tr>
            ))}
            {runs?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Aucun run pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
