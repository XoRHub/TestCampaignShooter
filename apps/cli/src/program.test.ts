import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from './program.js';

async function run(args: string[]): Promise<string> {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
    logs.push(String(msg));
  });
  try {
    await createProgram().parseAsync(['node', 'tcs', ...args]);
  } finally {
    spy.mockRestore();
  }
  return logs.join('\n');
}

describe('tcs program', () => {
  it('registers the expected subcommands', () => {
    const program = createProgram();
    expect(program.commands.map((c) => c.name()).sort()).toEqual([
      'discover',
      'engines',
      'preview',
      'run',
    ]);
  });

  it('engines lists the built-in engine adapters', async () => {
    const output = await run(['engines']);
    expect(output).toContain('cypress');
    expect(output).toContain('robotframework');
  });

  describe('against a local fixture source', () => {
    let root: string;

    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), 'tcs-cli-fixture-'));
      const write = async (rel: string, content: string) => {
        const abs = path.join(root, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, 'utf8');
      };
      await write('suites/checkout/smoke.cy.ts', 'it("adds to cart", () => {});');
      await write(
        'suites/checkout/smoke.cy.ts.metadata.json',
        JSON.stringify({ name: 'Checkout smoke', engine: 'cypress', tags: ['smoke'] }),
      );
      await write('suites/api/login.robot', '*** Test Cases ***');
      await write(
        'suites/api/login.robot.metadata.json',
        JSON.stringify({ id: 'api/login', engine: 'robotframework', tags: ['nightly'] }),
      );
    });

    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    it('discover --json reports every discovered test', async () => {
      const output = await run(['discover', '--source', root, '--json']);
      const parsed = JSON.parse(output) as { tests: { id: string }[]; issues: unknown[] };
      expect(parsed.tests.map((t) => t.id).sort()).toEqual(['api/login', 'suites/checkout/smoke.cy.ts']);
      expect(parsed.issues).toEqual([]);
    });

    it('discover (human output) lists engine and file per test', async () => {
      const output = await run(['discover', '--source', root]);
      expect(output).toContain('test(s) discovered');
      expect(output).toContain('cypress');
      expect(output).toContain('robotframework');
    });

    it('preview narrows the selection to tests matching the rule', async () => {
      const output = await run([
        'preview',
        '--source',
        root,
        '--rule',
        JSON.stringify({ prop: 'tags', op: 'contains', value: 'smoke' }),
      ]);
      expect(output).toContain('1/2 test(s) selected');
      expect(output).toContain('cypress');
      expect(output).not.toContain('robotframework');
    });

    it('preview --path restricts the selection to a subtree', async () => {
      const output = await run(['preview', '--source', root, '--path', 'suites/api']);
      expect(output).toContain('1/2 test(s) selected');
    });
  });
});
