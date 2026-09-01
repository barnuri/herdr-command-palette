'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CATALOG_FILENAME = 'commands.json';
const SUPPORTED_SCHEMA_VERSION = 1;
const NATIVE_SOURCE_LABEL = 'Herdr';
const ARGUMENT_SOURCES = new Set(['literal', 'context', 'input', 'select']);
const STATIC_CONTEXT_KEYS = new Set(['pane_id', 'tab_id', 'workspace_id', 'cwd']);
const COMPUTED_CONTEXT_KEYS = new Set([
  'next_workspace_id',
  'previous_workspace_id',
  'next_tab_id',
  'previous_tab_id',
]);
const SELECTOR_NAMES = new Set(['workspaces', 'tabs', 'agents']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isArgumentContextKey(key) {
  return STATIC_CONTEXT_KEYS.has(key) || COMPUTED_CONTEXT_KEYS.has(key);
}

function validateArgument(argument) {
  if (argument === null || typeof argument !== 'object' || !ARGUMENT_SOURCES.has(argument.source)) {
    return false;
  }

  switch (argument.source) {
    case 'literal':
      return isNonEmptyString(argument.value);
    case 'context':
      return isArgumentContextKey(argument.key);
    case 'input':
      return (
        isNonEmptyString(argument.prompt) &&
        (argument.default_context === undefined || STATIC_CONTEXT_KEYS.has(argument.default_context))
      );
    case 'select':
      return (
        SELECTOR_NAMES.has(argument.selector) &&
        isNonEmptyString(argument.prompt) &&
        (argument.exclude_context === undefined || STATIC_CONTEXT_KEYS.has(argument.exclude_context))
      );
    default:
      return false;
  }
}

function isValidCommand(command) {
  if (command === null || typeof command !== 'object') {
    return false;
  }
  if (!isNonEmptyString(command.id) || !isNonEmptyString(command.title)) {
    return false;
  }
  if (!Array.isArray(command.command) || command.command.length === 0) {
    return false;
  }
  if (!command.command.every(isNonEmptyString)) {
    return false;
  }
  if (!Array.isArray(command.arguments)) {
    return false;
  }
  return command.arguments.every(validateArgument);
}

function requiredContextKeys(command) {
  return command.arguments
    .filter((argument) => argument.source === 'context')
    .map((argument) => argument.key);
}

function toEntry(command) {
  return {
    kind: 'native',
    id: command.id,
    title: command.title,
    description: typeof command.description === 'string' ? command.description : '',
    sourceLabel: NATIVE_SOURCE_LABEL,
    command: command.command,
    arguments: command.arguments,
    requiredContextKeys: requiredContextKeys(command),
  };
}

// A malformed entry is dropped rather than thrown on: one bad line in the catalog
// must not take the whole palette down, and the user still gets every other command.
function parseCatalog(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error(`${CATALOG_FILENAME} is not valid JSON: ${error.message}`);
  }

  if (document === null || typeof document !== 'object') {
    throw new Error(`${CATALOG_FILENAME} must contain an object`);
  }
  if (document.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `${CATALOG_FILENAME} declares schema_version ${document.schema_version}, expected ${SUPPORTED_SCHEMA_VERSION}`
    );
  }
  if (!Array.isArray(document.commands)) {
    throw new Error(`${CATALOG_FILENAME} must contain a commands array`);
  }

  const seenIds = new Set();
  const entries = [];
  for (const command of document.commands) {
    if (!isValidCommand(command) || seenIds.has(command.id)) {
      continue;
    }
    seenIds.add(command.id);
    entries.push(toEntry(command));
  }

  return entries;
}

function catalogPath() {
  return path.join(__dirname, '..', CATALOG_FILENAME);
}

// A command is offered only when every id it needs is already in hand. Showing
// "Pane: Close current" with no pane to close would be a row that fails when picked.
function availableIn(entries, context) {
  return entries.filter((entry) =>
    entry.requiredContextKeys.every((key) => isNonEmptyString(context[key]))
  );
}

function loadCatalog(context = {}) {
  let text;
  try {
    text = fs.readFileSync(catalogPath(), 'utf8');
  } catch (error) {
    process.stderr.write(`command-palette: could not read ${CATALOG_FILENAME}: ${error.message}\n`);
    return [];
  }

  try {
    return availableIn(parseCatalog(text), context);
  } catch (error) {
    process.stderr.write(`command-palette: ${error.message}\n`);
    return [];
  }
}

module.exports = {
  CATALOG_FILENAME,
  NATIVE_SOURCE_LABEL,
  STATIC_CONTEXT_KEYS,
  COMPUTED_CONTEXT_KEYS,
  SELECTOR_NAMES,
  validateArgument,
  isValidCommand,
  parseCatalog,
  catalogPath,
  availableIn,
  loadCatalog,
};
