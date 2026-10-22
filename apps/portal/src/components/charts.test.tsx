// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BarTrend, StatTile } from './charts';

afterEach(cleanup);

describe('BarTrend', () => {
  it('shows an empty state when there are no points', () => {
    render(<BarTrend title="Runs" points={[]} />);
    expect(screen.getByText('Runs')).toBeInTheDocument();
    expect(screen.getByText(/Aucune donnée/)).toBeInTheDocument();
    expect(document.querySelector('svg')).not.toBeInTheDocument();
  });

  it('renders one bar per point, labeled by the chart title', () => {
    const points = [
      { id: 'a', label: 'Lun', value: 3 },
      { id: 'b', label: 'Mar', value: 7 },
      { id: 'c', label: 'Mer', value: 1 },
    ];
    render(<BarTrend title="Runs / day" points={points} />);
    const svg = screen.getByRole('img', { name: 'Runs / day' });
    expect(svg).toBeInTheDocument();
    // one data-end rect per point (plus baseline/grid lines, not rects)
    expect(svg.querySelectorAll('g')).toHaveLength(points.length);
  });

  it('shows a hover tooltip with the formatted value on mouse enter', () => {
    const points = [{ id: 'a', label: 'Lun', value: 42 }];
    render(<BarTrend title="Runs" points={points} format={(v) => `${v}%`} />);
    expect(screen.queryByText(/Lun · 42%/)).not.toBeInTheDocument();

    const hitTarget = document.querySelector('svg g rect:last-of-type')!;
    fireEvent.mouseEnter(hitTarget);
    expect(screen.getByText(/Lun · 42%/)).toBeInTheDocument();

    fireEvent.mouseLeave(hitTarget);
    expect(screen.queryByText(/Lun · 42%/)).not.toBeInTheDocument();
  });

  it('appends the hint to the tooltip when provided', () => {
    const points = [{ id: 'a', label: 'Lun', value: 1, hint: '3 échecs' }];
    render(<BarTrend title="Runs" points={points} />);
    fireEvent.mouseEnter(document.querySelector('svg g rect:last-of-type')!);
    expect(screen.getByText(/3 échecs/)).toBeInTheDocument();
  });
});

describe('StatTile', () => {
  it('renders the label and value', () => {
    render(<StatTile label="Total" value={128} />);
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
  });

  it('applies the tone class when given', () => {
    const { container } = render(<StatTile label="Failed" value={3} tone="bad" />);
    expect(container.querySelector('.tile')).toHaveClass('bad');
  });

  it('has no tone class by default', () => {
    const { container } = render(<StatTile label="Total" value={0} />);
    const tile = container.querySelector('.tile')!;
    expect(tile.className.trim()).toBe('tile');
  });
});
