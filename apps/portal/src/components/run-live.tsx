'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TERMINAL_RUN_PHASES, type RunPhase, type RunStateEvent, type TestStateEvent } from '@tcs/shared-types';
import { api, formatDate, formatDuration, openEvents } from '../lib/api';
import { StatusBadge } from './status';
import { LogStream } from './log-stream';

interface PersistedResult {
  testId: string;
  name: string;
  engine: string;
  outcome: string;
  durationMs: number;
  message?: string | null;
}

/**
 * Run view combining two sources:
 * - live: normalized per-test states pushed over SSE while the run executes;
 * - persisted: TestResult rows parsed from the aggregated JUnit report,
 *   loaded from the API — so finished (or historical) runs always show their
 *   per-test outcomes, durations and failure messages.
 */
export function RunLive({
  runId,
  canEdit,
  fallbackPhase,
}: {
  runId: string;
  canEdit: boolean;
  fallbackPhase?: string;
}) {
  const router = useRouter();
  const [tests, setTests] = useState<Map<string, TestStateEvent>>(new Map());
  const [run, setRun] = useState<RunStateEvent | undefined>();
  const [results, setResults] = useState<Map<string, PersistedResult>>(new Map());
  const [logsFor, setLogsFor] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();

  const loadResults = useCallback(async () => {
    try {
      const page = await api<{ items: PersistedResult[] }>(`/api/runs/${runId}/results?pageSize=500`);
      setResults(new Map(page.items.map((item) => [item.testId, item])));
    } catch {
      // results not ingested yet — the table falls back to live states only
    }
  }, [runId]);

  useEffect(() => {
    void loadResults();
    const source = openEvents(`/api/runs/${runId}/events`);
    source.addEventListener('test', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as TestStateEvent;
      setTests((prev) => new Map(prev).set(data.testId, data));
    });
    source.addEventListener('run', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as RunStateEvent;
      setRun(data);
      if (TERMINAL_RUN_PHASES.has(data.phase)) {
        // The aggregation callback lands around the terminal event: fetch the
        // parsed results now and once more shortly after, to be safe.
        void loadResults();
        setTimeout(() => void loadResults(), 2000);
      }
    });
    source.onerror = () => source.close();
    return () => source.close();
  }, [runId, loadResults]);

  const rows = useMemo(() => {
    const ids = new Set([...tests.keys(), ...results.keys()]);
    return [...ids].sort().map((id) => ({ id, live: tests.get(id), result: results.get(id) }));
  }, [tests, results]);

  const phase: string | undefined = run?.phase ?? fallbackPhase;
  const isTerminal = phase !== undefined && TERMINAL_RUN_PHASES.has(phase as RunPhase);
  const progress = run?.progress;
  const completed = (progress?.succeeded ?? 0) + (progress?.failed ?? 0);
  const eta = useMemo(() => {
    if (!run?.startedAt || !progress || completed === 0 || completed >= progress.total) return undefined;
    const elapsed = Date.now() - new Date(run.startedAt).getTime();
    const remaining = (elapsed / completed) * (progress.total - completed);
    return `${Math.max(1, Math.round(remaining / 60000))} min restantes (estimation)`;
  }, [run, progress, completed]);

  const act = async (path: string, body?: unknown) => {
    setActionError(undefined);
    try {
      await api(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      router.refresh();
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const isRowFailed = (row: { live?: TestStateEvent; result?: PersistedResult }) =>
    row.live
      ? row.live.status === 'failed' || row.live.status === 'timeout'
      : row.result?.outcome === 'failed' || row.result?.outcome === 'error';
  const failedCount = rows.filter(isRowFailed).length;
  const passedCount = rows.filter((r) =>
    r.live ? r.live.status === 'succeeded' : r.result?.outcome === 'passed',
  ).length;

  return (
    <div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            {phase && <StatusBadge status={phase} />}
            {progress ? (
              <span className="muted">
                {completed}/{progress.total} terminés · {progress.running} en cours ·{' '}
                {progress.pending} en attente
              </span>
            ) : (
              results.size > 0 && (
                <span className="muted">
                  {results.size} résultats · {passedCount} succès · {failedCount} échecs
                </span>
              )
            )}
            {eta && <span className="muted">· {eta}</span>}
          </div>
          {canEdit && (
            <div className="row">
              {failedCount > 0 && isTerminal && (
                <button className="btn" onClick={() => act(`/api/runs/${runId}/retry`)}>
                  Relancer les {failedCount} échec(s)
                </button>
              )}
              {phase === 'running' && (
                <button className="btn danger" onClick={() => act(`/api/runs/${runId}/cancel`)}>
                  Annuler
                </button>
              )}
              <button className="btn" onClick={() => act(`/api/runs/${runId}/replay`)}>
                ↻ Rejouer la campagne
              </button>
            </div>
          )}
        </div>
        {progress && progress.total > 0 && (
          <div className="progress" style={{ marginTop: 10 }} aria-label="progression">
            <div
              style={{ width: `${(progress.succeeded / progress.total) * 100}%`, background: 'var(--status-good)' }}
              title={`${progress.succeeded} succès`}
            />
            <div
              style={{ width: `${(progress.failed / progress.total) * 100}%`, background: 'var(--status-critical)' }}
              title={`${progress.failed} échecs`}
            />
            <div
              style={{ width: `${(progress.running / progress.total) * 100}%`, background: 'var(--series-1)' }}
              title={`${progress.running} en cours`}
            />
          </div>
        )}
        {actionError && <div className="error-box">{actionError}</div>}
      </div>

      <div className="card">
        <table className="list">
          <thead>
            <tr>
              <th>Test</th>
              <th>État</th>
              <th>Durée</th>
              <th>Début</th>
              <th>Fin</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const message = row.result?.message ?? row.live?.message;
              return (
                <tr key={row.id}>
                  <td>
                    {row.result?.name && row.result.name !== row.id ? (
                      <>
                        {row.result.name}
                        <div className="muted">{row.id}</div>
                      </>
                    ) : (
                      row.id
                    )}
                    {message && <div className="muted">{message}</div>}
                  </td>
                  <td>
                    <StatusBadge status={row.live?.status ?? row.result?.outcome ?? 'pending'} />
                  </td>
                  <td className="muted">
                    {row.result ? formatDuration(row.result.durationMs) : '—'}
                  </td>
                  <td className="muted">{formatDate(row.live?.startedAt)}</td>
                  <td className="muted">{formatDate(row.live?.finishedAt)}</td>
                  <td>
                    <div className="row">
                      <button
                        className="btn small"
                        onClick={() => setLogsFor(logsFor === row.id ? undefined : row.id)}
                      >
                        logs
                      </button>
                      {canEdit && isRowFailed(row) && isTerminal && (
                        <button
                          className="btn small"
                          onClick={() => act(`/api/runs/${runId}/retry`, { testIds: [row.id] })}
                          title="relancer uniquement ce test"
                        >
                          ↻ retry
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  En attente des premiers événements…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {logsFor && (
        <div className="card">
          <LogStream runId={runId} testId={logsFor} />
        </div>
      )}
    </div>
  );
}
