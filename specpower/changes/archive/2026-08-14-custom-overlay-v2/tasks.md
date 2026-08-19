# custom-overlay-v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use specpower:build Phase B (recommended) or specpower:build Phase B (inline mode) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver custom overlay rules via sync-bake into prompt-file placeholders (eliminate controller LLM dependency); `!include` fail-fast with wildcard support; include-roots defaults widest; worktree sync skips config stamp; per-file once.

**Architecture:** `custom-bake.ts` at init/sync recursively bakes `!include` (incl. wildcard `dir/*.md`) + bakes custom content into 4 prompt-file placeholders (deterministic TS; 4 mappings: coding→implementer-prompt+receiving-code-review; review→code-reviewer-prompt+code-review.md). All failures throw (fail-fast). worktree sync auto-detects and skips stamp. D9 subagent self-check + D11 controller residue check as fallbacks.

**Tech Stack:** TypeScript, commander, js-yaml, vitest

---

## 1. custom-bake.ts

### Task 1.1: DEFAULT_INCLUDE_ROOTS default value

**Files:**
- Modify: `src/cli/commands/custom-bake.ts` (`DEFAULT_INCLUDE_ROOTS` constant)

- [ ] **Step 1: change the constant**

```ts
const DEFAULT_INCLUDE_ROOTS = ['specpower/', 'docs/', 'arch/', 'design/'];
```

- [ ] **Step 2: Verify**

Run: `npm run build`
Verify: exit 0, no tsc errors

### Task 1.2: D4 all-throw (file-not-found/out-of-sandbox from degrade to throw)

**Files:**
- Modify: `src/cli/commands/custom-bake.ts` (expandFile target realpath catch + sandbox check)
- Modify: `test/cli/custom-bake.test.ts` ("degrades to comment" cases → "throws")

- [ ] **Step 1: change tests to expect throw**

```ts
it('throws on missing target (fail-fast)', async () => {
  await write(join(dir, 'specpower', 'config.yaml'),
    'schema: specpower\ncustom:\n  include-roots: [docs/]\n');
  await write(join(dir, 'specpower', 'custom', 'coding', 'a.md'),
    '!include docs/missing.md\n');
  await expect(bake()).rejects.toThrow(/file not found: docs\/missing\.md/);
});

it('throws on out-of-sandbox target (fail-fast, no leak)', async () => {
  await write(join(dir, '..', 'escape.md'), 'secret\n');
  await write(join(dir, 'specpower', 'custom', 'coding', 'a.md'),
    '!include ../escape.md\n');
  await expect(bake()).rejects.toThrow(/outside include-roots/);
});
```

- [ ] **Step 2: run tests, confirm FAIL**

