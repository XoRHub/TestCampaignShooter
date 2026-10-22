import { writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import {
  discoverTests,
  fetchManifest,
  fetchSource,
  installAdapter,
  knownEngines,
  requireAdapter,
  resolveExecution,
  selectTests,
} from '@tcs/core';
import { LocalProvider } from '@tcs/orchestration';
import { loadRule, toSource, type SourceOptions } from './lib.js';

function sourceOptions(cmd: Command): Command {
  return cmd
    .requiredOption('-s, --source <urlOrPath>', 'git repository URL or local directory / .zip')
    .option('--revision <rev>', 'git revision (branch, tag, sha)');
}

function ruleOptions(cmd: Command): Command {
  return cmd
    .option('-r, --rule <json>', 'selection rule as inline JSON')
    .option('-f, --rule-file <file>', 'selection rule from a JSON file')
    .option('-p, --path <subtree>', 'restrict the selection to a subtree');
}

function manifestOption(cmd: Command): Command {
  return cmd.option(
    '--adapter-manifest <url>',
    'load extra/overridden engine adapters from a manifest URL (docs/adapter-plugins.md)',
  );
}

/**
 * Each CLI invocation is a fresh, single-shot process (unlike the server,
 * which serves concurrent requests) — so it's safe to install manifest
 * adapters straight into the process-wide registry, exactly like the
 * server does for instance-level manifests. No override-map plumbing
 * needed here.
 */
async function applyAdapterManifest(url?: string): Promise<void> {
  if (!url) return;
  const { adapters } = await fetchManifest(url);
  for (const adapter of adapters) installAdapter(adapter, url);
}

/**
 * Builds the `tcs` commander program. A fresh instance per call keeps
 * repeated invocations (each CLI test, `program.parseAsync` more than once)
 * from sharing option state.
 */
export function createProgram(): Command {
  const program = new Command('tcs').description(
    'TestCampaignShooter CLI — discover tests and run campaigns locally (the API/portal drive Argo for scale)',
  );

  manifestOption(sourceOptions(program.command('discover')))
    .description('discover every test (and metadata issues) in a source tree')
    .option('--json', 'machine-readable output')
    .action(async (options: SourceOptions & { json?: boolean; adapterManifest?: string }) => {
      await applyAdapterManifest(options.adapterManifest);
      const fetched = await fetchSource(toSource(options));
      try {
        const { tests, issues } = await discoverTests(fetched.rootDir, {
          knownEngines: knownEngines(),
        });
        if (options.json) {
          console.log(JSON.stringify({ tests, issues }, null, 2));
          return;
        }
        console.log(`\n${tests.length} test(s) discovered:\n`);
        for (const test of tests) {
          console.log(`  [${test.engine.padEnd(14)}] ${test.id}  (${test.file})`);
        }
        if (issues.length > 0) {
          console.log(`\n${issues.length} issue(s):\n`);
          for (const issue of issues)
            console.log(`  ! ${issue.kind}: ${issue.file} — ${issue.message}`);
        }
      } finally {
        await fetched.cleanup();
      }
    });

  manifestOption(ruleOptions(sourceOptions(program.command('preview'))))
    .description('evaluate a selection rule and list the tests a campaign would run')
    .action(
      async (
        options: SourceOptions & {
          rule?: string;
          ruleFile?: string;
          path?: string;
          adapterManifest?: string;
        },
      ) => {
        await applyAdapterManifest(options.adapterManifest);
        const rule = await loadRule(options.rule, options.ruleFile, options.path);
        const fetched = await fetchSource(toSource(options));
        try {
          const { tests, issues } = await discoverTests(fetched.rootDir, {
            knownEngines: knownEngines(),
          });
          const selected = selectTests(tests, rule);
          console.log(`\n${selected.length}/${tests.length} test(s) selected:\n`);
          for (const test of selected) console.log(`  [${test.engine.padEnd(14)}] ${test.id}`);
          if (issues.length > 0)
            console.log(`\n(${issues.length} discovery issue(s) — run "tcs discover" for details)`);
        } finally {
          await fetched.cleanup();
        }
      },
    );

  manifestOption(ruleOptions(sourceOptions(program.command('run'))))
    .description('run a campaign locally (dev/debug, not the scalable path)')
    .option('--parallelism <n>', 'tests executed simultaneously', '2')
    .option('--junit-out <file>', 'write the aggregated JUnit report to a file')
    .option(
      '--docker',
      'encapsulate each test in its metadata container image (docker run), like an Argo pod',
    )
    .action(
      async (
        options: SourceOptions & {
          rule?: string;
          ruleFile?: string;
          path?: string;
          parallelism: string;
          junitOut?: string;
          docker?: boolean;
          adapterManifest?: string;
        },
      ) => {
        await applyAdapterManifest(options.adapterManifest);
        const rule = await loadRule(options.rule, options.ruleFile, options.path);
        const source = toSource(options);
        const fetched = await fetchSource(source);
        let selected;
        try {
          const { tests } = await discoverTests(fetched.rootDir, { knownEngines: knownEngines() });
          selected = selectTests(tests, rule);
        } finally {
          await fetched.cleanup();
        }
        if (selected.length === 0) {
          console.error('The selection rule matches no test.');
          process.exitCode = 2;
          return;
        }

        const provider = new LocalProvider(
          {},
          options.docker ? { name: 'docker', runtime: 'docker' } : {},
        );
        const handle = await provider.submit({
          runId: `cli-${Date.now()}`,
          campaignId: 'cli',
          campaignName: 'cli-run',
          source,
          parallelism: Number(options.parallelism),
          tests: selected.map((test) => ({
            testId: test.id,
            name: test.name,
            engine: test.engine,
            file: test.file,
            execution: resolveExecution(requireAdapter(test.engine), test),
            metadata: test.metadata,
          })),
        });

        console.log(
          `\nRunning ${selected.length} test(s), parallelism ${options.parallelism}, runtime ${
            options.docker ? 'docker (container per test)' : 'host process'
          }…\n`,
        );
        await provider.watch(handle, (event) => {
          if (event.type === 'test' && event.status !== 'pending') {
            console.log(
              `  ${event.status.padEnd(9)} ${event.testId}${event.message ? ` (${event.message})` : ''}`,
            );
          }
          if (event.type === 'run' && event.finishedAt) {
            const p = event.progress;
            console.log(
              `\n${event.phase.toUpperCase()} — ${p.succeeded}/${p.total} passed, ${p.failed} failed`,
            );
          }
        });

        if (options.junitOut) {
          await writeFile(options.junitOut, provider.getMergedJUnit(handle), 'utf8');
          console.log(`Aggregated JUnit written to ${options.junitOut}`);
        }
        const state = await provider.getState(handle);
        process.exitCode = state.run.phase === 'succeeded' ? 0 : 1;
      },
    );

  manifestOption(program.command('engines'))
    .description('list the registered engine adapters')
    .action(async (options: { adapterManifest?: string }) => {
      await applyAdapterManifest(options.adapterManifest);
      for (const engine of knownEngines()) console.log(engine);
    });

  return program;
}
