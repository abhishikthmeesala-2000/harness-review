import { FeedbackImporter } from '@engagement-harness/eval';
import chalk from 'chalk';

export async function feedbackImportCommand(file: string): Promise<void> {
  try {
    await new FeedbackImporter().import(file, process.cwd());
    console.log(chalk.green('Feedback imported successfully.'));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Failed to import feedback: ${msg}`));
    process.exit(1);
  }
}
