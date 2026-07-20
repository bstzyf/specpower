/**
 * CLI command: specpower sync [--user]
 *
 * Force-refreshes specpower assets (skills, command aliases, and — for the
 * project scope — prompts/schemas/templates) from the installed package into
 * either the current project's `.claude/` (default) or the user-level
 * `~/.claude/` (`--user`).
 *
 * Unlike `specpower init`, sync is unguarded: it always refreshes, overwriting
 * stale copies. Use it after `npm install -g specpower@latest` to propagate
 * the new version's skills into a project (model C) or into your user config
 * (model B).
 *
 * Scope behavior:
 * - project (default): copies skills + commands + prompts + schemas +
 *   templates. SKILL.md prompt references stay relative (`.claude/specpower/
 *   prompts/...`) because both the skills and the prompts live under the
 *   project's `.claude/`, resolved against the session cwd.
 * - user (--user): copies skills + commands only and rewrites each SKILL.md's
 *   prompt references to point at the installed package's `prompts/` dir.
 *   User-level skills live in `~/.claude` but prompts are resolved relative
 *   to the project cwd, so the prompts are NOT copied per-user — the package
 *   remains the single source of truth and updates with the next install.
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Command } from 'commander';
import {
  COMMAND_NAMES,
  copySkillsAndCommands,
  copyPrompts,
  copySchemas,
  copyTemplates,
  findPackageRoot,
  readPackageVersion,
  stampVersionInConfig,
} from './init.js';

/**
 * Options for {@link syncAssets}.
 */
export interface SyncOptions {
  /** When true, sync into `~/.claude` (user-level, model B) instead of the cwd project. */
  readonly user?: boolean;
  /**
   * Override the project root for project-scope sync. Defaults to `process.cwd()`.
   * Exposed for tests; the CLI action leaves it unset.
   */
  readonly projectRoot?: string;
}

/**
 * Result of a sync operation.
 */
export interface SyncResult {
  readonly status: 'synced';
  readonly scope: 'project' | 'user';
  /** The `.claude` directory that was refreshed. */
  readonly target: string;
  /** Absolute path to the installed specpower package the assets came from. */
  readonly packageRoot: string;
  /** Human-readable list of asset groups that were refreshed. */
  readonly refreshed: readonly string[];
  /** Stale skill dirs / command files removed because they no longer exist in this version. */
  readonly removed: readonly string[];
  readonly message: string;
}

const SPECPOWER_SKILL_PREFIX = 'specpower-';

/**
 * The set of skill dir names the current version ships, e.g. `specpower-plan`.
 */
function currentSkillDirs(): readonly string[] {
  return COMMAND_NAMES.map((c) => `${SPECPOWER_SKILL_PREFIX}${c}`);
}

/**
 * The set of command alias files the current version ships, e.g. `plan.md`.
 */
function currentCommandFiles(): readonly string[] {
  return COMMAND_NAMES.map((c) => `${c}.md`);
}

/**
 * Removes skill directories and command alias files that belong to specpower
 * but are no longer shipped by the current version (e.g. renamed or removed
 * skills across versions). Non-specpower entries are left untouched.
 *
 * @returns Human-readable paths of everything removed.
 */
async function cleanStale(
  skillRoot: string,
  commandRoot: string,
): Promise<string[]> {
  const removed: string[] = [];
  const validSkills = new Set(currentSkillDirs());
  const validCommands = new Set(currentCommandFiles());

  try {
    const entries = await fs.readdir(skillRoot, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (
          entry.isDirectory() &&
          entry.name.startsWith(SPECPOWER_SKILL_PREFIX) &&
          !validSkills.has(entry.name)
        ) {
          await fs.rm(join(skillRoot, entry.name), {
            recursive: true,
            force: true,
          });
          removed.push(`skills/${entry.name}`);
        }
      }),
    );
  } catch {
    // skills dir does not exist yet — nothing to clean.
  }

  try {
    const entries = await fs.readdir(commandRoot, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (
          entry.isFile() &&
          entry.name.endsWith('.md') &&
          !validCommands.has(entry.name)
        ) {
          await fs.rm(join(commandRoot, entry.name), { force: true });
          removed.push(`commands/specpower/${entry.name}`);
        }
      }),
    );
  } catch {
    // command dir does not exist yet — nothing to clean.
  }

  return removed;
}

/**
 * Refreshes specpower assets from the installed package into a `.claude`
 * directory.
 *
 * @param opts - Sync options (scope).
 * @returns SyncResult describing what was refreshed and pruned.
 */
export async function syncAssets(
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const scope: 'project' | 'user' = opts.user ? 'user' : 'project';
  const packageRoot = findPackageRoot();
  const projectRoot = opts.projectRoot ?? process.cwd();
  const claudeRoot =
    scope === 'user'
      ? join(homedir(), '.claude')
      : join(projectRoot, '.claude');
  const skillRoot = join(claudeRoot, 'skills');
  const commandRoot = join(claudeRoot, 'commands', 'specpower');

  const removed = await cleanStale(skillRoot, commandRoot);

  // Refresh skills + command aliases. User scope rewrites prompt paths to
  // point at the installed package (see module docstring).
  await copySkillsAndCommands(claudeRoot, packageRoot, {
    rewritePromptPaths: scope === 'user' ? packageRoot : undefined,
  });

  const refreshed = [...currentSkillDirs(), 'commands/specpower'];

  if (scope === 'project') {
    // Project skills reference prompts/schemas/templates via relative paths
    // resolved against the project cwd, so copy them next to the skills.
    await copyPrompts(claudeRoot, packageRoot);
    await copySchemas(claudeRoot, packageRoot);
    await copyTemplates(claudeRoot, packageRoot);
    refreshed.push('prompts', 'schemas', 'templates');

    // Stamp the installed version into config.yaml so a later `specpower init`
    // sees `equal` instead of re-offering to sync the (now-current) assets.
    // Surgical: only the `version:` line is touched, preserving comments.
    await stampVersionInConfig(projectRoot, readPackageVersion(packageRoot));
  }

  return {
    status: 'synced',
    scope,
    target: claudeRoot,
    packageRoot,
    refreshed,
    removed,
    message: `Synced specpower assets (${scope}) to ${claudeRoot}.`,
  };
}

/**
 * Registers the `sync` command with Commander.
 */
export function registerSyncCommand(program: Command): void {
  program
    .command('sync')
    .description(
      'Refresh specpower skills/commands/assets from the installed package ' +
        '(--user targets ~/.claude)',
    )
    .option(
      '--user',
      'Sync to user-level ~/.claude instead of the current project',
    )
    .action(async (opts: SyncOptions) => {
      const result = await syncAssets(opts);
      console.info(result.message);
      if (result.removed.length > 0) {
        console.info(`Removed stale: ${result.removed.join(', ')}`);
      }
      if (result.scope === 'user') {
        console.info(
          'User-level skills now reference prompts directly from the installed package ' +
            `(${result.packageRoot}).`,
        );
      }
    });
}
