'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const COMMAND_TABLE_HEADER = '[[keys.command]]';
const PLUGIN_ACTION_TYPE = 'plugin_action';

function configPath() {
  if (process.env.HERDR_CONFIG_PATH) {
    return process.env.HERDR_CONFIG_PATH;
  }
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'herdr', 'config.toml');
}

function stripComment(line) {
  let insideString = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      insideString = !insideString;
      continue;
    }
    if (character === '#' && !insideString) {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseAssignment(line) {
  const separator = line.indexOf('=');
  if (separator === -1) {
    return null;
  }
  const name = line.slice(0, separator).trim();
  const rawValue = line.slice(separator + 1).trim();
  if (name.length === 0 || !rawValue.startsWith('"') || !rawValue.endsWith('"') || rawValue.length < 2) {
    return null;
  }
  return { name, value: rawValue.slice(1, -1) };
}

// A deliberately narrow TOML reader: it only understands the `[[keys.command]]`
// array-of-tables and the single-line quoted strings inside it. Node ships no
// TOML parser and this plugin has no dependencies, so anything wider would be
// code we do not need. Unknown syntax is skipped, never guessed at.
function parseCommandBindings(tomlText) {
  if (typeof tomlText !== 'string') {
    return [];
  }

  const bindings = [];
  let current = null;

  for (const rawLine of tomlText.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line.length === 0) {
      continue;
    }

    if (line === COMMAND_TABLE_HEADER) {
      current = {};
      bindings.push(current);
      continue;
    }

    if (line.startsWith('[')) {
      current = null;
      continue;
    }

    if (current === null) {
      continue;
    }

    const assignment = parseAssignment(line);
    if (assignment !== null) {
      current[assignment.name] = assignment.value;
    }
  }

  return bindings;
}

function chordsByActionId(tomlText) {
  const chords = new Map();
  for (const binding of parseCommandBindings(tomlText)) {
    if (binding.type !== PLUGIN_ACTION_TYPE || !binding.command || !binding.key) {
      continue;
    }
    if (!chords.has(binding.command)) {
      chords.set(binding.command, binding.key);
    }
  }
  return chords;
}

// Missing or unreadable config simply means "no chords to show".
function loadChords() {
  try {
    return chordsByActionId(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return new Map();
  }
}

module.exports = { configPath, parseCommandBindings, chordsByActionId, loadChords };
