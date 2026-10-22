import { simpleGit } from 'simple-git';

export class GitIngestionError extends Error {}

export interface GitFetchOptions {
  url: string;
  targetDir: string;
  revision?: string;
  /**
   * Token used for HTTPS auth. Resolution order: explicit value, then the env
   * var named by `tokenSecretRef`, then `GIT_TOKEN`. SSH URLs rely on the
   * ambient SSH agent / `GIT_SSH_COMMAND` instead.
   */
  token?: string;
  tokenSecretRef?: string;
}

function withToken(url: string, token: string): string {
  const parsed = new URL(url);
  parsed.username = 'oauth2';
  parsed.password = token;
  return parsed.toString();
}

function redact(message: string, token?: string): string {
  return token ? message.replaceAll(token, '***') : message;
}

/** Shallow-clones a repository (optionally at a given revision) into `targetDir`. */
export async function fetchGitSource(options: GitFetchOptions): Promise<void> {
  const token =
    options.token ??
    (options.tokenSecretRef ? process.env[options.tokenSecretRef] : undefined) ??
    process.env.GIT_TOKEN;

  let url = options.url;
  if (token && url.startsWith('http')) {
    url = withToken(url, token);
  }

  const git = simpleGit();
  try {
    if (options.revision) {
      await git.clone(url, options.targetDir, ['--depth', '50']);
      await simpleGit(options.targetDir).checkout(options.revision);
    } else {
      await git.clone(url, options.targetDir, ['--depth', '1']);
    }
  } catch (err) {
    throw new GitIngestionError(
      `Failed to clone ${options.url}${options.revision ? `@${options.revision}` : ''}: ${redact(
        (err as Error).message,
        token,
      )}`,
    );
  }
}
