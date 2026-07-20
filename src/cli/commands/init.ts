/**
 * CLI command: specpower init
 *
 * Initializes a project with specpower directory structure,
 * skills, commands, prompts, schemas, and templates.
 */

import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import * as fsSync from 'node:fs';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { Command } from 'commander';
import { compareVersions } from '../../utils/version.js';

/**
 * How the installed package version relates to the version recorded in a
 * project's `specpower/config.yaml` at init time.
 */
export type VersionDrift =
  /** Config has a recorded version equal to the installed package. */
  | 'equal'
  /** Installed package is newer than the recorded version → skills are stale. */
  | 'newer'
  /** Installed package is older than the recorded version → downgraded. */
  | 'older'
  /** No version recorded (project was init'd by an older specpower that did not stamp it). */
  | 'unknown';

/**
 * Result of comparing the installed package version against a project's
 * recorded init-time version. Exported for testing the drift logic without a
 * live TTY.
 */
export interface DriftInfo {
  readonly drift: VersionDrift;
  readonly current: string;
  readonly stored: string | null;
}

/**
 * Result of an init operation.
 */
export interface InitResult {
  readonly status: 'initialized' | 'already_initialized' | 'synced';
  readonly message: string;
  /** Present when init declined to run because the project was already initialized. */
  readonly drift?: DriftInfo;
}

/**
 * Options for {@link initProject}. Exposed for tests to inject a non-interactive
 * confirmation callback; the CLI action leaves it unset so the default
 * TTY-aware prompt is used.
 */
export interface InitProjectOptions {
  /**
   * Returns true when the user accepts the offer to sync after a version
   * drift is detected. Default prompts on stdin only when it is a TTY;
   * returns false (no sync) otherwise so init never blocks in CI/pipes.
   */
  readonly confirmSync?: (drift: DriftInfo) => Promise<boolean>;
}

/**
 * The 10 specpower commands, in canonical order.
 *
 * Exported so `specpower sync` can iterate the canonical set when refreshing
 * skills/commands and pruning stale entries left by older versions.
 */
export const COMMAND_NAMES = [
  'scan',
  'plan',
  'refine',
  'build',
  'review',
  'test',
  'verify',
  'done',
  'fix',
  'snap',
] as const;

type CommandName = (typeof COMMAND_NAMES)[number];

/**
 * Default descriptions for command aliases when no SKILL.md frontmatter is available.
 */
const DEFAULT_DESCRIPTIONS: Readonly<Record<CommandName, string>> = {
  scan: 'Brownfield project scanner via code-review-graph',
  plan: 'Create proposal and spec artifacts for a change',
  refine: 'Refine and iterate on spec artifacts',
  build: 'Implement tasks from a change spec',
  review: 'Review code changes against spec',
  test: 'Run tests and verify coverage',
  verify: 'Verify implementation matches spec',
  done: 'Finalize and archive a completed change',
  fix: 'Debug and fix failing tests or builds',
  snap: 'Snapshot current project state',
};

/**
 * Builds the config.yaml body for a new project, stamping the installed
 * package version so re-running `specpower init` later can detect whether the
 * installed package is newer than what init'd this project.
 */
function buildConfigYaml(version: string): string {
  return `schema: specpower
version: ${version}

# Project context (customize for your project)
# context: |
#   Tech stack: ...
#   Architecture: ...
`;
}

/**
 * Reads the specpower package version from `packageRoot/package.json`.
 */
