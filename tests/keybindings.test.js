'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { configPath, parseCommandBindings, chordsByActionId, loadChords } = require('../lib/keybindings');

const CONFIG = `
onboarding = false

[keys]
prefix = "ctrl+a"

[[keys.command]]
key = "prefix+shift+p"
type = "plugin_action"
command = "barnuri.project-manager.open-picker"
description = "open project picker"

# a commented-out binding must not register
# [[keys.command]]
# key = "prefix+x"

[[keys.command]]
key = "f1"
type = "plugin_action"
command = "barnuri.command-palette.open"

[[keys.command]]
key = "prefix+t"
type = "shell"
command = "herdr tab create"

[ui.toast]
delivery = "off"
`;

test('parseCommandBindings reads every [[keys.command]] table', () => {
    assert.equal(parseCommandBindings(CONFIG).length, 3);
});

test('parseCommandBindings stops collecting when another table starts', () => {
    const [, , last] = parseCommandBindings(CONFIG);
    assert.equal(last.command, 'herdr tab create');
    assert.equal(last.delivery, undefined);
});

test('parseCommandBindings ignores commented-out tables and trailing comments', () => {
    const bindings = parseCommandBindings('[[keys.command]]\nkey = "f2" # the key\n');
    assert.deepEqual(bindings, [{ key: 'f2' }]);
});

test('parseCommandBindings keeps a hash inside a quoted value', () => {
    const [binding] = parseCommandBindings('[[keys.command]]\ncommand = "echo #1"\n');
    assert.equal(binding.command, 'echo #1');
});

test('parseCommandBindings tolerates a non-string input', () => {
    assert.deepEqual(parseCommandBindings(null), []);
});

test('chordsByActionId maps only plugin_action bindings', () => {
    const chords = chordsByActionId(CONFIG);
    assert.equal(chords.get('barnuri.project-manager.open-picker'), 'prefix+shift+p');
    assert.equal(chords.get('barnuri.command-palette.open'), 'f1');
    assert.equal(chords.has('herdr tab create'), false);
});

test('chordsByActionId keeps the first binding when an action is bound twice', () => {
    const chords = chordsByActionId(
        '[[keys.command]]\nkey = "f1"\ntype = "plugin_action"\ncommand = "a.b"\n' +
            '[[keys.command]]\nkey = "f2"\ntype = "plugin_action"\ncommand = "a.b"\n'
    );
    assert.equal(chords.get('a.b'), 'f1');
});

test('loadChords returns an empty map when the config file is missing', () => {
    const previous = process.env.HERDR_CONFIG_PATH;
    process.env.HERDR_CONFIG_PATH = '/nonexistent/herdr/config.toml';
    try {
        assert.equal(loadChords().size, 0);
    } finally {
        if (previous === undefined) {
            delete process.env.HERDR_CONFIG_PATH;
        } else {
            process.env.HERDR_CONFIG_PATH = previous;
        }
    }
});

test('configPath honours HERDR_CONFIG_PATH', () => {
    const previous = process.env.HERDR_CONFIG_PATH;
    process.env.HERDR_CONFIG_PATH = '/tmp/custom.toml';
    try {
        assert.equal(configPath(), '/tmp/custom.toml');
    } finally {
        if (previous === undefined) {
            delete process.env.HERDR_CONFIG_PATH;
        } else {
            process.env.HERDR_CONFIG_PATH = previous;
        }
    }
});
