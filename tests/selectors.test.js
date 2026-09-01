'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { selectorChoices } = require('../lib/selectors');

const LISTS = {
    workspaces: () => [
        { workspace_id: 'wA', label: '[1] first' },
        { workspace_id: 'wB', label: '' },
    ],
    tabs: (context) => [
        { tab_id: 't1', label: '[1] editor', workspace_id: context.workspace_id },
        { tab_id: 't2', label: '[2] logs', workspace_id: context.workspace_id },
    ],
    agents: () => [
        { pane_id: 'p1', agent: 'claude', agent_status: 'working', terminal_title_stripped: 'Claude Code' },
        { pane_id: 'p2', agent: 'codex', agent_status: 'idle', terminal_title_stripped: '' },
    ],
};

test('the workspaces selector falls back to the id when a label is blank', () => {
    const choices = selectorChoices('workspaces', { lists: LISTS });
    assert.deepEqual(choices, [
        { value: 'wA', label: '[1] first' },
        { value: 'wB', label: 'wB' },
    ]);
});

test('exclude_context removes the entry the user is already on', () => {
    const choices = selectorChoices('workspaces', {
        context: { workspace_id: 'wA' },
        excludeContextKey: 'workspace_id',
        lists: LISTS,
    });
    assert.deepEqual(choices.map((choice) => choice.value), ['wB']);
});

test('the tabs selector is scoped by the context it is given', () => {
    let seen;
    const choices = selectorChoices('tabs', {
        context: { workspace_id: 'wB' },
        lists: { ...LISTS, tabs: (context) => { seen = context.workspace_id; return LISTS.tabs(context); } },
    });
    assert.equal(seen, 'wB');
    assert.deepEqual(choices.map((choice) => choice.value), ['t1', 't2']);
});

test('the agents selector shows a status glyph, the agent name and its terminal title', () => {
    const [working, idle] = selectorChoices('agents', { lists: LISTS });
    assert.equal(working.label, '● claude — Claude Code');
    assert.equal(working.value, 'p1');
    assert.equal(idle.label, '○ codex — p2');
});

test('an unknown selector is reported rather than returning an empty list', () => {
    assert.throws(() => selectorChoices('nope', { lists: LISTS }), /unknown selector "nope"/);
});
