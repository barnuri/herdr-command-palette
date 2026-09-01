'use strict';

const PLATFORM_BY_NODE_NAME = { darwin: 'macos', linux: 'linux', win32: 'windows' };

function currentPlatform() {
  return PLATFORM_BY_NODE_NAME[process.platform] || process.platform;
}

function normalizeAction(raw) {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }

  const pluginId = raw.plugin_id;
  const actionId = raw.action_id;
  if (typeof pluginId !== 'string' || typeof actionId !== 'string') {
    return null;
  }

  return {
    kind: 'plugin',
    id: `${pluginId}.${actionId}`,
    pluginId,
    actionId,
    title: typeof raw.title === 'string' && raw.title.length > 0 ? raw.title : actionId,
    description: typeof raw.description === 'string' ? raw.description : '',
    platforms: Array.isArray(raw.platforms) ? raw.platforms : [],
  };
}

// An empty platform list means the action declared none, which Herdr treats as
// "runs anywhere" — only an explicit list that omits us is a reason to hide it.
function runsOnPlatform(action, platform) {
  if (action.platforms.length === 0) {
    return true;
  }
  return action.platforms.includes(platform);
}

function pluginNameLookup(plugins) {
  const names = new Map();
  if (!Array.isArray(plugins)) {
    return names;
  }
  for (const plugin of plugins) {
    if (plugin && typeof plugin.plugin_id === 'string' && typeof plugin.name === 'string') {
      names.set(plugin.plugin_id, plugin.name);
    }
  }
  return names;
}

function buildPluginEntries(
  rawActions,
  { platform = currentPlatform(), excludePluginId = null, pluginNames = new Map() } = {}
) {
  if (!Array.isArray(rawActions)) {
    return [];
  }

  const entries = [];
  for (const raw of rawActions) {
    const action = normalizeAction(raw);
    if (action === null || action.pluginId === excludePluginId) {
      continue;
    }
    if (!runsOnPlatform(action, platform)) {
      continue;
    }

    action.sourceLabel = pluginNames.get(action.pluginId) || action.pluginId;
    entries.push(action);
  }

  return entries;
}

module.exports = {
  currentPlatform,
  normalizeAction,
  runsOnPlatform,
  pluginNameLookup,
  buildPluginEntries,
};
