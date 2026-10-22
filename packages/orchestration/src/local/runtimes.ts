import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { TestExecutionSnapshot } from '@tcs/shared-types';

export interface ExecutionOutcome {
  code: number | null;
  timedOut: boolean;
}

/**
 * How the local provider physically executes one test. `process` runs the
 * command directly on the host (fast, zero dependency); `docker` encapsulates
 * it in the container image declared by the test metadata — same contract as
 * an Argo pod (workspace mounted on /workspace, env, timeout, resources).
 */
export interface TestRuntime {
  readonly name: 'process' | 'docker';
  run(
    test: TestExecutionSnapshot,
    /** Host directory holding this test node's isolated copy of the sources. */
    nodeDir: string,
    onOutput: (chunk: string) => void,
    signal: AbortSignal,
  ): Promise<ExecutionOutcome>;
}

function collectOutput(
  child: ReturnType<typeof spawn>,
  onOutput: (chunk: string) => void,
): void {
  child.stdout?.on('data', (chunk: Buffer) => onOutput(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => onOutput(chunk.toString()));
}

/** Host-process runtime (dev default): spawns the command as a child process. */
export class ProcessRuntime implements TestRuntime {
  readonly name = 'process' as const;

  run(
    test: TestExecutionSnapshot,
    nodeDir: string,
    onOutput: (chunk: string) => void,
    signal: AbortSignal,
  ): Promise<ExecutionOutcome> {
    const { execution } = test;
    const cwd = execution.workingDir ? path.join(nodeDir, execution.workingDir) : nodeDir;
    const [cmd, ...args] = execution.command;
    return new Promise((resolve) => {
      const child = spawn(cmd!, args, {
        cwd,
        env: { ...process.env, ...execution.env },
        signal,
      });
      const timer = setTimeout(() => {
        child.kill();
        resolve({ code: null, timedOut: true });
      }, execution.timeoutSeconds * 1000);
      collectOutput(child, onOutput);
      child.on('error', (err) => {
        clearTimeout(timer);
        onOutput(`\n[local-provider] ${err.message}\n`);
        resolve({ code: -1, timedOut: false });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, timedOut: false });
      });
    });
  }
}

/** k8s-style cpu ("500m", "2") → docker --cpus value. */
export function toDockerCpus(cpu: string): string {
  const milli = /^(\d+)m$/.exec(cpu);
  return milli ? String(Number(milli[1]) / 1000) : cpu;
}

/** k8s-style memory ("512Mi", "1Gi", "1G") → docker --memory value. */
export function toDockerMemory(memory: string): string {
  const match = /^(\d+(?:\.\d+)?)\s*(Ki|Mi|Gi|K|M|G)?$/i.exec(memory);
  if (!match) return memory;
  const unit = (match[2] ?? '').toLowerCase().replace('i', '');
  return `${match[1]}${unit || 'b'}`;
}

/** Builds the full `docker <args>` argv for one test execution. */
export function buildDockerRunArgs(
  test: TestExecutionSnapshot,
  nodeDir: string,
  containerName: string,
): string[] {
  const { execution } = test;
  const workdir = execution.workingDir
    ? path.posix.join('/workspace', execution.workingDir.replaceAll('\\', '/'))
    : '/workspace';
  const args = [
    'run',
    '--rm',
    '--name',
    containerName,
    '-v',
    `${path.resolve(nodeDir)}:/workspace`,
    '-w',
    workdir,
  ];
  for (const [key, value] of Object.entries(execution.env)) {
    args.push('-e', `${key}=${value}`);
  }
  if (execution.resources?.cpu) args.push('--cpus', toDockerCpus(execution.resources.cpu));
  if (execution.resources?.memory)
    args.push('--memory', toDockerMemory(execution.resources.memory));
  args.push(execution.image, ...execution.command);
  return args;
}

/**
 * Docker runtime: each test runs in the container image declared by its
 * metadata, with the node workspace bind-mounted at /workspace — mirroring
 * exactly what the Argo provider does with pods. JUnit reports written under
 * /workspace land in the host nodeDir through the mount.
 */
export class DockerRuntime implements TestRuntime {
  readonly name = 'docker' as const;

  constructor(private readonly dockerBin = 'docker') {}

  run(
    test: TestExecutionSnapshot,
    nodeDir: string,
    onOutput: (chunk: string) => void,
    signal: AbortSignal,
  ): Promise<ExecutionOutcome> {
    const containerName = `tcs-${test.testId.replace(/[^a-zA-Z0-9_.-]+/g, '-')}-${randomBytes(4).toString('hex')}`
      .replace(/^[^a-zA-Z0-9]+/, 'tcs-')
      .slice(0, 63);
    const args = buildDockerRunArgs(test, nodeDir, containerName);

    return new Promise((resolve) => {
      const child = spawn(this.dockerBin, args, { env: process.env });
      let timedOut = false;
      const kill = () => {
        // `docker run` ignores plain SIGTERM to the CLI once attached — kill
        // the container itself so --rm cleans it up.
        spawn(this.dockerBin, ['kill', containerName]).on('error', () => undefined);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, test.execution.timeoutSeconds * 1000);
      const onAbort = () => kill();
      signal.addEventListener('abort', onAbort, { once: true });

      collectOutput(child, onOutput);
      child.on('error', (err) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        onOutput(
          `\n[local-provider] cannot invoke "${this.dockerBin}": ${err.message} — is Docker installed and running?\n`,
        );
        resolve({ code: -1, timedOut: false });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (code === 125) {
          onOutput(`\n[local-provider] docker daemon error (exit 125) — check the image "${test.execution.image}"\n`);
        }
        resolve({ code, timedOut });
      });
    });
  }
}

export function createRuntime(name: 'process' | 'docker', dockerBin?: string): TestRuntime {
  return name === 'docker' ? new DockerRuntime(dockerBin) : new ProcessRuntime();
}
