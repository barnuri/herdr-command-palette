#!/usr/bin/env node
'use strict';

const { currentPane, openPluginPane } = require('../lib/herdr');
const { ORIGIN_ENV_KEYS } = require('../lib/context');

const DEFAULT_PLUGIN_ID = 'barnuri.command-palette';
const PALETTE_ENTRYPOINT = 'palette';

// A popup has no pane id and its process never receives HERDR_PANE_ID, so it can
// never work out which pane it was opened over. This action can: it runs while
// that pane is still the focused one. Native commands like `tab close <tab_id>`
// take required positional ids, so capturing this is what makes them possible.
function originEnvironment() {
  try {
    const pane = currentPane();
    return {
      [ORIGIN_ENV_KEYS.pane_id]: pane.pane_id,
      [ORIGIN_ENV_KEYS.tab_id]: pane.tab_id,
      [ORIGIN_ENV_KEYS.workspace_id]: pane.workspace_id,
      [ORIGIN_ENV_KEYS.cwd]: pane.foreground_cwd || pane.cwd,
    };
  } catch (error) {
    process.stderr.write(`command-palette: could not read the current pane: ${error.message}\n`);
    // The invocation's own env still carries ids when the action was raised from a
    // workspace or tab context, which is enough for a useful subset of commands.
    return {
      [ORIGIN_ENV_KEYS.pane_id]: process.env.HERDR_PANE_ID,
      [ORIGIN_ENV_KEYS.tab_id]: process.env.HERDR_TAB_ID,
      [ORIGIN_ENV_KEYS.workspace_id]: process.env.HERDR_WORKSPACE_ID,
    };
  }
}

// This action runs server-side with no TTY, so it cannot draw anything itself —
// its only job is to open the popup, which does have one.
function openPalette() {
  try {
    openPluginPane({
      pluginId: process.env.HERDR_PLUGIN_ID || DEFAULT_PLUGIN_ID,
      entrypoint: PALETTE_ENTRYPOINT,
      env: originEnvironment(),
    });
    return 0;
  } catch (error) {
    process.stderr.write(`command-palette: could not open the palette: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = openPalette();
}

module.exports = { originEnvironment, openPalette };
