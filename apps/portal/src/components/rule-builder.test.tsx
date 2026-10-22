// @vitest-environment jsdom
import { useState } from 'react';
import type { SelectionRule } from '@tcs/shared-types';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { RuleBuilder } from './rule-builder';

afterEach(cleanup);

/** Controlled-component harness: RuleBuilder has no internal state of its own. */
function Harness({ initial, onChange }: { initial: SelectionRule; onChange?: (r: SelectionRule) => void }) {
  const [rule, setRule] = useState(initial);
  return (
    <RuleBuilder
      rule={rule}
      onChange={(next) => {
        setRule(next);
        onChange?.(next);
      }}
    />
  );
}

describe('RuleBuilder — condition node', () => {
  it('renders the property, operator and value inputs', () => {
    render(<Harness initial={{ prop: 'tags', op: 'contains', value: 'smoke' }} />);
    expect(screen.getByPlaceholderText(/propriété/)).toHaveValue('tags');
    expect(screen.getByRole('combobox', { name: /type de nœud/ })).toHaveValue('condition');
    expect(screen.getByPlaceholderText('valeur')).toHaveValue('smoke');
  });

  it('updates the prop field on input', async () => {
    const user = userEvent.setup();
    let latest: SelectionRule | undefined;
    render(
      <Harness
        initial={{ prop: 'tags', op: 'eq', value: 'x' }}
        onChange={(r) => {
          latest = r;
        }}
      />,
    );
    const propInput = screen.getByPlaceholderText(/propriété/);
    await user.clear(propInput);
    await user.type(propInput, 'team');
    expect(latest).toEqual({ prop: 'team', op: 'eq', value: 'x' });
  });

  it('hides the value input when the operator is "exists"', async () => {
    render(<Harness initial={{ prop: 'engine', op: 'eq', value: 'cypress' }} />);
    expect(screen.getByPlaceholderText('valeur')).toBeInTheDocument();

    const user = userEvent.setup();
    const opSelect = screen.getAllByRole('combobox')[1]!;
    await user.selectOptions(opSelect, 'existe');

    expect(screen.queryByPlaceholderText('valeur')).not.toBeInTheDocument();
  });

  it('parses a comma-separated list for the "in" operator', async () => {
    let latest: SelectionRule | undefined;
    render(
      <Harness
        initial={{ prop: 'team', op: 'in', value: [] }}
        onChange={(r) => {
          latest = r;
        }}
      />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('valeur'), 'payments,checkout,42');
    expect(latest).toEqual({ prop: 'team', op: 'in', value: ['payments', 'checkout', 42] });
  });
});

describe('RuleBuilder — pathUnder node', () => {
  it('renders and edits the subtree path', async () => {
    let latest: SelectionRule | undefined;
    render(
      <Harness
        initial={{ pathUnder: 'suites/api' }}
        onChange={(r) => {
          latest = r;
        }}
      />,
    );
    const input = screen.getByPlaceholderText(/suites\/checkout/);
    expect(input).toHaveValue('suites/api');
    const user = userEvent.setup();
    await user.type(input, '2');
    expect(latest).toEqual({ pathUnder: 'suites/api2' });
  });
});

describe('RuleBuilder — group nodes (all/any)', () => {
  it('adds a condition child', async () => {
    render(<Harness initial={{ all: [{ prop: 'tags', op: 'contains', value: 'smoke' }] }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '+ condition' }));
    expect(screen.getAllByPlaceholderText(/propriété/)).toHaveLength(2);
  });

  it('adds a nested opposite-kind group', async () => {
    render(<Harness initial={{ all: [{ prop: 'tags', op: 'contains', value: 'smoke' }] }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '+ groupe' }));
    // Root stays "all"; a nested "any" group appears (itself defaulting to
    // one condition child, on top of the original condition — 4 selects total).
    const kindSelects = screen
      .getAllByRole('combobox', { name: /type de nœud/ })
      .map((s) => (s as HTMLSelectElement).value);
    expect(kindSelects).toHaveLength(4);
    expect(kindSelects[0]).toBe('all');
    expect(kindSelects).toContain('any');
  });

  it('does not show a remove button on a child when it is the only one', () => {
    render(<Harness initial={{ all: [{ prop: 'tags', op: 'contains', value: 'smoke' }] }} />);
    // The remove button (identified by its title, since its accessible name
    // is its "✕" text content) could only exist here, and it doesn't: no
    // onRemove is passed at the root.
    expect(screen.queryByTitle('supprimer ce nœud')).not.toBeInTheDocument();
  });

  it('shows and wires up remove buttons once there are multiple children', async () => {
    render(
      <Harness
        initial={{
          all: [
            { prop: 'tags', op: 'contains', value: 'smoke' },
            { prop: 'team', op: 'eq', value: 'payments' },
          ],
        }}
      />,
    );
    const removeButtons = screen.getAllByTitle('supprimer ce nœud');
    expect(removeButtons).toHaveLength(2);

    const user = userEvent.setup();
    await user.click(removeButtons[0]!);
    expect(screen.getAllByPlaceholderText(/propriété/)).toHaveLength(1);
    expect(screen.queryByTitle('supprimer ce nœud')).not.toBeInTheDocument();
  });

  it('switching the root kind selector replaces the whole rule with a fresh default', async () => {
    let latest: SelectionRule | undefined;
    render(
      <Harness
        initial={{ prop: 'tags', op: 'contains', value: 'smoke' }}
        onChange={(r) => {
          latest = r;
        }}
      />,
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByRole('combobox', { name: /type de nœud/ }), 'OU (au moins une)');
    expect(latest).toEqual({ any: [{ prop: 'tags', op: 'contains', value: 'smoke' }] });
  });
});

describe('RuleBuilder — not node', () => {
  it('renders the inner rule recursively', () => {
    render(<Harness initial={{ not: { prop: 'tags', op: 'eq', value: 'flaky' } }} />);
    expect(screen.getByPlaceholderText(/propriété/)).toHaveValue('tags');
  });
});
