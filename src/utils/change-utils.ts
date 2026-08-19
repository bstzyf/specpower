import { promises as fs, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readChangeMetadata, writeChangeMetadata as writeMetaInternal } from './change-metadata.js';
import type { ChangeMetadata, ChangePhase } from './change-metadata.js';

export { CHANGE_PHASES } from './change-metadata.js';
export type { ChangePhase } from './change-metadata.js';

const CHANGES_REL_PATH = 'specpower/changes';

const VALID_CHANGE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validates that a change name uses only lowercase alphanumeric characters
 * separated by single hyphens. Prevents path traversal and invalid directory names.
 *
 * @param name - The change name to validate
 * @throws When the name does not match the required pattern
 */
export function validateChangeName(name: string): void {
  if (!VALID_CHANGE_NAME.test(name)) {
    throw new Error(`Invalid change name "${name}". Use lowercase alphanumeric with hyphens (e.g., "my-feature").`);
  }
}

/**
 * Returns the relative path for a change directory (with trailing slash).
 *
 * @param changeName - Name of the change (kebab-case)
 * @returns The relative path, e.g. "specpower/changes/my-feature/"
 */
export function getChangeDir(changeName: string): string {
  validateChangeName(changeName);
  return `${CHANGES_REL_PATH}/${changeName}/`;
}

/**
 * Reads the .specpower.yaml metadata for a given change.
 *
 * @param changeName - Name of the change
 * @param projectRoot - Absolute path to the project root
 * @returns The parsed metadata, or null if the file does not exist
 */
export async function getChangeMetadata(
  changeName: string,
  projectRoot: string,
): Promise<ChangeMetadata | null> {
  validateChangeName(changeName);
  const changeDir = join(projectRoot, CHANGES_REL_PATH, changeName);
  return await readChangeMetadata(changeDir);
}

/**
 * Writes .specpower.yaml metadata for a given change.
 * Creates the change directory and parent directories if needed.
 *
 * @param changeName - Name of the change
 * @param metadata - The metadata to write
 * @param projectRoot - Absolute path to the project root
 */
export async function writeChangeMetadata(
  changeName: string,
  metadata: ChangeMetadata,
  projectRoot: string,
): Promise<void> {
  validateChangeName(changeName);
  const changeDir = join(projectRoot, CHANGES_REL_PATH, changeName);
  await writeMetaInternal(changeDir, metadata);
}

/**
 * Updates the `phase` field of an existing change's metadata, preserving all
 * other fields. Throws if the change does not exist.
 *
 * @param changeName - Name of the change
 * @param phase - The new phase value
 * @param projectRoot - Absolute path to the project root (or archive root)
 * @throws When the change does not exist or the name is invalid
 */
export async function updatePhase(
  changeName: string,
  phase: ChangePhase,
  projectRoot: string,
): Promise<void> {
  validateChangeName(changeName);
  const changeDir = join(projectRoot, CHANGES_REL_PATH, changeName);
  const existing = await readChangeMetadata(changeDir);

  if (existing === null) {
    throw new Error(`Change "${changeName}" not found at ${changeDir}`);
  }

  const updated: ChangeMetadata = {
    ...existing,
    phase,
  };

  await writeMetaInternal(changeDir, updated);
}

/**
 * Lists all change directory names under specpower/changes/.
 * Returns an empty array if the directory does not exist or is empty.
 *
 * @param projectRoot - Absolute path to the project root
 * @returns Array of change directory names
 */
export async function listChanges(projectRoot: string): Promise<string[]> {
  const changesDir = join(projectRoot, CHANGES_REL_PATH);

  try {
    const entries = await fs.readdir(changesDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Checks whether a change name is already used — either by an active change
 * (`specpower/changes/<name>`) or by an archived change
 * (`specpower/changes/archive/*-<name>`, matched by `^\d{4}-\d{2}-\d{2}-<name>$`).
 *
 * The test-plan token prefix `[<changeName>-<id>]` depends on the change name
 * being globally unique, so reuse (active or archived) must be rejected.
 *
 * @param name - The change name to check (assumed already validated)
 * @param projectRoot - Absolute path to the project root
 * @returns true if the name is already in use (active or archived)
 */
export function isChangeNameUsed(name: string, projectRoot: string): boolean {
  const active = join(projectRoot, 'specpower', 'changes', name);
  if (existsSync(active)) return true;
  const archiveDir = join(projectRoot, 'specpower', 'changes', 'archive');
  if (!existsSync(archiveDir)) return false;
  const entries = readdirSync(archiveDir);
  // 归档目录名格式 YYYY-MM-DD-<name>；必须精确匹配，避免 "bar" 误匹配 "2026-01-01-foo-bar"
  const re = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escapeRegExp(name)}$`);
  return entries.some((e) => re.test(e) && existsSync(join(archiveDir, e)));
}

/**
 * Escape special regex characters in a string for use in a RegExp constructor.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
