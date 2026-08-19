/**
 * CLI command: specpower change new <name>
 *
 * Creates a new change directory with .specpower.yaml metadata.
 */

import type { Command } from 'commander';
import { validateChangeName, writeChangeMetadata, isChangeNameUsed } from '../../utils/change-utils.js';
import { requireProjectRoot } from '../../utils/project-root.js';
import type { ChangeMetadata } from '../../utils/change-metadata.js';

/**
 * Returns today's date as YYYY-MM-DD string.
 */
function todayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Creates a new change directory with initial metadata.
 *
 * @param name - The change name (kebab-case)
 * @param projectRoot - Absolute path to the project root
 * @throws When the name is invalid or the change already exists
 */
export async function createChange(
  name: string,
  projectRoot: string,
): Promise<void> {
  validateChangeName(name);

  if (isChangeNameUsed(name, projectRoot)) {
    throw new Error(`Change name '${name}' is already used (active or archived). Choose a unique name — the test-plan token prefix depends on it.`);
  }

  const metadata: ChangeMetadata = {
    schema: 'specpower',
    created: todayDate(),
    phase: 'plan',
  };

  await writeChangeMetadata(name, metadata, projectRoot);
}

/**
 * Registers the `change new` subcommand with Commander.
 */
export function registerChangeNewCommand(changeCmd: Command): void {
  changeCmd
    .command('new <name>')
    .description('Create a new change directory')
    .action(async (name: string) => {
      const projectRoot = requireProjectRoot();
      await createChange(name, projectRoot);
      console.info(`Created change: ${name}`);
    });
}
