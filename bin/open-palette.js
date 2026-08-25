#!/usr/bin/env node
'use strict';

const { openPluginPane } = require('../lib/herdr');

const DEFAULT_PLUGIN_ID = 'barnuri.command-palette';
const PALETTE_ENTRYPOINT = 'palette';

// This action runs server-side with no TTY, so it cannot draw anything itself —
// its only job is to open the popup, which does have one.
function openPalette() {
  try {
    openPluginPane({
      pluginId: process.env.HERDR_PLUGIN_ID || DEFAULT_PLUGIN_ID,
      entrypoint: PALETTE_ENTRYPOINT,
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

module.exports = { openPalette };
