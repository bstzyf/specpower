import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerChangeNewCommand } from './commands/change-new.js';
import { registerChangeStatusCommand } from './commands/change-status.js';
import { registerChangeArchiveCommand } from './commands/change-archive.js';
import { registerChangePhaseCommand } from './commands/change-phase.js';
import { registerInstructionsCommand } from './commands/instructions.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerInitCommand } from './commands/init.js';
import { registerSyncCommand } from './commands/sync.js';
import { registerConfigCommand } from './commands/config.js';
import { registerRenameScenarioCommand } from './commands/rename-scenario.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

const program = new Command();
program
  .name('specpower')
  .description('Unified spec-driven development: OpenSpec planning + Superpowers execution')
  .version(pkg.version);

// Group command: specpower change <new|status|archive>
const changeCmd = program
  .command('change')
  .description('Manage changes (new, status, archive)');

registerChangeNewCommand(changeCmd);
registerChangeStatusCommand(changeCmd);
registerChangeArchiveCommand(changeCmd);
registerChangePhaseCommand(changeCmd);

// Top-level commands
registerInstructionsCommand(program);
registerValidateCommand(program);
registerInitCommand(program);
registerSyncCommand(program);
registerConfigCommand(program);
registerRenameScenarioCommand(program);

program.exitOverride();

try {
  await program.parseAsync();
} catch (error: unknown) {
  if (error instanceof Error && 'code' in error) {
    const code = (error as { code: string }).code;
    if (code === 'commander.helpDisplayed' || code === 'commander.version') {
      process.exit(0);
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`错误: ${message}`);
  process.exit(1);
}