export function readPackageVersion(packageRoot: string): string {
  const pkgJsonPath = join(packageRoot, 'package.json');
  const pkg = JSON.parse(fsSync.readFileSync(pkgJsonPath, 'utf-8')) as {
    version?: string;
  };
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

/**
 * Resolves the package root by walking up from the current module until
 * a directory containing package.json is found.
 *
 * Exported so `specpower sync` can locate the installed package's skills,
 * prompts, schemas, and templates regardless of cwd.
 */
export function findPackageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  let dir = join(currentFile, '..');
  const root = '/';

  while (dir !== root) {
    if (fsSync.existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    dir = join(dir, '..');
  }

  throw new Error(
    'Could not find package root (no package.json found in parent directories)',
  );
}

/**
 * Checks whether the project is already initialized.
 */
async function isAlreadyInitialized(projectRoot: string): Promise<boolean> {
  try {
    const specpowerPrompts = join(projectRoot, '.claude', 'specpower');
    const configYaml = join(projectRoot, 'specpower', 'config.yaml');

    const [promptsStat, configStat] = await Promise.allSettled([
      fs.stat(specpowerPrompts),
      fs.stat(configYaml),
    ]);

    return (
      (promptsStat.status === 'fulfilled' && promptsStat.value.isDirectory()) ||
      (configStat.status === 'fulfilled' && configStat.value.isFile())
    );
  } catch {
    return false;
  }
}

/**
 * Recursively copies a directory from src to dest.
 * Creates dest and all intermediate directories as needed.
 *
 * Exported for reuse by `specpower sync`.
 */
export async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);

      if (entry.isDirectory()) {
        await copyDirRecursive(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath);
      }
    }),
  );
}

/**
 * Extracts the description from SKILL.md frontmatter.
 * Returns the default description if no frontmatter is found.
 *
 * Exported for reuse by `specpower sync`.
 */
export function extractSkillDescription(
  content: string,
  commandName: CommandName,
): string {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return DEFAULT_DESCRIPTIONS[commandName];
  }

  const descMatch = frontmatterMatch[1].match(
    /description:\s*["']?(.+?)["']?\s*$/m,
  );
  return descMatch ? descMatch[1] : DEFAULT_DESCRIPTIONS[commandName];
}

/**
 * Generates a command alias markdown file.
 *
 * Exported for reuse by `specpower sync`.
 */
export function generateCommandAlias(
  commandName: CommandName,
  description: string,
): string {
  return [
    '---',
    `description: "${description}"`,
    '---',
    `Invoke the specpower:${commandName} skill.`,
    '',
  ].join('\n');
}

/**
 * Creates the specpower directory structure.
 */
async function createDirectoryStructure(projectRoot: string): Promise<void> {
  await Promise.all([
    fs.mkdir(join(projectRoot, 'specpower', 'changes'), { recursive: true }),
    fs.mkdir(join(projectRoot, 'specpower', 'specs'), { recursive: true }),
  ]);
}

/**
 * Writes the config.yaml file, stamping the installed package version.
 */
async function writeConfig(
  projectRoot: string,
  version: string,
): Promise<void> {
  await fs.writeFile(
    join(projectRoot, 'specpower', 'config.yaml'),
    buildConfigYaml(version),
    'utf-8',
  );
}

/**
 * Reads the `version` field recorded in a project's `specpower/config.yaml`.
 * Returns `null` when the file has no `version:` field (e.g. a project that
 * was init'd by an older specpower that did not stamp one).
 */
export function readStoredVersion(projectRoot: string): string | null {
  const configPath = join(projectRoot, 'specpower', 'config.yaml');
  const content = fsSync.readFileSync(configPath, 'utf-8');
  const match = content.match(/^[ \t]*version:[ \t]*(\S+)[ \t]*$/m);
  return match ? match[1] : null;
}

/**
 * Determines how the installed package version relates to the version recorded
 * at init time. Pure (no I/O beyond reading config), so it is safe to unit-test
 * without a live TTY.
 */
export function detectVersionDrift(
  projectRoot: string,
  packageRoot: string,
): DriftInfo {
  const current = readPackageVersion(packageRoot);
  const stored = readStoredVersion(projectRoot);
  if (stored === null) {
    return { drift: 'unknown', current, stored: null };
  }
  const cmp = compareVersions(current, stored);
  return {
    drift: cmp === 0 ? 'equal' : cmp > 0 ? 'newer' : 'older',
    current,
    stored,
  };
}

/**
 * Stamps the `version:` field of a project's `specpower/config.yaml` with the
 * installed package version, surgically replacing or inserting the line so the
 * file's comments and hand-edits are preserved (no full YAML re-serialize).
 *
 * Exported so `specpower sync` can record the version it refreshed the assets
 * to, letting a subsequent `specpower init` see `equal` instead of re-prompting.
 */
