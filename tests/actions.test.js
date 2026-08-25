'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeAction,
    runsOnPlatform,
    searchText,
    buildActionList,
    pluginNameLookup,
} = require('../lib/actions');

function rawAction(overrides = {}) {
    return {
        plugin_id: 'acme.tools',
        action_id: 'do-thing',
        title: 'Do the thing',
        platforms: ['linux', 'macos'],
        ...overrides,
    };
}

test('normalizeAction builds a qualified id from plugin and action ids', () => {
    assert.equal(normalizeAction(rawAction()).qualifiedId, 'acme.tools.do-thing');
});

test('normalizeAction falls back to the action id when the title is missing', () => {
    assert.equal(normalizeAction(rawAction({ title: '' })).title, 'do-thing');
});

test('normalizeAction rejects entries without string ids', () => {
    assert.equal(normalizeAction({ plugin_id: 'acme.tools' }), null);
    assert.equal(normalizeAction(null), null);
});

test('runsOnPlatform treats an empty platform list as "runs anywhere"', () => {
    assert.equal(runsOnPlatform(normalizeAction(rawAction({ platforms: [] })), 'macos'), true);
});

test('runsOnPlatform hides an action that names other platforms only', () => {
    assert.equal(runsOnPlatform(normalizeAction(rawAction({ platforms: ['windows'] })), 'macos'), false);
});

test('buildActionList drops actions for other platforms', () => {
    const built = buildActionList(
        [rawAction(), rawAction({ action_id: 'win-only', platforms: ['windows'] })],
        { platform: 'macos' }
    );
    assert.deepEqual(built.map((action) => action.actionId), ['do-thing']);
});

test('buildActionList excludes the palette own actions', () => {
    const built = buildActionList(
        [rawAction(), rawAction({ plugin_id: 'barnuri.command-palette', action_id: 'open' })],
        { platform: 'macos', excludePluginId: 'barnuri.command-palette' }
    );
    assert.deepEqual(built.map((action) => action.pluginId), ['acme.tools']);
});

test('buildActionList labels actions with the plugin display name when known', () => {
    const [action] = buildActionList([rawAction()], {
        platform: 'macos',
        pluginNames: new Map([['acme.tools', 'Acme Tools']]),
    });
    assert.equal(action.pluginLabel, 'Acme Tools');
});

test('buildActionList falls back to the plugin id when no display name is known', () => {
    const [action] = buildActionList([rawAction()], { platform: 'macos' });
    assert.equal(action.pluginLabel, 'acme.tools');
});

test('buildActionList attaches the bound chord for the qualified id', () => {
    const [action] = buildActionList([rawAction()], {
        platform: 'macos',
        chords: new Map([['acme.tools.do-thing', 'prefix+d']]),
    });
    assert.equal(action.chord, 'prefix+d');
});

test('buildActionList sorts recently used actions first', () => {
    const built = buildActionList(
        [
            rawAction({ action_id: 'alpha', title: 'Alpha' }),
            rawAction({ action_id: 'zulu', title: 'Zulu' }),
        ],
        { platform: 'macos', rankOf: (id) => (id === 'acme.tools.zulu' ? 0 : 99) }
    );
    assert.deepEqual(built.map((action) => action.actionId), ['zulu', 'alpha']);
});

test('buildActionList sorts alphabetically by plugin then title when nothing is recent', () => {
    const built = buildActionList(
        [
            rawAction({ plugin_id: 'zeta.plugin', action_id: 'a', title: 'A' }),
            rawAction({ action_id: 'b', title: 'B thing' }),
            rawAction({ action_id: 'a', title: 'A thing' }),
        ],
        { platform: 'macos' }
    );
    assert.deepEqual(built.map((action) => action.title), ['A thing', 'B thing', 'A']);
});

test('buildActionList tolerates a non-array input', () => {
    assert.deepEqual(buildActionList(undefined), []);
});

test('searchText covers plugin label, title, description and qualified id', () => {
    const [action] = buildActionList([rawAction({ description: 'does things' })], {
        platform: 'macos',
        pluginNames: new Map([['acme.tools', 'Acme Tools']]),
    });
    const haystack = searchText(action);
    assert.ok(haystack.includes('Acme Tools'));
    assert.ok(haystack.includes('Do the thing'));
    assert.ok(haystack.includes('does things'));
    assert.ok(haystack.includes('acme.tools.do-thing'));
});

test('pluginNameLookup maps plugin ids to display names and skips malformed rows', () => {
    const names = pluginNameLookup([
        { plugin_id: 'acme.tools', name: 'Acme Tools' },
        { plugin_id: 'broken' },
        null,
    ]);
    assert.equal(names.get('acme.tools'), 'Acme Tools');
    assert.equal(names.size, 1);
});
