import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgram, run } from './index.js';

interface InvocationResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function invoke(args: string[]): Promise<InvocationResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode = 0;

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    stdout.push(parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' '));
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    stderr.push(parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' '));
  });
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

  try {
    await run(['node', 'engagement-harness', ...args]);
  } catch (err) {
    if (err && typeof err === 'object' && 'exitCode' in err) {
      exitCode = Number((err as { exitCode: unknown }).exitCode) || 1;
    } else if (err instanceof Error && err.message.startsWith('process.exit unexpectedly called')) {
      // vitest intercepts process.exit — extract the code from the message
      const match = err.message.match(/with "(\d+)"/);
      exitCode = match ? Number(match[1]) : 0;
    } else {
      throw err;
    }
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    writeSpy.mockRestore();
  }

  return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode };
}

describe('CLI program', () => {
  beforeEach(() => {
    const program = buildProgram();
    program.exitOverride();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes a version', () => {
    const program = buildProgram();
    expect(program.version()).toBeTruthy();
  });

  it('lists all 11 top-level commands in --help', async () => {
    const program = buildProgram();
    const help = program.helpInformation();
    const expectedTopLevel = [
      'init',
      'doctor',
      'review',
      'report',
      'config',
      'agents',
      'models',
      'ci',
      'eval',
      'feedback',
      'remediate',
    ];
    for (const name of expectedTopLevel) {
      expect(help).toContain(name);
    }
  });
});

describe('command stubs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('models list prints provider list and exits 0', async () => {
    const result = await invoke(['models', 'list']);
    expect(result.stdout).toContain('mock');
    expect(result.exitCode).toBe(0);
  });

  it('models validate exits 1 when no config is present', async () => {
    const result = await invoke(['models', 'validate']);
    expect(result.stderr).toContain('No config found');
    expect(result.exitCode).toBe(1);
  });

  it('ci templates writes github yaml to disk by default and exits 0', async () => {
    const result = await invoke(['ci', 'templates', '--platform', 'github']);
    expect(result.stdout).toContain('.github/workflows/engagement-harness.yml');
    expect(result.exitCode).toBe(0);
  });

  it('ci templates gitlab prints yaml to stdout by default and exits 0', async () => {
    const result = await invoke(['ci', 'templates', '--platform', 'gitlab']);
    expect(result.stdout).toContain('engagement-harness review --ci');
    expect(result.exitCode).toBe(0);
  });

  it('ci templates --platform unknown exits 1', async () => {
    const result = await invoke(['ci', 'templates', '--platform', 'unknown-platform']);
    expect(result.stderr).toContain('Unknown platform');
    expect(result.exitCode).toBe(1);
  });

  it('agents list prints all 9 registered agents and exits 0', async () => {
    const result = await invoke(['agents', 'list']);
    expect(result.stdout).toContain('Registered agents (9)');
    expect(result.stdout).toContain('security');
    expect(result.stdout).toContain('remediation');
    expect(result.exitCode).toBe(0);
  });

  it('eval exits 1 when no config is present', async () => {
    const result = await invoke(['eval']);
    expect(result.stderr).toContain('No config found');
    expect(result.exitCode).toBe(1);
  });

  it('feedback import exits 1 when file does not exist', async () => {
    const result = await invoke(['feedback', 'import', 'nonexistent-fb.json']);
    expect(result.stderr).toContain('Failed to import feedback');
    expect(result.exitCode).toBe(1);
  });

  it('remediate exits 1 when --finding is missing', async () => {
    const result = await invoke(['remediate']);
    expect(result.stderr).toContain('--finding');
    expect(result.exitCode).toBe(1);
  });

  it('remediate --finding exits 1 when no config is present', async () => {
    const result = await invoke(['remediate', '--finding', 'EH-0001']);
    expect(result.stderr).toContain('No config found');
    expect(result.exitCode).toBe(1);
  });
});
