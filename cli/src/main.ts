import chalk from 'chalk';
import { run as runCheck } from './check';
import { run as runFormat } from './format';

const USAGE = `Usage: htmlmustache <command> [options]

Commands:
  check   Check templates for parse errors
  format  Format templates

Run 'htmlmustache <command> --help' for command-specific help.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'check':
      process.exit(runCheck(args));
      break;
    case 'format':
      process.exit(await runFormat(args));
      break;
    case '--help':
    case '-h':
    case undefined:
      console.log(USAGE);
      process.exit(command ? 0 : 1);
      break;
    default:
      console.error(chalk.red(`Unknown command: ${command}`));
      console.error('Run "htmlmustache --help" for usage.');
      process.exit(1);
  }
}

main();
