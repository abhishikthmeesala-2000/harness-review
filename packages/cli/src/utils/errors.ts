export class CliError extends Error {
  override readonly name = 'CliError';
  constructor(
    message: string,
    public readonly exitCode: number = 1,
  ) {
    super(message);
  }
}
