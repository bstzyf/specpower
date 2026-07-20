/**
 * Integration test: Progressive loading paths.
 *
 * For each SKILL.md file, extracts all `.claude/specpower/prompts/...`
 * path references and verifies that the corresponding prompt file
 * actually exists in the package's prompts/ directory.
 *
 * This prevents broken prompt references from shipping.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, resolve, basename, dirname } from 'node:path';
import { existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = resolve(import.meta.dirname, '..', '..');
const SKILLS_DIR = join(PACKAGE_ROOT, 'skills');
const PROMPTS_DIR = join(PACKAGE_ROOT, 'prompts');

/**
 * Regex to extract paths like `.claude/specpower/prompts/build/phase-a-plan.md`
 * from SKILL.md content. Captures the full dotted path.
 */
const PROMPT_PATH_PATTERN = /\.claude\/specpower\/prompts\/([^\s`"']+)/g;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lists all SKILL.md files in the skills directory.
 */
async function listSkillFiles(): Promise<readonly string[]> {
  const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });

  const skillFiles: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const skillMdPath = join(SKILLS_DIR, entry.name, 'SKILL.md');
      if (existsSync(skillMdPath)) {
        skillFiles.push(skillMdPath);
      }
    }
  }

  return skillFiles;
}

/**
 * Extracts all prompt paths from a SKILL.md file content.
 * Returns the relative path within the prompts directory
 * (e.g., "build/phase-a-plan.md").
 */
function extractPromptPaths(content: string): readonly string[] {
  const paths: string[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  const regex = new RegExp(PROMPT_PATH_PATTERN.source, 'g');
  while ((match = regex.exec(content)) !== null) {
    paths.push(match[1]);
  }

  return paths;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Prompt path integrity', () => {
  it('all SKILL.md prompt references resolve to existing files', async () => {
    const skillFiles = await listSkillFiles();

    expect(skillFiles.length).toBe(10);

    const errors: string[] = [];

    for (const skillFile of skillFiles) {
      const content = await fs.readFile(skillFile, 'utf-8');
      const promptPaths = extractPromptPaths(content);

      for (const relativePath of promptPaths) {
        const absolutePath = join(PROMPTS_DIR, relativePath);

        if (!existsSync(absolutePath)) {
          const skillName = basename(dirname(skillFile));
          errors.push(
            `${skillName} references missing prompt: prompts/${relativePath}`,
          );
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `Broken prompt references found:\n${errors.join('\n')}`,
      );
    }
  });

  it('each SKILL.md references at least one prompt or is a non-prompt skill', async () => {
    const skillFiles = await listSkillFiles();

    // Skills that do not reference prompts directly (they use CLI commands or inline logic)
    const noPromptSkills = new Set([
      'specpower-snap',
    ]);

    for (const skillFile of skillFiles) {
      const content = await fs.readFile(skillFile, 'utf-8');
      const promptPaths = extractPromptPaths(content);

      const skillDirName = basename(dirname(skillFile));

      if (noPromptSkills.has(skillDirName)) {
        continue;
      }

      expect(
        promptPaths.length,
        `${skillDirName}/SKILL.md should reference at least one prompt`,
      ).toBeGreaterThan(0);
    }
  });
});
