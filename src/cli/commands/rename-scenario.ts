import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import * as readline from 'node:readline/promises';

export async function renameScenario(
  projectRoot: string,
  capability: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const specPath = join(projectRoot, 'specpower', 'specs', capability, 'spec.md');
  let content = await fs.readFile(specPath, 'utf-8');
  // Atomically change `#### Scenario: <oldName>` → `#### Scenario: <newName>`
  const re = new RegExp(`^(#### Scenario:\\s*)${escapeRegExp(oldName)}(\\s*)$`, 'm');
  if (!re.test(content)) {
    throw new Error(`Scenario "${oldName}" not found in ${specPath}`);
  }
  content = content.replace(re, `$1${newName}$2`);
  await fs.writeFile(specPath, content, 'utf-8');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Decide whether a destructive rename should prompt for confirmation before
 * writing. Prompts only when stdin is a TTY (interactive) and `--yes` was not
 * passed. Non-TTY (pipes, CI, tests) never blocks.
 */
export function shouldPromptForConfirmation(
  opts: { yes?: boolean },
  isTTY: boolean | undefined,
): boolean {
  return !opts.yes && !!isTTY;
}

export function registerRenameScenarioCommand(program: Command): void {
  program
    .command('rename-scenario <capability> <old> <new>')
    .description('Atomically rename a baseline Scenario and sync test-plan references')
    .option('--dry-run', 'Preview affected files without writing')
    .option('--yes', 'Skip the interactive confirmation prompt (non-TTY always skips)')
    .action(async (capability: string, old: string, next: string, opts: { dryRun?: boolean; yes?: boolean }) => {
      const projectRoot = process.cwd();
      if (opts.dryRun) {
        const affected = await listAffectedTestPlans(projectRoot, old);
        console.info(`Would rename "${old}" → "${next}" in baseline spec + ${affected.length} test-plan(s):`);
        affected.forEach((p) => console.info(`  ${p}`));
        return;
      }
      // Confirmation gate: prompt only in an interactive (TTY) session and
      // only when --yes was not passed. Non-TTY runs proceed without blocking.
      const affected = await listAffectedTestPlans(projectRoot, old);
      if (shouldPromptForConfirmation(opts, process.stdin.isTTY)) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
          const ans = await rl.question(
            `Rename "${old}" → "${next}" in baseline spec + ${affected.length} test-plan(s). Proceed? [y/N] `,
          );
          if (!/^\s*y(es)?\s*$/i.test(ans)) {
            console.info('Aborted.');
            return;
          }
        } finally {
          rl.close();
        }
      }
      await renameScenario(projectRoot, capability, old, next);
      const synced = await syncTestPlanRefs(projectRoot, old, next);
      console.info(`Renamed "${old}" → "${next}"; synced ${synced} test-plan reference(s).`);
    });
}

// Task 16 implementation
export async function listAffectedTestPlans(root: string, old: string): Promise<string[]> {
  const found: string[] = [];
  for await (const tp of findTestPlans(root)) {
    const content = await fs.readFile(tp, 'utf-8');
    if (new RegExp(`→\\s+Scenario:\\s*${escapeRegExp(old)}\\s*$`, 'm').test(content)) {
      found.push(tp);
    }
  }
  return found;
}

export async function syncTestPlanRefs(root: string, old: string, newName: string): Promise<number> {
  const affected = await listAffectedTestPlans(root, old);
  for (const tp of affected) {
    let content = await fs.readFile(tp, 'utf-8');
    const re = new RegExp(`(→\\s+Scenario:\\s*)${escapeRegExp(old)}(\\s*)$`, 'mg');
    content = content.replace(re, `$1${newName}$2`);
    await fs.writeFile(tp, content, 'utf-8');
  }
  return affected.length;
}

async function* findTestPlans(root: string): AsyncIterable<string> {
  const changesDir = join(root, 'specpower', 'changes');
  if (!await dirExists(changesDir)) return;
  // in-flight
  for (const entry of await fs.readdir(changesDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== 'archive') {
      const tp = join(changesDir, entry.name, 'test-plan.md');
      if (await fileExists(tp)) yield tp;
    }
  }
  // archived
  const archiveDir = join(changesDir, 'archive');
  if (await dirExists(archiveDir)) {
    for (const entry of await fs.readdir(archiveDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const tp = join(archiveDir, entry.name, 'test-plan.md');
        if (await fileExists(tp)) yield tp;
      }
    }
  }
}

async function dirExists(p: string): Promise<boolean> { try { return (await fs.stat(p)).isDirectory(); } catch { return false; } }
async function fileExists(p: string): Promise<boolean> { try { return (await fs.stat(p)).isFile(); } catch { return false; } }
