'use client';

import { useState } from 'react';

export interface TrendPoint {
  id: string;
  label: string;
  value: number;
  hint?: string;
}

/**
 * Single-series bar trend (SVG, no external lib). Follows the dataviz method:
 * thin marks with rounded data-ends anchored to the baseline, 2px surface gap
 * between bars, hairline grid, single hue (series-1) — one series, so the
 * title names it and no legend box is needed. Hover = tooltip + hit target
 * wider than the mark.
 */
export function BarTrend({
  title,
  points,
  format = (v) => v.toFixed(0),
  max,
}: {
  title: string;
  points: TrendPoint[];
  format?: (value: number) => string;
  max?: number;
}) {
  const [hover, setHover] = useState<number | undefined>();
  const width = 460;
  const height = 140;
  const pad = { top: 18, right: 8, bottom: 22, left: 8 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const peak = max ?? Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 0 ? plotW / points.length : plotW;
  const barW = Math.max(4, Math.min(22, step - 2)); // 2px surface gap between fills

  if (points.length === 0) {
    return (
      <div className="card">
        <h2 style={{ margin: '0 0 6px' }}>{title}</h2>
        <p className="muted">Aucune donnée — lancez un premier run.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 style={{ margin: '0 0 6px' }}>{title}</h2>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={title}>
        {/* hairline grid: quarters */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + plotH * (1 - f)}
            y2={pad.top + plotH * (1 - f)}
            stroke="var(--grid)"
            strokeWidth={1}
          />
        ))}
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="var(--baseline)"
          strokeWidth={1}
        />
        {points.map((point, i) => {
          const h = Math.max(2, (point.value / peak) * plotH);
          const x = pad.left + i * step + (step - barW) / 2;
          const y = pad.top + plotH - h;
          return (
            <g key={point.id}>
              {/* data-end rounded via rx, anchored to baseline via overdraw */}
              <rect x={x} y={y} width={barW} height={h} rx={3} fill="var(--series-1)" />
              {h > 6 && (
                <rect x={x} y={pad.top + plotH - Math.min(4, h)} width={barW} height={Math.min(4, h)} fill="var(--series-1)" />
              )}
              {/* hover hit target wider than the mark */}
              <rect
                x={pad.left + i * step}
                y={pad.top}
                width={step}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(undefined)}
              />
              {hover === i && (
                <text
                  x={Math.min(Math.max(x + barW / 2, 30), width - 40)}
                  y={pad.top - 5}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text-primary)"
                >
                  {point.label} · {format(point.value)}
                  {point.hint ? ` · ${point.hint}` : ''}
                </text>
              )}
            </g>
          );
        })}
        {/* selective direct labels: first + last only */}
        <text x={pad.left} y={height - 6} fontSize={10} fill="var(--text-muted)">
          {points[0]?.label}
        </text>
        <text x={width - pad.right} y={height - 6} fontSize={10} fill="var(--text-muted)" textAnchor="end">
          {points[points.length - 1]?.label}
        </text>
      </svg>
    </div>
  );
}

export function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className={`tile ${tone ?? ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
