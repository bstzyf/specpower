#!/usr/bin/env node
/**
 * postinstall hint — fires once after `npm install -g specpower`.
 *
 * Intentionally prints guidance only and imports nothing from `dist/`, so it
 * works under every install path (npm registry, tarball, git clone without a
 * build, fork release). Non-interactive: never blocks, so it is safe in CI,
 * pipes, and `--silent` contexts (where npm may suppress output anyway).
 *
 * The first-run hint in the CLI itself (`src/core/tools/hint.ts`) is the
 * robust fallback that surfaces when the user actually invokes specpower;
 * this script just tries to catch them at install time too.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const configPath = join(homedir(), '.specpower', 'config.json');

/** True when a user-level tool has already been configured (no need to nag). */
function alreadyConfigured() {
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    return typeof parsed.tool === 'string';
  } catch {
    return false;
  }
}

// Only surface on global installs (`npm install -g`), not on the maintainer's
// local `npm install` for dev deps, so it never nags during development.
const isGlobalInstall = process.env.npm_config_global === 'true';

if (isGlobalInstall && !alreadyConfigured()) {
  process.stdout.write(
    [
      '',
      '┌─ specpower installed ────────────────────────────────────────┐',
      '│ Default target tool: claude  (skills written to .claude/)    │',
      '│ Use OpenCode?  specpower config set tool opencode            │',
      '│ Use CAC?       specpower config set tool cac                 │',
      '│ List tools:    specpower config list                         │',
      '└──────────────────────────────────────────────────────────────┘',
      '',
    ].join('\n') + '\n',
  );
}
