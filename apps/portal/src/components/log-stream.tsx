'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL, openEvents } from '../lib/api';

/** Live log tail of one test (SSE), with a download link for the full file. */
export function LogStream({ runId, testId }: { runId: string; testId: string }) {
  const [content, setContent] = useState('');
  const [done, setDone] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setContent('');
    setDone(false);
    const source = openEvents(`/api/runs/${runId}/logs/stream?testId=${encodeURIComponent(testId)}`);
    source.addEventListener('log', (event) => {
      const { chunk } = JSON.parse((event as MessageEvent).data) as { chunk: string };
      setContent((prev) => prev + chunk);
    });
    source.addEventListener('end', () => {
      setDone(true);
      source.close();
    });
    source.onerror = () => {
      setDone(true);
      source.close();
    };
    return () => source.close();
  }, [runId, testId]);

  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
  }, [content]);

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <strong>Logs — {testId}</strong>
        {!done && <span className="badge busy"><span className="dot" />streaming</span>}
        <a
          className="btn small"
          href={`${API_URL}/api/runs/${runId}/logs?testId=${encodeURIComponent(testId)}&download=1`}
        >
          Télécharger
        </a>
      </div>
      <pre className="logs" ref={preRef}>
        {content || '(aucune sortie pour le moment)'}
      </pre>
    </div>
  );
}
