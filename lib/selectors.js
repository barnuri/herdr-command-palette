'use strict';

const { listWorkspaces, listTabs, listAgents } = require('./herdr');

const AGENT_STATUS_GLYPH = { working: '●', idle: '○', blocked: '!', done: '✓' };

function labelOrId(item, idKey) {
  return typeof item.label === 'string' && item.label.length > 0 ? item.label : item[idKey];
}

function agentLabel(agent) {
  const glyph = AGENT_STATUS_GLYPH[agent.agent_status] || '·';
  const title = agent.terminal_title_stripped || agent.pane_id;
  return `${glyph} ${agent.agent || 'agent'} — ${title}`;
}

const SELECTORS = {
  workspaces: {
    contextKey: 'workspace_id',
    list: (context, lists) => lists.workspaces(context),
    toChoice: (workspace) => ({
      value: workspace.workspace_id,
      label: labelOrId(workspace, 'workspace_id'),
    }),
  },
  tabs: {
    contextKey: 'tab_id',
    list: (context, lists) => lists.tabs(context),
    toChoice: (tab) => ({ value: tab.tab_id, label: labelOrId(tab, 'tab_id') }),
  },
  agents: {
    contextKey: 'pane_id',
    list: (context, lists) => lists.agents(context),
    toChoice: (agent) => ({ value: agent.pane_id, label: agentLabel(agent) }),
  },
};

// The palette runs inside a modal popup, so every list has to be fetched while it
// is open. Injecting the fetchers keeps that off the unit tests' path.
const LIVE_LISTS = {
  workspaces: () => listWorkspaces(),
  tabs: (context) => listTabs(context.workspace_id),
  agents: () => listAgents(),
};

function selectorChoices(name, { context = {}, excludeContextKey, lists = LIVE_LISTS } = {}) {
  const selector = SELECTORS[name];
  if (selector === undefined) {
    throw new Error(`unknown selector "${name}"`);
  }

  const excluded = excludeContextKey === undefined ? undefined : context[excludeContextKey];

  return selector
    .list(context, lists)
    .map(selector.toChoice)
    .filter((choice) => choice.value !== undefined && choice.value !== excluded);
}

module.exports = { SELECTORS, LIVE_LISTS, selectorChoices };
