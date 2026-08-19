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
import { join, resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import type { Command } from 'commander';
import {
  COMMAND_NAMES,
  copySkillsAndCommands,
  copyPrompts,
  copySchemas,
  copyTemplates,
  copyCustom,
  findPackageRoot,
  readPackageVersion,
  stampVersionInConfig,
} from './init.js';
import { bakeCustomIncludes } from './custom-bake.js';
import type { ToolAdapter, ToolId } from '../../core/tools/types.js';
import { resolveTool, maybeToolHint } from '../../core/tools/adapters.js';

/**
 * Options for {@link syncAssets}.
 */
export interface SyncOptions {
  /** When true, sync into `~/.<rootDir>` (user-level, model B) instead of the cwd project. */
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
  /** The target tool that was synced (claude | opencode | cac). */
  readonly tool: ToolId;
  /** The tool's root directory that was refreshed (e.g. `<project>/.claude`). */
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
 * Detects whether `cwd` lives inside a **linked** git worktree (rather than
 * the repo's own working copy). In a linked worktree, `git rev-parse
 * --git-common-dir` points at the main repo's `.git`, whose parent differs
 * from `--show-toplevel` (the worktree root). In the main repo the two
 * resolve to the same directory; outside any repo git fails and we return
 * false.
 *
 * Used by {@link syncAssets} to skip {@link stampVersionInConfig} when run
 * inside a worktree — otherwise the stamp would mutate the worktree's
 * tracked `specpower/config.yaml`, polluting `git diff`/PR noise. The
 * version is reconciled when sync runs against the main checkout instead.
 *
 * @param cwd - Directory to probe. Defaults to `process.cwd()`.
 */
export function isInsideWorktree(cwd: string = process.cwd()): boolean {
  try {
    const run = (args: string[]) =>
      execSync(`git ${args.join(' ')}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    const common = run(['rev-parse', '--git-common-dir']);
    const toplevel = run(['rev-parse', '--show-toplevel']);
    if (!common || !toplevel) return false;
    // `--git-common-dir` may be relative (e.g. `.git`) — resolve against cwd
    // before taking the parent so the comparison is absolute-path-stable.
    return dirname(resolve(cwd, common)) !== toplevel;
  } catch {
    return false;
  }
}

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
 * Removes skill files/dirs and command alias files that belong to specpower
 * but are no longer shipped by the current version (e.g. renamed or removed
 * skills across versions). Non-specpower entries are left untouched.
 *
 * Tool-aware: nested tools (claude/cac) prune `specpower-*` skill DIRS under
 * `skills/`; flat tools (opencode) prune `specpower-*.md` skill FILES under
 * `agent/`. The command scan dir also varies per tool.
 *
 * @returns Human-readable paths of everything removed.
 */
async function cleanStale(
  tool: ToolAdapter,
  toolRoot: string,
): Promise<string[]> {
  const removed: string[] = [];
  const validSkills = new Set(currentSkillDirs());
  const validCommands = new Set(currentCommandFiles());
  const skillScanDir = join(toolRoot, tool.skillsScanSubdir);
  const commandScanDir = join(toolRoot, tool.commandsScanSubdir);
  const flat = tool.skillLayout === 'flat';

  try {
    const entries = await fs.readdir(skillScanDir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const matches =
          flat
            ? entry.isFile() &&
              entry.name.startsWith(SPECPOWER_SKILL_PREFIX) &&
              entry.name.endsWith('.md')
            : entry.isDirectory() &&
              entry.name.startsWith(SPECPOWER_SKILL_PREFIX);
        if (!matches) {
          return;
        }
        const canonical = flat ? entry.name.replace(/\.md$/, '') : entry.name;
        if (!validSkills.has(canonical)) {
          await fs.rm(join(skillScanDir, entry.name), {
            recursive: true,
            force: true,
          });
          removed.push(`${tool.skillsScanSubdir}/${entry.name}`);
        }
      }),
    );
  } catch {
    // skills dir does not exist yet — nothing to clean.
  }

  try {
    const entries = await fs.readdir(commandScanDir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (
          entry.isFile() &&
          entry.name.endsWith('.md') &&
          !validCommands.has(entry.name)
        ) {
          await fs.rm(join(commandScanDir, entry.name), { force: true });
          removed.push(`${tool.commandsScanSubdir}/${entry.name}`);
        }
      }),
    );
  } catch {
    // command dir does not exist yet — nothing to clean.
  }

  return removed;
}

/**
 * Refreshes specpower assets from the installed package into the active
 * tool's root directory (project or user scope).
 *
 * @param opts - Sync options (scope, projectRoot override).
 * @returns SyncResult describing what was refreshed and pruned.
 */
export async function syncAssets(
  opts: SyncOptions = {},
): Promise<SyncResult> {
  const scope: 'project' | 'user' = opts.user ? 'user' : 'project';
  const packageRoot = findPackageRoot();
  const projectRoot = opts.projectRoot ?? process.cwd();
  const tool = await resolveTool(process.env.SPECPOWER_TOOL);
  const toolRoot =
    scope === 'user'
      ? join(homedir(), tool.rootDir)
      : join(projectRoot, tool.rootDir);

  const removed = await cleanStale(tool, toolRoot);

  // Refresh skills + command aliases, emitting through the tool adapter.
  // User scope rewrites prompt refs to the installed package (per adapter).
  await copySkillsAndCommands(tool, toolRoot, packageRoot, { scope });

  const refreshed = [...currentSkillDirs(), tool.commandsScanSubdir];

  if (scope === 'project') {
    // Project skills reference prompts/schemas/templates via relative paths
    // resolved against the project cwd, so copy them next to the skills.
    await copyPrompts(tool, toolRoot, packageRoot);
    await copySchemas(toolRoot, packageRoot);
    await copyTemplates(toolRoot, packageRoot);
    await copyCustom(projectRoot, packageRoot);
    // Expand `!include` directives in custom rule files into literal text,
    // right after copyCustom copies the package-root custom/ in place.
    await bakeCustomIncludes(projectRoot, tool.rootDir);
    refreshed.push('prompts', 'schemas', 'templates', 'custom');

    // Stamp the installed version into config.yaml so a later `specpower init`
    // sees `equal` instead of re-offering to sync the (now-current) assets.
    // Surgical: only the `version:` line is touched, preserving comments.
    //
    // Skip the stamp inside a linked git worktree: mutating the worktree's
    // tracked config.yaml would pollute `git diff`/PR noise, and the version
    // is reconciled the next time sync runs against the main checkout.
    if (!isInsideWorktree(projectRoot)) {
      await stampVersionInConfig(projectRoot, readPackageVersion(packageRoot));
    }
  }

  return {
    status: 'synced',
    scope,
    tool: tool.id,
    target: toolRoot,
    packageRoot,
    refreshed,
    removed,
    message: `Synced specpower assets (${scope}, tool: ${tool.id}) to ${toolRoot}.`,
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
        '(--user targets ~/.<rootDir>; tool via `specpower config` or SPECPOWER_TOOL)',
    )
    .option(
      '--user',
      'Sync to user-level ~/.<rootDir> instead of the current project',
    )
    .action(async (opts: SyncOptions) => {
      await maybeToolHint();
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
