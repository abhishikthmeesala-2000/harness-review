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
    } else if (
      err instanceof Error &&
      err.message.startsWith('process.exit unexpectedly called')
    ) {
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

  const cases: Array<{ name: string; args: string[]; expected: string }> = [
    {
      name: 'models list',
      args: ['models', 'list'],
      expected: 'models list not yet implemented',
    },
    {
      name: 'models validate',
      args: ['models', 'validate'],
      expected: 'models validate not yet implemented',
    },
    {
      name: 'ci templates',
      args: ['ci', 'templates'],
      expected: 'ci templates not yet implemented',
    },
    {
      name: 'ci templates --platform github',
      args: ['ci', 'templates', '--platform', 'github'],
      expected: 'ci templates not yet implemented',
    },
  ];

  for (const c of cases) {
    it(`${c.name} prints stub and exits 0`, async () => {
      const result = await invoke(c.args);
      expect(result.stdout).toContain(c.expected);
      expect(result.exitCode).toBe(0);
    });
  }

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
