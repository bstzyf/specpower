import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..', '..');
const P = (...segs: string[]) =>
  join(PACKAGE_ROOT, 'prompts', ...segs);

function readPrompt(...segs: string[]): string {
  return readFileSync(P(...segs), 'utf-8');
}

/**
 * Guard against regression of the sync-bake custom-rules wiring (D1 = (d)).
 *
 * The 4 prompts that carry custom-rule placeholders must:
 *  1. contain the `[CONTROLLER: ...]` placeholder (replaced at init/sync
 *     bake time by `bakePrompts` — NOT filled by the controller at runtime);
 *  2. use sync-baked wording (not the old "controller-inlined" runtime-fill);
 *  3. NOT contain the old self-read phrasing "exists and contains markdown
 *     files" that delegated the read to the subagent.
 *
 * Phase B orchestration prompts must say rules are sync-baked (no runtime
 * fill) + run the D11 `!include` residue check. phase-b-worktree setup must
 * run `specpower sync` so gitignored custom/ is regenerated in the worktree.
 */
describe('custom-rule sync-baked placeholders', () => {
  // All 4 prompts now carry a [CONTROLLER: ...] placeholder that bakePrompts
  // replaces at init/sync time (receiving-code-review gained one in the
  // sync-bake rewrite).
  const TEMPLATES = [
    ['shared', 'implementer-prompt.md'],
    ['shared', 'code-reviewer-prompt.md'],
    ['shared', 'receiving-code-review.md'],
    ['review', 'code-review.md'],
  ] as const;

  for (const [dir, file] of TEMPLATES) {
    it(`${dir}/${file} has [CONTROLLER: placeholder + sync-baked wording, no self-read`, () => {
      const text = readPrompt(dir, file);
      expect(text).toContain('[CONTROLLER:');
      expect(text.toLowerCase()).toMatch(/sync-baked|sync 烘焙|init.*sync.*time/);
      // The old guard delegated the read to the subagent ("if exists, read all
      // .md files") — that's the bug being fixed; it must be gone.
      expect(text).not.toContain('exists and contains markdown files');
      // The old runtime-fill wording (controller pastes at dispatch) is gone.
      expect(text).not.toContain('controller-inlined');
    });
  }

  it('phase-b-execute says custom rules are sync-baked (no runtime fill) + D11 residue check', () => {
    const text = readPrompt('build', 'phase-b-execute.md');
    expect(text).toContain('specpower/custom/coding/');
    expect(text.toLowerCase()).toMatch(/sync-baked|bakeprompts|no runtime fill/);
    expect(text).toMatch(/residue|!include/);
  });

  it('phase-b-review says custom review rules are sync-baked + D11 residue check', () => {
    const text = readPrompt('build', 'phase-b-review.md');
    expect(text).toContain('specpower/custom/review/');
    expect(text.toLowerCase()).toMatch(/sync-baked|bakeprompts|no runtime fill/);
    expect(text).toMatch(/residue|!include/);
  });

  it('phase-b-worktree setup runs specpower sync to regenerate gitignored assets in the worktree', () => {
    const text = readPrompt('build', 'phase-b-worktree.md');
    expect(text).toContain('specpower sync');
    expect(text).toContain('specpower/custom/');
  });
});
