'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import type { RunDiff } from '@tcs/shared-types';
import { api, formatDuration } from '../../../../lib/api';
import { StatTile } from '../../../../components/charts';
import { StatusBadge } from '../../../../components/status';

const CHANGE_LABELS: Record<string, string> = {
  regression: 'Régressions',
  fixed: 'Corrigés',
  new: 'Nouveaux',
  removed: 'Disparus',
  'still-failing': 'Toujours en échec',
  stable: 'Stables',
};

export default function RunDiffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [diff, setDiff] = useState<RunDiff | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    api<RunDiff>(`/api/runs/${id}/diff`).then(setDiff).catch((e) => setError(e.message));
  }, [id]);

  return (
    <div>
      <h1>Comparaison avec le run précédent</h1>
      {error && <div className="error-box">{error}</div>}
      {diff && (
        <>
          <p className="muted">
            <Link href={`/runs/${diff.baseRunId}`}>{diff.baseRunId.slice(0, 12)}…</Link> →{' '}
            <Link href={`/runs/${diff.targetRunId}`}>{diff.targetRunId.slice(0, 12)}…</Link>
          </p>
          <div className="grid tiles" style={{ marginBottom: 16 }}>
            <StatTile label="Régressions" value={diff.summary.regression} tone={diff.summary.regression > 0 ? 'bad' : undefined} />
            <StatTile label="Corrigés" value={diff.summary.fixed} tone={diff.summary.fixed > 0 ? 'good' : undefined} />
            <StatTile label="Nouveaux" value={diff.summary.new} />
            <StatTile label="Disparus" value={diff.summary.removed} />
            <StatTile label="Toujours en échec" value={diff.summary['still-failing']} />
            <StatTile label="Stables" value={diff.summary.stable} />
          </div>
          <div className="card">
            <table className="list">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Changement</th>
                  <th>Avant</th>
                  <th>Après</th>
                  <th>Δ durée</th>
                </tr>
              </thead>
              <tbody>
                {diff.entries.map((entry) => (
                  <tr key={entry.testId}>
                    <td>
                      {entry.name}
                      <div className="muted">{entry.testId}</div>
                    </td>
                    <td>{CHANGE_LABELS[entry.change] ?? entry.change}</td>
                    <td>{entry.before ? <StatusBadge status={entry.before.outcome} /> : '—'}</td>
                    <td>{entry.after ? <StatusBadge status={entry.after.outcome} /> : '—'}</td>
                    <td className="muted">
                      {entry.durationDeltaMs !== undefined
                        ? `${entry.durationDeltaMs >= 0 ? '+' : '−'}${formatDuration(Math.abs(entry.durationDeltaMs))}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
