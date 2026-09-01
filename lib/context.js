'use strict';

const ORIGIN_ENV_KEYS = {
  pane_id: 'PALETTE_ORIGIN_PANE_ID',
  tab_id: 'PALETTE_ORIGIN_TAB_ID',
  workspace_id: 'PALETTE_ORIGIN_WORKSPACE_ID',
  cwd: 'PALETTE_ORIGIN_CWD',
};

// A popup is not a Herdr pane — its process never receives HERDR_PANE_ID — so the
// action that opened it captures the origin ids and forwards them through here.
function originContext(env = process.env) {
  const context = {};
  for (const [key, variable] of Object.entries(ORIGIN_ENV_KEYS)) {
    const value = env[variable];
    if (typeof value === 'string' && value.length > 0) {
      context[key] = value;
    }
  }
  return context;
}

function byDisplayOrder(items) {
  return [...items].sort((left, right) => {
    const leftNumber = typeof left.number === 'number' ? left.number : 0;
    const rightNumber = typeof right.number === 'number' ? right.number : 0;
    return leftNumber - rightNumber;
  });
}

// Wraps at both ends, matching herdr's own next/previous keybindings. A single
// item is its own neighbour, which makes the command a harmless no-op instead of
// an entry that disappears whenever only one tab is open.
function neighbourId(items, currentId, idKey, offset) {
  if (!Array.isArray(items) || items.length === 0) {
    return undefined;
  }

  const ordered = byDisplayOrder(items);
  const currentIndex = ordered.findIndex((item) => item[idKey] === currentId);
  if (currentIndex === -1) {
    return undefined;
  }

  const neighbourIndex = (currentIndex + offset + ordered.length) % ordered.length;
  return ordered[neighbourIndex][idKey];
}

function neighbourIds({ workspaces = [], tabs = [], workspaceId, tabId } = {}) {
  const tabsInWorkspace = tabs.filter(
    (tab) => workspaceId === undefined || tab.workspace_id === workspaceId
  );

  return {
    next_workspace_id: neighbourId(workspaces, workspaceId, 'workspace_id', 1),
    previous_workspace_id: neighbourId(workspaces, workspaceId, 'workspace_id', -1),
    next_tab_id: neighbourId(tabsInWorkspace, tabId, 'tab_id', 1),
    previous_tab_id: neighbourId(tabsInWorkspace, tabId, 'tab_id', -1),
  };
}

function buildContext({ env = process.env, workspaces = [], tabs = [] } = {}) {
  const context = originContext(env);
  const neighbours = neighbourIds({
    workspaces,
    tabs,
    workspaceId: context.workspace_id,
    tabId: context.tab_id,
  });

  for (const [key, value] of Object.entries(neighbours)) {
    if (value !== undefined) {
      context[key] = value;
    }
  }

  return context;
}

module.exports = { ORIGIN_ENV_KEYS, originContext, neighbourId, neighbourIds, buildContext };
