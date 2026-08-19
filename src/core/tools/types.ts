/**
 * Tool adapters: abstract over where each AI coding tool expects specpower's
 * skills/commands to live and what file format it expects.
 *
 * Today init/sync hardcode Claude Code's `.claude/` layout. Adapters let the
 * same source skills be emitted into `.opencode/` (flat agent files with
 * synthesized frontmatter) or `.cac/` (dir-swap) by a tool chosen once at
 * install time. Default is `claude` (zero behavior change for existing users).
 *
 * Note: opencode and cac conventions are best-effort (their docs could not be
 * fetched in the dev environment). The adapter isolates each tool's format so
 * a correction is a one-file change.
 */

/**
 * Supported target tool ids. `claude` is the default and matches prior behavior.
 */
export type ToolId = 'claude' | 'opencode' | 'cac' | 'chrys';

/**
 * Metadata about a source skill, derived from its SKILL.md frontmatter.
 * Passed to {@link ToolAdapter.transformSkill} so adapters can synthesize
 * per-tool frontmatter without re-parsing.
 */
export interface SkillMeta {
  /** Skill dir name, e.g. `specpower-plan`. */
  readonly name: string;
  /** Description extracted from the source SKILL.md frontmatter. */
  readonly description: string;
  /** Canonical command name, e.g. `plan`. */
  readonly command: string;
}

/**
 * Context for {@link ToolAdapter.transformSkill}.
 */
export interface TransformCtx {
  /** `project` writes assets next to the skills (relative prompt refs); `user` rewrites refs to the installed package. */
  readonly scope: 'project' | 'user';
  /** Absolute path to the installed specpower package root (used for user-scope absolute prompt refs). */
  readonly packageRoot: string;
}

/**
 * A target tool's output conventions.
 *
 * Paths are relative to the tool's root dir (`rootDir`), which the caller
 * joins under the project (`<project>/<rootDir>`) or the user home
 * (`<home>/<rootDir>`).
 */
export interface ToolAdapter {
  readonly id: ToolId;
  /** Root directory name in the project, e.g. `.claude`, `.opencode`, `.cac`. */
  readonly rootDir: string;

  /**
   * Relative path (under rootDir) where a skill's emitted file lives.
   * claude/cac: `skills/specpower-plan/SKILL.md`; opencode: `agent/specpower-plan.md`.
   */
  skillDestRelPath(skillDir: string): string;

  /**
   * Relative path (under rootDir) where a command alias file lives.
   * claude/cac: `commands/specpower/plan.md`; opencode: `command/plan.md`.
   */
  commandDestRelPath(command: string): string;

  /** Subdir (under rootDir) to scan when pruning stale skills: `skills` | `agent`. */
  readonly skillsScanSubdir: string;
  /** Subdir (under rootDir) to scan when pruning stale command aliases: `commands/specpower` | `command`. */
  readonly commandsScanSubdir: string;

  /**
   * Whether emitted skill files are flat (opencode `agent/*.md`) vs nested
   * (claude/cac `skills/<dir>/SKILL.md`). Drives stale-pruning: flat tools
   * remove `specpower-*.md` files; nested tools remove `specpower-*` dirs.
   */
  readonly skillLayout: 'flat' | 'nested';

  /**
   * Transform a source SKILL.md into the emitted file content for this tool:
   * rewrite prompt references (project → `<rootDir>/specpower/prompts/`,
   * user → `<packageRoot>/prompts/`) and, for opencode, replace the frontmatter
   * with the tool's agent format.
   */
  transformSkill(srcContent: string, meta: SkillMeta, ctx: TransformCtx): string;
}

/**
 * Shape of the user-level config file (`~/.specpower/config.json`).
 */
export interface UserConfig {
  /** Persisted default tool id; absent means "use claude". */
  readonly tool?: ToolId;
  /** Set true after the first-run hint has been shown, so it never nags twice. */
  readonly hinted?: boolean;
}
