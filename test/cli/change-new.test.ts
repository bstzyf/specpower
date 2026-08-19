import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createChange } from '../../src/cli/commands/change-new.js';
import { isChangeNameUsed } from '../../src/utils/change-utils.js';

describe('createChange', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'change-new-test-'));
  });

  it('creates a change directory with .specpower.yaml', async () => {
    await createChange('my-feature', tmpDir);

    const changeDir = join(tmpDir, 'specpower', 'changes', 'my-feature');
    const stat = await fs.stat(changeDir);
    expect(stat.isDirectory()).toBe(true);

    const metaPath = join(changeDir, '.specpower.yaml');
    const metaStat = await fs.stat(metaPath);
    expect(metaStat.isFile()).toBe(true);
  });

  it('writes .specpower.yaml with schema and created date', async () => {
    await createChange('my-feature', tmpDir);

    const metaPath = join(
      tmpDir,
      'specpower',
      'changes',
      'my-feature',
      '.specpower.yaml',
    );
    const content = await fs.readFile(metaPath, 'utf-8');

    expect(content).toContain('schema: specpower');

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(content).toContain(`created: '${today}'`);
  });

  it('throws error when change name already exists [add-test-plan-artifact-T5]', async () => {
    await createChange('my-feature', tmpDir);

    await expect(createChange('my-feature', tmpDir)).rejects.toThrow(
      /already used/,
    );
  });

  it('throws error for invalid change name with spaces', async () => {
    await expect(createChange('has spaces', tmpDir)).rejects.toThrow(
      /[Ii]nvalid/,
    );
  });

  it('initializes phase to "plan" in .specpower.yaml', async () => {
    await createChange('my-feature', tmpDir);

    const metaPath = join(
      tmpDir,
      'specpower',
      'changes',
      'my-feature',
      '.specpower.yaml',
    );
    const content = await fs.readFile(metaPath, 'utf-8');
    expect(content).toContain('phase: plan');
  });
});

describe('isChangeNameUsed', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'change-name-used-'));
  });

  it('returns true when name exists in active changes', async () => {
    const activeDir = join(root, 'specpower', 'changes', 'exists');
    await fs.mkdir(activeDir, { recursive: true });
    expect(isChangeNameUsed('exists', root)).toBe(true);
  });

  it('returns true when name exists in archive', async () => {
    const archiveDir = join(
      root,
      'specpower',
      'changes',
      'archive',
      '2026-01-01-old',
    );
    await fs.mkdir(archiveDir, { recursive: true });
    expect(isChangeNameUsed('old', root)).toBe(true);
  });

  it('returns false for a fresh name', () => {
    expect(isChangeNameUsed('brand-new', root)).toBe(false);
  });

  it('returns false when archive dir does not exist', () => {
    expect(isChangeNameUsed('anything', root)).toBe(false);
  });

  it('does not false-match a suffix of an archived name', async () => {
    // archive entry 2026-01-01-foo-bar must NOT block the distinct name "bar"
    const archiveDir = join(
      root,
      'specpower',
      'changes',
      'archive',
      '2026-01-01-foo-bar',
    );
    await fs.mkdir(archiveDir, { recursive: true });

    expect(isChangeNameUsed('bar', root)).toBe(false);
    // but the full archived name "foo-bar" IS still considered used
    expect(isChangeNameUsed('foo-bar', root)).toBe(true);
  });
});

describe('createChange reused name rejection', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'change-reuse-'));
  });

  it('rejects a name reused from an archived change', async () => {
    const archiveDir = join(
      root,
      'specpower',
      'changes',
      'archive',
      '2026-01-01-old',
    );
    await fs.mkdir(archiveDir, { recursive: true });

    await expect(createChange('old', root)).rejects.toThrow(/already used/);
  });
});
