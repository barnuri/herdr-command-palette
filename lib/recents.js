'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RECENTS_FILENAME = 'recents.json';
const MAX_RECENTS = 50;

function stateDirectory() {
  return process.env.HERDR_PLUGIN_STATE_DIR || path.join(os.tmpdir(), 'herdr-command-palette');
}

function recentsPath() {
  return path.join(stateDirectory(), RECENTS_FILENAME);
}

// A corrupt or unreadable store must never stop the palette from opening — it
// only costs the user their ordering, so every failure degrades to "no recents".
function loadRecents() {
  let raw;
  try {
    raw = fs.readFileSync(recentsPath(), 'utf8');
  } catch {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((entry) => typeof entry === 'string' && entry.length > 0);
}

function saveRecents(ids) {
  const directory = stateDirectory();
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(recentsPath(), `${JSON.stringify(ids, null, 2)}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(`command-palette: could not save recents: ${error.message}\n`);
  }
}

function recordUse(qualifiedId) {
  if (typeof qualifiedId !== 'string' || qualifiedId.length === 0) {
    return loadRecents();
  }

  const withoutDuplicate = loadRecents().filter((entry) => entry !== qualifiedId);
  const updated = [qualifiedId, ...withoutDuplicate].slice(0, MAX_RECENTS);
  saveRecents(updated);
  return updated;
}

// Lower rank sorts first; anything never used sorts after every recent entry.
function rankLookup(ids) {
  const ranks = new Map();
  ids.forEach((id, index) => {
    if (!ranks.has(id)) {
      ranks.set(id, index);
    }
  });
  return (qualifiedId) => (ranks.has(qualifiedId) ? ranks.get(qualifiedId) : Number.MAX_SAFE_INTEGER);
}

module.exports = { MAX_RECENTS, stateDirectory, recentsPath, loadRecents, recordUse, rankLookup };