export async function stampVersionInConfig(
  projectRoot: string,
  version: string,
): Promise<void> {
  const configPath = join(projectRoot, 'specpower', 'config.yaml');
  let content: string;
  try {
    content = await fs.readFile(configPath, 'utf-8');
  } catch {
    // No config.yaml (e.g. user-level sync has no project config) — nothing to stamp.
    return;
  }

  const versionLine = `version: ${version}`;
  const versionRe = /^[ \t]*version:[ \t]*.*$/m;
  if (versionRe.test(content)) {
    const updated = content.replace(versionRe, versionLine);
    if (updated !== content) {
      await fs.writeFile(configPath, updated, 'utf-8');
    }
    return;
  }

  // No version line yet: insert it right after the `schema:` line, or at the top.
  const lines = content.split(/\r?\n/);
  const insertAt = lines.findIndex((l) => /^[ \t]*schema:/.test(l));
  if (insertAt === -1) {
    lines.unshift(versionLine);
  } else {
    lines.splice(insertAt + 1, 0, versionLine);
  }
  await fs.writeFile(configPath, lines.join('\n'), 'utf-8');
}

/**
 * Default confirmation prompt for syncing after a drift is detected. Only
 * prompts when stdin is a TTY; returns false (decline) otherwise so `init`
 * never blocks in CI, pipes, or other non-interactive contexts.
 */
