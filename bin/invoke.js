#!/usr/bin/env node
'use strict';

const { invokeAction, notify } = require('../lib/herdr');

// The palette popup is session-modal: while it is up, any action that opens a
// pane or popup of its own is refused with `ui_busy`. So the palette spawns this
// script detached and exits; by the time the delay elapses the popup has torn
// down and focus is back on the pane the palette was opened from.
const POPUP_TEARDOWN_DELAY_MS = 150;

function runAfterPopupCloses(pluginId, actionId) {
  setTimeout(() => {
    try {
      invokeAction(pluginId, actionId);
    } catch (error) {
      notify('Command palette', `${pluginId}.${actionId} failed: ${error.message}`);
      process.exitCode = 1;
    }
  }, POPUP_TEARDOWN_DELAY_MS);
}

if (require.main === module) {
  const [pluginId, actionId] = process.argv.slice(2);
  if (!pluginId || !actionId) {
    process.stderr.write('usage: invoke.js <plugin-id> <action-id>\n');
    process.exitCode = 1;
  } else {
    runAfterPopupCloses(pluginId, actionId);
  }
}

module.exports = { POPUP_TEARDOWN_DELAY_MS, runAfterPopupCloses };
