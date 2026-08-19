/**
 * Integration test: Package build verification.
 *
 * Verifies that the TypeScript build produces valid output and
 * that the package structure contains all expected assets.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGE_ROOT = resolve(import.meta.dirname, '..', '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively counts files matching a predicate.
 */
function countFiles(
  dir: string,
  predicate: (name: string) => boolean,
): number {
  if (!existsSync(dir)) return 0;

  let count = 0;
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countFiles(fullPath, predicate);
    } else if (entry.isFile() && predicate(entry.name)) {
      count += 1;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Package build verification', () => {
  it('TypeScript compiles without errors', () => {
    const result = execSync('npx tsc --noEmit', {
      cwd: PACKAGE_ROOT,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    // tsc exits 0 on success; execSync throws on non-zero exit
    expect(result).toBeDefined();
  });

  it('dist/ directory contains the CLI entry point', () => {
    const cliEntry = join(PACKAGE_ROOT, 'dist', 'cli', 'index.js');
    expect(existsSync(cliEntry)).toBe(true);
  });

  it('bin/specpower.js outputs the correct version', () => {
    const pkg = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    );
    const output = execSync('node bin/specpower.js --version', {
      cwd: PACKAGE_ROOT,
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
    expect(output).toBe(pkg.version);
  });

  it('has exactly 10 SKILL.md files', () => {
    const skillsDir = join(PACKAGE_ROOT, 'skills');
    const skillCount = countFiles(skillsDir, (name) => name === 'SKILL.md');
    expect(skillCount).toBe(10);
  });

  it('has at least 20 prompt files', () => {
    const promptsDir = join(PACKAGE_ROOT, 'prompts');
    const promptCount = countFiles(promptsDir, (name) => name.endsWith('.md'));
    expect(promptCount).toBeGreaterThanOrEqual(20);
  });

  it('has exactly 5 templates (incl. test-plan.md)', () => {
    const templatesDir = join(PACKAGE_ROOT, 'templates');
    const templateCount = countFiles(
      templatesDir,
      (name) => name.endsWith('.md'),
    );
    expect(templateCount).toBe(5);
  });

  it('has the specpower schema', () => {
    const schemaPath = join(
      PACKAGE_ROOT,
      'schemas',
      'specpower',
      'schema.yaml',
    );
    expect(existsSync(schemaPath)).toBe(true);
  });

  it('does not declare slow github: git dependencies (install must not git-clone)', () => {
    // code-review-graph was previously an optionalDependency on `github:...`,
    // which made `npm install -g` clone a repo (and build its deps) on every
    // fresh/CI install — minutes of stall on Windows. scan (the only consumer)
    // is [PLANNED v0.3] and not functional, so the dep was removed; assert it
    // stays out so installs stay fast.
    const pkg = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    );
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    };
    expect(allDeps).not.toHaveProperty('code-review-graph');
    // no `github:` / `git+ssh` / `git+https` specifiers anywhere in deps —
    // they all force a git clone at install time.
    for (const [name, spec] of Object.entries(allDeps)) {
      expect(typeof spec).toBe('string');
      expect(String(spec)).not.toMatch(/^(github:|git\+)/);
      // name is just here so a failure names the offending dep
      expect(name).toBeTruthy();
    }
  });

  it('has no stale superpowers references in execution prompts', () => {
    const executionDirs = [
      'prompts/build', 'prompts/refine', 'prompts/fix',
      'prompts/plan', 'prompts/review', 'prompts/test',
      'prompts/verify', 'prompts/done', 'prompts/shared',
    ];
    const stalePatterns = /\b(superpowers|brainstorming skill|writing-plans skill)\b/i;
    const violations: string[] = [];

    for (const dir of executionDirs) {
      const fullDir = join(PACKAGE_ROOT, dir);
      if (!existsSync(fullDir)) continue;
      const files = readdirSync(fullDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const content = readFileSync(join(fullDir, file), 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('<!-- SOURCE:')) continue;
          if (stalePatterns.test(lines[i])) {
            violations.push(`${dir}/${file}:${i + 1}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