async function confirmSyncByDefault(drift: DriftInfo): Promise<boolean> {
  if (!input.isTTY) {
    return false;
  }
  const storedDesc =
    drift.stored === null
      ? 'no version recorded'
      : `v${drift.stored} was used to init`;
  const question =
    `Installed specpower is v${drift.current} (${storedDesc} this project). ` +
    `Run sync now to refresh skills? [y/N] `;
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * Options for {@link copySkillsAndCommands}.
 */
export interface CopySkillsAndCommandsOptions {
  /**
   * When set, rewrite relative prompt references inside each SKILL.md from
   * `.claude/specpower/prompts/...` to an absolute path under this package
   * root (`<packageRoot>/prompts/...`).
   *
   * Used by `specpower sync --user`: user-level skills live in `~/.claude`
   * but the prompts they reference are resolved by Claude relative to the
   * session cwd (the project), not the home dir. Pointing them straight at
   * the installed package keeps a single source of truth that updates with
   * `npm install -g specpower@latest`, and avoids copying prompts per-user.
   */
  readonly rewritePromptPaths?: string;
}

/**
 * Rewrite the relative prompt path prefix inside a SKILL.md body to point at
 * the installed package's `prompts/` directory. Backslashes are normalized to
 * forward slashes so the path reads correctly on every platform.
 */
function rewritePromptPaths(content: string, packageRoot: string): string {
  const pkg = packageRoot.replace(/\\/g, '/');
  return content.replace(/\.claude\/specpower\/prompts\//g, `${pkg}/prompts/`);
}

/**
 * Copies skill SKILL.md files and generates command aliases.
 *
 * @param claudeRoot - The `.claude` directory to write into (project or user)
 * @param packageRoot - Absolute path to the specpower package root
 * @param opts - Optional prompt-path rewrite for user-level installs
 */
export async function copySkillsAndCommands(
  claudeRoot: string,
  packageRoot: string,
  opts: CopySkillsAndCommandsOptions = {},
): Promise<void> {
  const skillsSourceDir = join(packageRoot, 'skills');
  const skillsDestDir = join(claudeRoot, 'skills');
  const commandsDestDir = join(claudeRoot, 'commands', 'specpower');

  await fs.mkdir(commandsDestDir, { recursive: true });

  await Promise.all(
    COMMAND_NAMES.map(async (cmd) => {
      const skillDirName = `specpower-${cmd}`;
      const srcSkillDir = join(skillsSourceDir, skillDirName);
      const destSkillDir = join(skillsDestDir, skillDirName);
      const srcSkillMd = join(srcSkillDir, 'SKILL.md');

      // Copy SKILL.md if it exists, otherwise create a placeholder
      await fs.mkdir(destSkillDir, { recursive: true });

      let description = DEFAULT_DESCRIPTIONS[cmd];

      try {
        const content = await fs.readFile(srcSkillMd, 'utf-8');
        description = extractSkillDescription(content, cmd);
        const written = opts.rewritePromptPaths
          ? rewritePromptPaths(content, opts.rewritePromptPaths)
          : content;
        await fs.writeFile(join(destSkillDir, 'SKILL.md'), written, 'utf-8');
      } catch {
        // SKILL.md not yet available; write a placeholder
        const placeholder = [
          '---',
          `name: ${skillDirName}`,
          `description: "${DEFAULT_DESCRIPTIONS[cmd]}"`,
          '---',
          '',
          `# SpecPower: ${cmd.charAt(0).toUpperCase() + cmd.slice(1)}`,
          '',
          'Skill content pending.',
          '',
        ].join('\n');
        await fs.writeFile(join(destSkillDir, 'SKILL.md'), placeholder, 'utf-8');
      }

      // Generate command alias
      const aliasContent = generateCommandAlias(cmd, description);
      await fs.writeFile(join(commandsDestDir, `${cmd}.md`), aliasContent, 'utf-8');
    }),
  );
}

/**
 * Copies prompts directory recursively.
 *
 * @param claudeRoot - The `.claude` directory to write into
 * @param packageRoot - Absolute path to the specpower package root
 */
export async function copyPrompts(
  claudeRoot: string,
  packageRoot: string,
): Promise<void> {
  const src = join(packageRoot, 'prompts');
  const dest = join(claudeRoot, 'specpower', 'prompts');
  await copyDirRecursive(src, dest);
}

/**
 * Copies schemas directory recursively.
 *
 * @param claudeRoot - The `.claude` directory to write into
 * @param packageRoot - Absolute path to the specpower package root
 */
export async function copySchemas(
  claudeRoot: string,
  packageRoot: string,
): Promise<void> {
  const src = join(packageRoot, 'schemas');
  const dest = join(claudeRoot, 'specpower', 'schemas');
  await copyDirRecursive(src, dest);
}

/**
 * Copies templates directory recursively.
 *
 * @param claudeRoot - The `.claude` directory to write into
 * @param packageRoot - Absolute path to the specpower package root
 */
export async function copyTemplates(
  claudeRoot: string,
  packageRoot: string,
): Promise<void> {
  const src = join(packageRoot, 'templates');
  const dest = join(claudeRoot, 'specpower', 'templates');
  await copyDirRecursive(src, dest);
}

/**
 * Initializes a project with specpower directory structure, skills,
 * commands, prompts, schemas, and templates.
 *
 * @param projectRoot - Absolute path to the target project root
 * @param packageRoot - Absolute path to the specpower package root
 * @param opts - Optional injection point (e.g. a non-interactive sync
 *   confirmation) for tests; the CLI action leaves it unset.
 * @returns InitResult indicating success, already-initialized (with optional
 *   drift info), or synced (when the user accepted the sync offer).
 */
export async function initProject(
  projectRoot: string,
  packageRoot: string,
  opts: InitProjectOptions = {},
): Promise<InitResult> {
  if (await isAlreadyInitialized(projectRoot)) {
    return handleAlreadyInitialized(projectRoot, packageRoot, opts);
  }

  const version = readPackageVersion(packageRoot);

  await createDirectoryStructure(projectRoot);
  await writeConfig(projectRoot, version);

  const claudeRoot = join(projectRoot, '.claude');

  await Promise.all([
    copySkillsAndCommands(claudeRoot, packageRoot),
    copyPrompts(claudeRoot, packageRoot),
    copySchemas(claudeRoot, packageRoot),
    copyTemplates(claudeRoot, packageRoot),
  ]);

  await updateGitignore(projectRoot);

  return {
    status: 'initialized',
    message: `Initialized specpower project at ${projectRoot} (v${version})`,
  };
}

/**
 * Builds the already-initialized result, layering in version-drift handling:
 *
 * - `equal`: nothing to do — installed package matches the init-time version.
 * - `newer` / `unknown`: the installed package's skills are ahead of the
 *   project's copies. Offer to sync (interactive only on a TTY; declines
 *   silently otherwise so init never blocks in CI). When the user accepts,
 *   run `syncAssets` (project scope) and return a `synced` result.
 * - `older`: the installed package is older than what init'd this project.
 *   Warn only — do not auto-sync, since syncing down would regress the
 *   project's skills to an older version.
 */
async function handleAlreadyInitialized(
  projectRoot: string,
  packageRoot: string,
  opts: InitProjectOptions,
): Promise<InitResult> {
  const drift = detectVersionDrift(projectRoot, packageRoot);
  const base = `Project at ${projectRoot} is already initialized. ` +
    `Remove specpower/config.yaml or .claude/specpower/ to reinitialize.`;

  if (drift.drift === 'equal') {
    return { status: 'already_initialized', message: base, drift };
  }

  if (drift.drift === 'older') {
    const msg =
      `${base} (Installed v${drift.current} is OLDER than the v${drift.stored} ` +
      `that init'd this project — skills may be ahead of the installed package. ` +
      `Reinstall specpower@${drift.stored} or run \`specpower sync\` to align down.)`;
    return { status: 'already_initialized', message: msg, drift };
  }

  // newer or unknown: offer to sync.
  const confirm = opts.confirmSync ?? confirmSyncByDefault;
  const accepted = await confirm(drift);
  if (!accepted) {
    const storedDesc =
      drift.stored === null ? 'no version was recorded' : `v${drift.stored} init'd it`;
    const hint =
      `Project at ${projectRoot} is already initialized. Installed specpower is ` +
      `v${drift.current} (${storedDesc}); skills may be stale. Run \`specpower sync\` to refresh.`;
    return { status: 'already_initialized', message: hint, drift };
  }

  // Lazy import to avoid a static init <-> sync import cycle (sync already
  // depends on init's exported helpers).
  const { syncAssets } = await import('./sync.js');
  await syncAssets({ projectRoot });
  return {
    status: 'synced',
    message:
      `Synced specpower assets at ${projectRoot} to v${drift.current} ` +
      `(init-time version${drift.stored ? ` v${drift.stored}` : ' was not recorded'}).`,
    drift,
  };
}

/**
 * Append specpower-generated paths to .gitignore if not already present.
 *
 * Rationale:
 * - `.claude/skills/` and `.claude/commands/` should be tracked (shared across team).
 * - `.claude/specpower/prompts|schemas|templates/` are regeneratable via `specpower init`
 *   and pollute diffs when tracked. These get ignored.
 */
async function updateGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = join(projectRoot, '.gitignore');
  const markerStart = '# Added by specpower init (regeneratable assets)';
  const markerEnd = '# End specpower init';
  const block = [
    markerStart,
    '.claude/specpower/prompts/',
    '.claude/specpower/schemas/',
    '.claude/specpower/templates/',
    markerEnd,
    '',
  ].join('\n');

  let existing = '';
  try {
    existing = await fs.readFile(gitignorePath, 'utf-8');
  } catch (error: unknown) {
    if (
      !(error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT')
    ) {
      throw error;
    }
  }

  if (existing.includes(markerStart)) {
    return;
  }

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await fs.writeFile(gitignorePath, existing + separator + '\n' + block, 'utf-8');
}

/**
 * Registers the `init` command with Commander.
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a project with specpower directory structure and assets')
    .option(
      '-y, --yes',
      'If already initialized and the installed version is newer, run sync without prompting',
    )
    .action(async (opts: { yes?: boolean }) => {
      const projectRoot = process.cwd();
      const packageRoot = findPackageRoot();
      const result = await initProject(projectRoot, packageRoot, {
        // `--yes` short-circuits the TTY prompt: accept any sync offer
        // unconditionally, so `init -y` works in non-interactive contexts.
        confirmSync: opts.yes
          ? async () => true
          : undefined,
      });

      if (result.status === 'already_initialized') {
        console.warn(`Warning: ${result.message}`);
      } else {
        console.info(result.message);
      }
    });
}
