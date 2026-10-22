// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge } from './status';

afterEach(cleanup);

describe('StatusBadge', () => {
  it.each([
    ['succeeded', 'succès', 'good'],
    ['failed', 'échec', 'bad'],
    ['running', 'en cours', 'busy'],
    ['timeout', 'timeout', 'warn'],
    ['skipped', 'ignoré', ''],
  ])('renders the %s status with label "%s"', (status, label, className) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByText(label).closest('span.badge');
    expect(badge).toBeInTheDocument();
    if (className) expect(badge).toHaveClass(className);
  });

  it('falls back to the raw status string for an unknown status', () => {
    render(<StatusBadge status="mystery-state" />);
    expect(screen.getByText('mystery-state')).toBeInTheDocument();
  });

  it('never conveys state by color alone: the dot is decorative and the label is always text', () => {
    render(<StatusBadge status="succeeded" />);
    const dot = document.querySelector('.dot');
    expect(dot).toHaveAttribute('aria-hidden');
    expect(screen.getByText('succès')).toBeVisible();
  });
});
