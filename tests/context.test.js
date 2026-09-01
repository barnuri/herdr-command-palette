'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ORIGIN_ENV_KEYS, originContext, neighbourId, neighbourIds, buildContext } = require('../lib/context');

const WORKSPACES = [
    { workspace_id: 'wA', number: 1 },
    { workspace_id: 'wB', number: 2 },
    { workspace_id: 'wC', number: 3 },
];

const TABS = [
    { tab_id: 'b2', number: 2, workspace_id: 'wB' },
    { tab_id: 'b1', number: 1, workspace_id: 'wB' },
    { tab_id: 'a1', number: 1, workspace_id: 'wA' },
];

test('originContext reads the forwarded env and skips blanks', () => {
    const context = originContext({
        [ORIGIN_ENV_KEYS.pane_id]: 'wE:pR',
        [ORIGIN_ENV_KEYS.tab_id]: 'wE:t8',
        [ORIGIN_ENV_KEYS.workspace_id]: '',
    });
    assert.deepEqual(context, { pane_id: 'wE:pR', tab_id: 'wE:t8' });
});

test('neighbourId wraps at both ends', () => {
    assert.equal(neighbourId(WORKSPACES, 'wC', 'workspace_id', 1), 'wA');
    assert.equal(neighbourId(WORKSPACES, 'wA', 'workspace_id', -1), 'wC');
});

test('neighbourId orders by display number, not array order', () => {
    assert.equal(neighbourId(TABS.filter((tab) => tab.workspace_id === 'wB'), 'b1', 'tab_id', 1), 'b2');
});

test('neighbourId treats a lone item as its own neighbour', () => {
    assert.equal(neighbourId([{ tab_id: 'only', number: 1 }], 'only', 'tab_id', 1), 'only');
});

test('neighbourId returns undefined for an unknown or empty list', () => {
    assert.equal(neighbourId(WORKSPACES, 'missing', 'workspace_id', 1), undefined);
    assert.equal(neighbourId([], 'wA', 'workspace_id', 1), undefined);
});

test('neighbourIds scopes tab neighbours to the current workspace', () => {
    const ids = neighbourIds({ workspaces: WORKSPACES, tabs: TABS, workspaceId: 'wB', tabId: 'b2' });
    assert.equal(ids.next_tab_id, 'b1');
    assert.equal(ids.previous_tab_id, 'b1');
    assert.equal(ids.next_workspace_id, 'wC');
});

test('buildContext merges origin ids with computed neighbours', () => {
    const context = buildContext({
        env: {
            [ORIGIN_ENV_KEYS.workspace_id]: 'wB',
            [ORIGIN_ENV_KEYS.tab_id]: 'b1',
            [ORIGIN_ENV_KEYS.cwd]: '/tmp',
        },
        workspaces: WORKSPACES,
        tabs: TABS,
    });
    assert.equal(context.workspace_id, 'wB');
    assert.equal(context.cwd, '/tmp');
    assert.equal(context.next_workspace_id, 'wC');
    assert.equal(context.next_tab_id, 'b2');
});

test('buildContext omits neighbours it cannot compute rather than storing undefined', () => {
    const context = buildContext({ env: {}, workspaces: [], tabs: [] });
    assert.deepEqual(Object.keys(context), []);
});
