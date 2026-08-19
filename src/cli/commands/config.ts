/**
 * CLI command: specpower config [get|set|list]
 *
 * Persists the user-level default target tool (`~/.specpower/config.json`),
 * chosen once at install time. `specpower init`/`sync` read this to decide
 * which AI tool's directory layout to emit (claude | opencode | cac).
 *
 * Usage:
 *   specpower config set tool <claude|opencode|cac>   # persist default
 *   specpower config get tool                          # print current
 *   specpower config list                              # list supported tools
 *   specpower config                                    # show current
 */

import type { Command } from 'commander';
import {
  isToolId,
  readUserConfig,
  writeUserConfig,
  resolveTool,
  TOOL_LISTINGS,
} from '../../core/tools/adapters.js';
/**
 * Prints the active tool and where it is sourced from.
 */
async function showCurrent(): Promise<void> {
  const override = process.env.SPECPOWER_TOOL;
  if (override) {
    console.info(`tool: ${override} (from SPECPOWER_TOOL env)`);
    return;
  }
  const cfg = await readUserConfig();
  if (cfg.tool) {
    console.info(`tool: ${cfg.tool} (from ~/.specpower/config.json)`);
  } else {
    console.info('tool: claude (default — run `specpower config set tool <id>` to change)');
  }
}

/**
 * Registers the `config` command group with Commander.
 */
export function registerConfigCommand(program: Command): void {
  const configCmd = program
    .command('config')
    .description('Manage user-level specpower config (default target tool)');

  configCmd
    .command('set <key> <value>')
    .description('Set a config value. Currently only `tool` is supported.')
    .action(async (key: string, value: string) => {
      if (key !== 'tool') {
        console.error(`Unsupported config key '${key}'. Only 'tool' is supported.`);
        process.exitCode = 1;
        return;
      }
      if (!isToolId(value)) {
        console.error(
          `Unknown tool '${value}'. Supported: ${TOOL_LISTINGS.map((t) => t.id).join(', ')}.`,
        );
        process.exitCode = 1;
        return;
      }
      const cur = await readUserConfig();
      await writeUserConfig({ ...cur, tool: value });
      // Confirm the effective tool (also validates the resolve path).
      const adapter = await resolveTool(process.env.SPECPOWER_TOOL);
      console.info(`Set default tool to '${value}'. Emits into ${adapter.rootDir}/.`);
    });

  configCmd
    .command('get <key>')
    .description('Get a config value. Currently only `tool` is supported.')
    .action(async (key: string) => {
      if (key !== 'tool') {
        console.error(`Unsupported config key '${key}'. Only 'tool' is supported.`);
        process.exitCode = 1;
        return;
      }
      const override = process.env.SPECPOWER_TOOL;
      if (override) {
        console.info(override);
        return;
      }
      const cfg = await readUserConfig();
      console.info(cfg.tool ?? 'claude');
    });

  configCmd
    .command('list')
    .description('List supported target tools and mark the active one')
    .action(async () => {
      const active = await resolveTool(process.env.SPECPOWER_TOOL);
      for (const t of TOOL_LISTINGS) {
        const mark = t.id === active.id ? '*' : ' ';
        const exp = t.experimental ? ' (experimental)' : '';
        console.info(`${mark} ${t.id.padEnd(9)} ${t.name}${exp}`);
      }
    });

  // bare `specpower config` → show current
  configCmd.action(showCurrent);
}
