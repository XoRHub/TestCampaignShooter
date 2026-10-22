'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { API_URL, api, formatDate } from '../../../lib/api';
import { useMe } from '../../../lib/use-me';
import { StatusBadge } from '../../../components/status';
import { RunLive } from '../../../components/run-live';

interface RunDetail {
  id: string;
  status: string;
  createdAt: string;
  finishedAt?: string;
  campaignVersion: number;
  parallelism: number;
  provider: string;
  junitKey?: string;
  campaign: { id: string; name: string };
  triggeredBy?: { displayName: string; email: string };
  summary: Record<string, number>;
}

interface ArtifactRow {
  id: string;
  name: string;
  storageKey: string;
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useMe();
  const [run, setRun] = useState<RunDetail | undefined>();
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api<RunDetail>(`/api/runs/${id}`).then(setRun).catch((e) => setError(e.message));
    api<ArtifactRow[]>(`/api/runs/${id}/artifacts`).then(setArtifacts).catch(() => undefined);
  }, [id]);

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>
          Run {id.slice(0, 12)}…{' '}
          {run && (
            <>
              <StatusBadge status={run.status} />{' '}
              <span className="muted" style={{ fontSize: 14 }}>
                — campagne <Link href={`/campaigns/${run.campaign.id}`}>{run.campaign.name}</Link>
              </span>
            </>
          )}
        </h1>
        <div className="row">
          <Link className="btn" href={`/runs/${id}/diff`}>
            ⇄ Comparer au run précédent
          </Link>
          {run?.junitKey && (
            <a className="btn" href={`${API_URL}/api/runs/${id}/junit`}>
              ⬇ JUnit agrégé
            </a>
          )}
        </div>
      </div>
      {run && (
        <p className="muted">
          déclenché par <strong>{run.triggeredBy?.displayName ?? '?'}</strong> le{' '}
          {formatDate(run.createdAt)} · provider <code className="chip">{run.provider}</code> ·
          parallélisme {run.parallelism} · version campagne {run.campaignVersion}
        </p>
      )}
      {error && <div className="error-box">{error}</div>}

      <RunLive runId={id} canEdit={can('editor')} fallbackPhase={run?.status} />

      {artifacts.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Artifacts</h2>
          <table className="list">
            <tbody>
              {artifacts.map((artifact) => (
                <tr key={artifact.id}>
                  <td>{artifact.name}</td>
                  <td className="muted">{artifact.storageKey}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
