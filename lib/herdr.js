'use strict';

const { spawnSync } = require('node:child_process');

const DEFAULT_HERDR_BINARY = 'herdr';

function herdrBinary() {
  return process.env.HERDR_BIN_PATH || DEFAULT_HERDR_BINARY;
}

function spawnHerdr(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new TypeError('args must be a non-empty array of strings');
  }

  const binary = herdrBinary();
  const spawned = spawnSync(binary, args, { encoding: 'utf8' });

  if (spawned.error) {
    throw new Error(`failed to spawn ${binary}: ${spawned.error.message}`);
  }
  if (spawned.status !== 0) {
    const stderr = (spawned.stderr || '').trim();
    throw new Error(
      `herdr ${args.join(' ')} exited with code ${spawned.status}${stderr ? `: ${stderr}` : ''}`
    );
  }

  return spawned;
}

function runHerdr(args) {
  const { stdout } = spawnHerdr(args);

  try {
    return JSON.parse(stdout).result;
  } catch {
    throw new Error(
      `herdr ${args.join(' ')} did not print a JSON envelope (expected {"id", "result"}); got: ${stdout.trim()}`
    );
  }
}

function listPluginActions() {
  return runHerdr(['plugin', 'action', 'list']).actions || [];
}

function listPlugins() {
  return runHerdr(['plugin', 'list', '--json']).plugins || [];
}

function listWorkspaces() {
  return runHerdr(['workspace', 'list']).workspaces || [];
}

function listTabs(workspaceId) {
  const args = ['tab', 'list'];
  if (typeof workspaceId === 'string' && workspaceId.length > 0) {
    args.push('--workspace', workspaceId);
  }
  return runHerdr(args).tabs || [];
}

function listAgents() {
  return runHerdr(['agent', 'list']).agents || [];
}

// Native commands are argv lines rather than a single opaque action id, so they
// go straight through without the JSON-envelope expectation: several herdr
// subcommands print nothing at all on success.
function runCommand(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new TypeError('argv must be a non-empty array of strings');
  }
  spawnHerdr(argv);
}

function invokeAction(pluginId, actionId) {
  if (typeof pluginId !== 'string' || pluginId.length === 0) {
    throw new TypeError('pluginId must be a non-empty string');
  }
  if (typeof actionId !== 'string' || actionId.length === 0) {
    throw new TypeError('actionId must be a non-empty string');
  }
  spawnHerdr(['plugin', 'action', 'invoke', actionId, '--plugin', pluginId]);
}

function currentPane() {
  return runHerdr(['pane', 'current']).pane;
}

function openPluginPane({ pluginId, entrypoint, env = {} } = {}) {
  if (typeof pluginId !== 'string' || pluginId.length === 0) {
    throw new TypeError('pluginId must be a non-empty string');
  }
  if (typeof entrypoint !== 'string' || entrypoint.length === 0) {
    throw new TypeError('entrypoint must be a non-empty string');
  }

  const args = ['plugin', 'pane', 'open', '--plugin', pluginId, '--entrypoint', entrypoint, '--focus'];
  for (const [name, value] of Object.entries(env)) {
    if (value) {
      args.push('--env', `${name}=${value}`);
    }
  }

  return runHerdr(args);
}

// Notifications are best-effort: a failed toast must never break the caller.
function notify(title, body) {
  try {
    spawnHerdr(['notification', 'show', title, '--body', body]);
  } catch (error) {
    process.stderr.write(`herdr notification failed: ${error.message}\n`);
  }
}

module.exports = {
  herdrBinary,
  runHerdr,
  listPluginActions,
  listPlugins,
  listWorkspaces,
  listTabs,
  listAgents,
  runCommand,
  invokeAction,
  currentPane,
  openPluginPane,
  notify,
};
