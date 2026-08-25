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
    pluginId,
    actionId,
    qualifiedId: `${pluginId}.${actionId}`,
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

function searchText(action) {
  return `${action.pluginLabel} ${action.title} ${action.description} ${action.qualifiedId}`;
}

function compareForDisplay(rankOf) {
  return (left, right) => {
    const rankDifference = rankOf(left.qualifiedId) - rankOf(right.qualifiedId);
    if (rankDifference !== 0) {
      return rankDifference;
    }
    return (
      left.pluginLabel.localeCompare(right.pluginLabel) || left.title.localeCompare(right.title)
    );
  };
}

function buildActionList(
  rawActions,
  { platform = currentPlatform(), excludePluginId = null, pluginNames = new Map(), chords = new Map(), rankOf = () => 0 } = {}
) {
  if (!Array.isArray(rawActions)) {
    return [];
  }

  const actions = [];
  for (const raw of rawActions) {
    const action = normalizeAction(raw);
    if (action === null) {
      continue;
    }
    if (action.pluginId === excludePluginId) {
      continue;
    }
    if (!runsOnPlatform(action, platform)) {
      continue;
    }

    action.pluginLabel = pluginNames.get(action.pluginId) || action.pluginId;
    action.chord = chords.get(action.qualifiedId) || '';
    actions.push(action);
  }

  return actions.sort(compareForDisplay(rankOf));
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

module.exports = {
  currentPlatform,
  normalizeAction,
  runsOnPlatform,
  searchText,
  buildActionList,
  pluginNameLookup,
};
