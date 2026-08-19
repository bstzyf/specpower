/**
 * Archive module.
 *
 * Archives a completed change by:
 * 1. Validating all delta specs in the change
 * 2. Applying deltas to their corresponding main specs
 * 3. Moving the change directory to the archive
 */

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { validateSpec } from './validation/validator.js';
import { applyDeltaSpec } from './specs-apply.js';
import {
  readChangeMetadata,
  writeChangeMetadata,
} from '../utils/change-metadata.js';

export interface ArchiveResult {
  readonly success: boolean;
  readonly errors: readonly string[];
  readonly archivePath?: string;
}

export interface ArchiveOptions {
  /**
   * If true, archive even when the change is not in phase=built.
   * A warning is emitted to stderr when force is applied.
   */
  readonly force?: boolean;
}

/**
 * Recursively list all `.md` files in a directory, returning paths relative to the base dir.
 */
async function listMarkdownFiles(dir: string, base?: string): Promise<readonly string[]> {
  const root = base ?? dir;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const results: string[] = [];

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await listMarkdownFiles(fullPath, root);
        results.push(...nested);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(relative(root, fullPath));
      }
    }

    return results;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return [];
    }
    throw error;
  }
}

/**
 * Get today's date as YYYY-MM-DD string.
 */
function todayDatePrefix(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Archive a completed change.
 *
 * Steps:
 * 0. Validate phase gate: require phase=built unless options.force is true
 * 1. Find all delta spec files in `specpower/changes/<name>/specs/`
 * 2. Validate each delta spec
 * 3. For each delta spec, find the corresponding main spec in `specpower/specs/`
 * 4. Apply deltas to main specs
 * 5. Move the change directory to `specpower/changes/archive/<date>-<name>/`
 * 6. Update archived .specpower.yaml with phase=archived
 * 7. Return success/failure with details
 *
 * @param changeName - The name of the change to archive
 * @param projectRoot - Absolute path to the project root
 * @param options - Optional archive options (e.g. force)
 * @returns An ArchiveResult with success flag, errors, and archive path
 */
export async function archiveChange(
  changeName: string,
  projectRoot: string,
  options: ArchiveOptions = {},
): Promise<ArchiveResult> {
  const changeDir = join(projectRoot, 'specpower', 'changes', changeName);
  const deltaSpecsDir = join(changeDir, 'specs');
  const mainSpecsDir = join(projectRoot, 'specpower', 'specs');

  // 0. Phase gate: require phase=built unless --force
  const metadata = await readChangeMetadata(changeDir);
  const currentPhase = metadata?.phase;

  if (currentPhase !== 'built' && !options.force) {
    const phaseLabel = currentPhase ?? 'unknown';
    return {
      success: false,
      errors: [
        `Cannot archive: change '${changeName}' is in phase '${phaseLabel}', expected 'built'. Complete '/specpower:build' first, or pass '--force' to archive anyway.`,
      ],
    };
  }

  if (options.force && currentPhase !== 'built') {
    const phaseLabel = currentPhase ?? 'unknown';
    console.warn(
      `Warning: archiving "${changeName}" in phase ${phaseLabel} with --force. ` +
        `Consider running /specpower:build first.`,
    );
  }

  // 1. Find delta spec files
  const deltaFiles = await listMarkdownFiles(deltaSpecsDir);

  if (deltaFiles.length === 0) {
    return {
      success: false,
      errors: [`No delta spec files found in ${deltaSpecsDir}`],
    };
  }

  // 1b. test-plan gate: a testable change (delta specs contain ≥1 Scenario)
  //     must have a test-plan.md before archiving. --force skips this gate.
  if (!options.force) {
    const testPlanPath = join(changeDir, 'test-plan.md');
    if (!existsSync(testPlanPath)) {
      let scenarioCount = 0;
      for (const file of deltaFiles) {
        const deltaContent = await fs.readFile(join(deltaSpecsDir, file), 'utf-8');
        scenarioCount += countScenarios(deltaContent);
      }
      if (scenarioCount > 0) {
        return {
          success: false,
          errors: [
            `test-plan.md missing for testable change ${changeName}; run plan Stage 5b or pass --force`,
          ],
        };
      }
    }
  }

  // 2. Validate each delta spec
  const allErrors: string[] = [];

  for (const file of deltaFiles) {
    const deltaContent = await fs.readFile(join(deltaSpecsDir, file), 'utf-8');
    const validation = validateSpec(deltaContent);

    if (!validation.valid) {
      for (const err of validation.errors) {
        allErrors.push(`${file}: ${err.message}`);
      }
    }
  }

  if (allErrors.length > 0) {
    return { success: false, errors: allErrors };
  }

  // 3 & 4. Apply each delta to its corresponding main spec
  for (const file of deltaFiles) {
    const deltaContent = await fs.readFile(join(deltaSpecsDir, file), 'utf-8');
    const mainSpecPath = join(mainSpecsDir, file);
    const mainSpecDir = join(mainSpecPath, '..');
    await fs.mkdir(mainSpecDir, { recursive: true });

    let mainContent: string;
    try {
      mainContent = await fs.readFile(mainSpecPath, 'utf-8');
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        // If main spec doesn't exist yet, start with empty content
        mainContent = '';
      } else {
        throw error;
      }
    }

    const updatedContent = applyDeltaSpec(mainContent, deltaContent);
    await fs.writeFile(mainSpecPath, updatedContent, 'utf-8');
  }

  // 5. Move change directory to archive
  const datePrefix = todayDatePrefix();
  const archiveDir = join(projectRoot, 'specpower', 'changes', 'archive');
  const archiveDest = join(archiveDir, `${datePrefix}-${changeName}`);

  await fs.mkdir(archiveDir, { recursive: true });
  await fs.rename(changeDir, archiveDest);

  // 6. Update archived metadata to phase=archived (preserve other fields)
  const archivedMeta = await readChangeMetadata(archiveDest);
  if (archivedMeta !== null) {
    await writeChangeMetadata(archiveDest, { ...archivedMeta, phase: 'archived' });
  }

  return {
    success: true,
    errors: [],
    archivePath: archiveDest,
  };
}

/**
 * Count `#### Scenario:` header lines in markdown content. Used by the
 * test-plan gate to decide whether a change is "testable" (has ≥1 scenario).
 */
function countScenarios(content: string): number {
  const matches = content.match(/^####\s+Scenario:\s+.+$/gm);
  return matches ? matches.length : 0;
}
