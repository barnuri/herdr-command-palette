#!/usr/bin/env node
'use strict';

const { invokeAction, runCommand, notify } = require('../lib/herdr');

// The palette popup is session-modal: while it is up, any command that opens a
// pane or popup of its own is refused with `ui_busy`. So the palette spawns this
// script detached and exits; by the time the delay elapses the popup has torn
// down and focus is back on the pane the palette was opened from.
const POPUP_TEARDOWN_DELAY_MS = 150;

const ACTION_FLAG = '--action';
const COMMAND_FLAG = '--command';

function parseArguments(argv) {
  const [flag, ...rest] = argv;

  if (flag === ACTION_FLAG && rest.length === 2) {
    const [pluginId, actionId] = rest;
    return { label: `${pluginId}.${actionId}`, run: () => invokeAction(pluginId, actionId) };
  }
  if (flag === COMMAND_FLAG && rest.length > 0) {
    return { label: `herdr ${rest.join(' ')}`, run: () => runCommand(rest) };
  }

  return null;
}

function runAfterPopupCloses(request) {
  setTimeout(() => {
    try {
      request.run();
    } catch (error) {
      notify('Command palette', `${request.label} failed: ${error.message}`);
      process.exitCode = 1;
    }
  }, POPUP_TEARDOWN_DELAY_MS);
}

if (require.main === module) {
  const request = parseArguments(process.argv.slice(2));
  if (request === null) {
    process.stderr.write(
      `usage: invoke.js ${ACTION_FLAG} <plugin-id> <action-id> | ${COMMAND_FLAG} <herdr argv…>\n`
    );
    process.exitCode = 1;
  } else {
    runAfterPopupCloses(request);
  }
}

module.exports = { POPUP_TEARDOWN_DELAY_MS, parseArguments, runAfterPopupCloses };
