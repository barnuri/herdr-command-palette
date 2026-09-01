'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
    validateArgument,
    isValidCommand,
    parseCatalog,
    catalogPath,
    availableIn,
} = require('../lib/catalog');

function catalogText(commands) {
    return JSON.stringify({ schema_version: 1, commands });
}

function command(overrides = {}) {
    return {
        id: 'tab.close',
        title: 'Tab: Close current',
        description: 'Close the current tab.',
        command: ['tab', 'close'],
        arguments: [{ source: 'context', key: 'tab_id' }],
        ...overrides,
    };
}

test('validateArgument accepts each supported source', () => {
    assert.equal(validateArgument({ source: 'literal', value: '--cwd' }), true);
    assert.equal(validateArgument({ source: 'context', key: 'pane_id' }), true);
    assert.equal(validateArgument({ source: 'context', key: 'next_tab_id' }), true);
    assert.equal(validateArgument({ source: 'input', prompt: 'label' }), true);
    assert.equal(validateArgument({ source: 'select', selector: 'tabs', prompt: 'tab' }), true);
});

test('validateArgument rejects an unknown source, selector or context key', () => {
    assert.equal(validateArgument({ source: 'magic' }), false);
    assert.equal(validateArgument({ source: 'context', key: 'nope' }), false);
    assert.equal(validateArgument({ source: 'select', selector: 'nope', prompt: 'x' }), false);
    assert.equal(validateArgument(null), false);
});

test('validateArgument rejects a computed key used as an input default', () => {
    assert.equal(
        validateArgument({ source: 'input', prompt: 'x', default_context: 'next_tab_id' }),
        false
    );
    assert.equal(validateArgument({ source: 'input', prompt: 'x', default_context: 'cwd' }), true);
});

test('isValidCommand requires an id, title and a non-empty argv', () => {
    assert.equal(isValidCommand(command()), true);
    assert.equal(isValidCommand(command({ id: '' })), false);
    assert.equal(isValidCommand(command({ command: [] })), false);
    assert.equal(isValidCommand(command({ command: ['tab', 7] })), false);
    assert.equal(isValidCommand(command({ arguments: 'nope' })), false);
});

test('parseCatalog drops malformed commands instead of failing the whole file', () => {
    const entries = parseCatalog(catalogText([command(), command({ id: 'broken', command: [] })]));
    assert.deepEqual(entries.map((entry) => entry.id), ['tab.close']);
});

test('parseCatalog drops a duplicate id, keeping the first', () => {
    const entries = parseCatalog(
        catalogText([command({ title: 'First' }), command({ title: 'Second' })])
    );
    assert.deepEqual(entries.map((entry) => entry.title), ['First']);
});

test('parseCatalog rejects an unsupported schema version', () => {
    assert.throws(
        () => parseCatalog(JSON.stringify({ schema_version: 99, commands: [] })),
        /schema_version 99/
    );
});

test('parseCatalog rejects malformed json and a missing commands array', () => {
    assert.throws(() => parseCatalog('{nope'), /not valid JSON/);
    assert.throws(() => parseCatalog(JSON.stringify({ schema_version: 1 })), /commands array/);
});

test('parseCatalog produces native entries labelled Herdr with their required context keys', () => {
    const [entry] = parseCatalog(catalogText([command()]));
    assert.equal(entry.kind, 'native');
    assert.equal(entry.sourceLabel, 'Herdr');
    assert.deepEqual(entry.requiredContextKeys, ['tab_id']);
});

test('availableIn hides a command whose required context is missing', () => {
    const entries = parseCatalog(catalogText([command()]));
    assert.equal(availableIn(entries, {}).length, 0);
    assert.equal(availableIn(entries, { tab_id: '' }).length, 0);
    assert.equal(availableIn(entries, { tab_id: 'wE:t8' }).length, 1);
});

test('the shipped catalog parses completely — every command survives validation', () => {
    const document = JSON.parse(fs.readFileSync(catalogPath(), 'utf8'));
    const entries = parseCatalog(fs.readFileSync(catalogPath(), 'utf8'));
    assert.equal(entries.length, document.commands.length);
});

test('the shipped catalog only drives herdr subcommands that exist', () => {
    const entries = parseCatalog(fs.readFileSync(catalogPath(), 'utf8'));
    const nouns = new Set(['workspace', 'tab', 'pane', 'agent', 'server']);
    for (const entry of entries) {
        assert.ok(nouns.has(entry.command[0]), `unexpected noun in ${entry.id}: ${entry.command[0]}`);
    }
});
