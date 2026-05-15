import { execSync } from 'node:child_process';

function cleanGitEnv(): NodeJS.ProcessEnv {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { GIT_DIR: _d, GIT_WORK_TREE: _w, GIT_INDEX_FILE: _i, ...rest } = process.env;
  return rest;
}

export async function checkIfGitRepo(cwd: string): Promise<boolean> {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe', env: cleanGitEnv() });
    return true;
  } catch {
    return false;
  }
}

export async function detectGitPlatform(cwd: string): Promise<string | null> {
  const url = await getRemoteUrl(cwd);
  if (!url) return null;
  if (url.includes('github.com')) return 'github';
  if (url.includes('gitlab.com')) return 'gitlab';
  if (url.includes('dev.azure.com') || url.includes('visualstudio.com')) return 'azure-devops';
  if (url.includes('bitbucket.org')) return 'bitbucket';
  return null;
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  try {
    const result = execSync('git branch --show-current', { cwd, stdio: 'pipe' });
    return result.toString().trim() || 'main';
  } catch {
    return 'main';
  }
}

export async function getRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const result = execSync('git remote get-url origin', { cwd, stdio: 'pipe' });
    return result.toString().trim() || null;
  } catch {
    return null;
  }
}