Run: `npx vitest run test/cli/custom-bake.test.ts`
Verify: FAIL (current impl degrades, doesn't throw)

- [ ] **Step 3: change impl — target realpath catch throws**

`src/cli/commands/custom-bake.ts` expandFile target realpath catch + sandbox check → throw:

```ts
let realTarget: string;
try {
  realTarget = fsSync.realpathSync(target);
} catch {
  throw includeError(ctx, absFile, i + 1, directive, `file not found: ${inc}`);
}

if (!isUnderAnyRoot(realTarget, ctx.roots)) {
  const rootNames = ctx.roots.map((r) => relative(ctx.projectRoot, r) || r).join(', ');
  throw includeError(ctx, absFile, i + 1, directive, `target is outside include-roots [${rootNames}]`);
}
```

- [ ] **Step 4: delete stale "degrade" tests + run pass**

Run: `npx vitest run test/cli/custom-bake.test.ts`
Verify: PASS

### Task 1.3: D7 per-top-level-file seen

**Files:**
- Modify: `src/cli/commands/custom-bake.ts` (bakeCustomIncludes ctx → per-file)
- Modify: `test/cli/custom-bake.test.ts` (cross-file not-dedup case)

- [ ] **Step 1: add cross-file test**

```ts
it('does NOT deduplicate cross-file includes (per-top-level-file seen)', async () => {
  await write(join(dir, 'specpower', 'config.yaml'),
    'schema: specpower\ncustom:\n  include-roots: [docs/]\n');
  await write(join(dir, 'docs', 'shared.md'), 'SHARED-MARKER\n');
  await write(join(dir, 'specpower', 'custom', 'coding', 'a.md'),
    '!include docs/shared.md\n');
  await write(join(dir, 'specpower', 'custom', 'review', 'b.md'),
    '!include docs/shared.md\n');
  await bake();
  const a = await read(join(dir, 'specpower', 'custom', 'coding', 'a.md'));
  const b = await read(join(dir, 'specpower', 'custom', 'review', 'b.md'));
  expect(a).toContain('SHARED-MARKER');
  expect(b).toContain('SHARED-MARKER');
});
```

- [ ] **Step 2: run, confirm FAIL** (current seen is global, b.md starved)

Run: `npx vitest run test/cli/custom-bake.test.ts -t "cross-file"`
Verify: FAIL

- [ ] **Step 3: change impl — per-file ctx**

```ts
export async function bakeCustomIncludes(projectRoot: string): Promise<void> {
  const roots = await resolveIncludeRoots(projectRoot);
  let totalBytes = 0;
  for (const kind of ['coding', 'review'] as const) {
    const dir = join(projectRoot, 'specpower', 'custom', kind);
    let entries: fsSync.Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { continue; }
    const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort();
    for (const name of mdFiles) {
      const file = join(dir, name);
      const ctx: BakeCtx = { projectRoot, roots, stack: new Set(), seen: new Set(), totalBytes };
      const expanded = await expandFile(file, ctx);
      totalBytes = ctx.totalBytes;
      await fs.writeFile(file, expanded, 'utf-8');
    }
  }
  await bakePrompts(projectRoot);
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run test/cli/custom-bake.test.ts`
Verify: PASS (cross-file + diamond-once both pass)

### Task 1.4: D1 prompt-placeholder baking (4 mappings)

**Files:**
- Modify: `src/cli/commands/custom-bake.ts` (add bakePrompts + 4 mappings + call at end)
- Modify: `test/cli/custom-bake.test.ts` (prompt baking test)

- [ ] **Step 1: add prompt baking test**

```ts
it('bakes prompt placeholders: coding custom replaces [CONTROLLER:...] in implementer-prompt', async () => {
  await write(join(dir, 'specpower', 'config.yaml'), 'schema: specpower\n');
  await write(join(dir, 'specpower', 'custom', 'coding', 'rules.md'), 'C-RULE\n');
  await write(join(dir, '.claude', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'),
    'X\n[CONTROLLER: paste coding rules here]\nY\n');
  await bake();
  const ip = await read(join(dir, '.claude', 'specpower', 'prompts', 'shared', 'implementer-prompt.md'));
  expect(ip).toContain('C-RULE');
  expect(ip).not.toMatch(/^[ \t]*\[CONTROLLER:[^\]]*\][ \t]*$/m);
});
```

- [ ] **Step 2: run, confirm FAIL**

Run: `npx vitest run test/cli/custom-bake.test.ts -t "prompt placeholders"`
Verify: FAIL (no bakePrompts)

- [ ] **Step 3: add bakePrompts impl**

```ts
const PROMPT_PLACEHOLDER_MAP: Array<{ kind: 'coding' | 'review'; promptRel: string }> = [
  { kind: 'coding', promptRel: join('.claude', 'specpower', 'prompts', 'shared', 'implementer-prompt.md') },
  { kind: 'coding', promptRel: join('.claude', 'specpower', 'prompts', 'shared', 'receiving-code-review.md') },
  { kind: 'review', promptRel: join('.claude', 'specpower', 'prompts', 'shared', 'code-reviewer-prompt.md') },
  { kind: 'review', promptRel: join('.claude', 'specpower', 'prompts', 'review', 'code-review.md') },
];

async function bakePrompts(projectRoot: string): Promise<void> {
  const byKind = { coding: await readCustomConcat(projectRoot, 'coding'),
                   review: await readCustomConcat(projectRoot, 'review') };
  for (const { kind, promptRel } of PROMPT_PLACEHOLDER_MAP) {
    const promptPath = join(projectRoot, promptRel);
    let text: string;
    try { text = await fs.readFile(promptPath, 'utf-8'); }
    catch { continue; }
    // whole-line placeholder only — do NOT swallow an inline `[CONTROLLER:` in prose (D9 self-check)
    const replaced = text.replace(/^[ \t]*\[CONTROLLER:[^\]\n]*\][ \t]*$/gm, byKind[kind]);
    await fs.writeFile(promptPath, replaced, 'utf-8');
  }
}
```

Call `await bakePrompts(projectRoot);` at end of `bakeCustomIncludes`.

- [ ] **Step 4: Verify**

Run: `npx vitest run test/cli/custom-bake.test.ts`
Verify: PASS

### Task 1.5: D12 wildcard `!include dir/*.md`

**Files:**
- Modify: `src/cli/commands/custom-bake.ts` (add `globToRegex` + wildcard branch in expandFile)
- Modify: `test/cli/custom-bake.test.ts` (wildcard tests)

- [ ] **Step 1: add wildcard tests** (expand lexicographic / no-match throws / dir-missing throws / out-of-sandbox throws / .txt filtered)

- [ ] **Step 2: add `globToRegex` + wildcard branch**

```ts
function globToRegex(pattern: string): RegExp {
  let re = '';
  for (const ch of pattern) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
```

In expandFile, after `const target = resolve(ctx.projectRoot, inc);`, before the single-file ext check, add: if `inc.includes('*') || inc.includes('?')`, resolve dir, sandbox-check dir, readdir, filter `re.test(name) && ALLOWED_EXT.has(extname)`, sort, throw on no-match, recurse each.

- [ ] **Step 3: Verify**

Run: `npx vitest run test/cli/custom-bake.test.ts`
Verify: PASS (wildcard cases pass)

---

## 2. prompt placeholder semantics + D9 self-check

### Task 2.1: 4 prompt placeholders → sync-baked wording

**Files:**
- Modify: `prompts/shared/implementer-prompt.md`, `code-reviewer-prompt.md`, `receiving-code-review.md`, `prompts/review/code-review.md`

- [ ] **Step 1: placeholder sections → "sync-baked" wording** (replaced at init/sync time, do NOT read custom at runtime, missing → `none`)

- [ ] **Step 2: Verify**

Run: `grep -rln "\[CONTROLLER:" prompts/` → 4 files
Run: `grep -rln "sync-baked" prompts/shared/ prompts/review/` → 4 files

### Task 2.2: D9 subagent self-check for placeholder residue

**Files:**
- Modify: 4 prompt placeholder sections

- [ ] **Step 1: add self-check** — "If you see literal `[CONTROLLER:` text (sync bake missing/failed), report DONE_WITH_CONCERNS — do not treat as a rule"

- [ ] **Step 2: Verify**

Run: `grep -rln "sync bake missing" prompts/` → 4 files

---

## 3. init/sync + D10 + D11

### Task 3.1: D10 sync auto-detects worktree, skips stamp

**Files:**
- Modify: `src/cli/commands/sync.ts` (add `isInsideWorktree`, guard `stampVersionInConfig`)
- Modify: `test/cli/sync.test.ts` (worktree no-stamp tests)

- [ ] **Step 1: add worktree detection tests** (isInsideWorktree true in linked worktree, false in plain dir; sync in worktree doesn't change config.yaml version — `git diff --exit-code`)

- [ ] **Step 2: add `isInsideWorktree` + conditional stamp**

```ts
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
export function isInsideWorktree(cwd: string = process.cwd()): boolean {
  try {
    const run = (args: string[]) => execSync(`git ${args.join(' ')}`, { cwd, encoding: 'utf-8', stdio: ['pipe','pipe','pipe'] }).trim();
    const common = run(['rev-parse', '--git-common-dir']);
    const toplevel = run(['rev-parse', '--show-toplevel']);
    if (!common || !toplevel) return false;
    return dirname(resolve(cwd, common)) !== toplevel;
  } catch { return false; }
}
```

`syncAssets` project branch: `if (!isInsideWorktree(projectRoot)) { await stampVersionInConfig(...); }`

- [ ] **Step 3: Verify**

Run: `npx vitest run test/cli/sync.test.ts`
Verify: PASS

### Task 3.2: D11 build-time residue check (controller instruction)

**Files:**
- Modify: `prompts/build/phase-b-execute.md`, `phase-b-review.md`

- [ ] **Step 1: add controller pre-check** — "Before dispatch: if `specpower/custom/{coding,review}/*.md` contains an unresolved `!include` directive line (bake didn't complete / never ran — fail-fast leaves no `!include` lines on success), warn the user to run `specpower sync`. Do not silently proceed with stale/unbaked rules."

- [ ] **Step 2: Verify**

Run: `grep -rln "residue\|!include" prompts/build/phase-b-execute.md prompts/build/phase-b-review.md`
Verify: hits

---

## 4. Docs

### Task 4.1: verify docs reflect final decisions

**Files:**
- Verify: `custom/README.md`, `README.md`, `src/cli/commands/init.ts` (buildConfigYaml comment)

- [ ] **Step 1: check consistency**

Run: `grep -n "specpower/.*docs/.*arch/.*design" custom/README.md`
Verify: default roots appear

Run: `grep -n "fail-fast\|throws" custom/README.md`
Verify: fail-fast policy

- [ ] **Step 2: buildConfigYaml comment**

`init.ts` buildConfigYaml `include-roots` comment:
```yaml
# Default (always allowed, no config needed): specpower/ + docs/ + arch/ + design/
# Add more project doc dirs here (e.g. wiki/):
# custom:
#   include-roots: [wiki/]
```

Run: `npm run build`
Verify: exit 0

---

## 5. Tests + e2e

### Task 5.1: custom-bake tests (all-throw + per-file + prompt baking + wildcard)

**Files:**
- Modify: `test/cli/custom-bake.test.ts`

- [ ] **Step 1: delete all "degrades to comment" cases, replace with "throws"; add cross-file / prompt-baking / wildcard / D9-inline-ref-not-swallowed cases**

Run: `grep -n "degrades\|skipped -->" test/cli/custom-bake.test.ts`
Verify: no output

- [ ] **Step 2: run custom-bake tests**

Run: `npx vitest run test/cli/custom-bake.test.ts`
Verify: PASS

### Task 5.2: prompts-custom-placeholder tests updated

**Files:**
- Modify: `test/cli/prompts-custom-placeholder.test.ts`

- [ ] **Step 1: assert sync-baked wording (not controller-inlined); 4 templates incl. receiving-code-review; D11 residue check in phase-b prompts**

- [ ] **Step 2: Verify**

Run: `npx vitest run test/cli/prompts-custom-placeholder.test.ts`
Verify: PASS

### Task 5.3: full suite + e2e

- [ ] **Step 1: full suite**

Run: `npm test`
Verify: all pass (custom-bake + placeholder + init/sync/adapters no regression)

- [ ] **Step 2: e2e — package-source include + project docs + sync-bake prompt**

```bash
# package-root custom/coding/coding-standards.md: !include docs/coding-style.md (and wildcard docs/rules/*.md)
# build → temp project init + sync
# verify specpower/custom/coding/coding-standards.md expanded (no !include)
# verify .claude/specpower/prompts/shared/implementer-prompt.md placeholder replaced with rule text
# negative: !include docs/missing.md → sync throws abort
```

Verify: custom expanded + prompt placeholder replaced; missing throws

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(custom): sync-bake overlay into prompt placeholders + fail-fast includes + wildcard"
```

Verify: `git log -1 --oneline` shows the new commit
