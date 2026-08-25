'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MAX_RECENTS, recentsPath, loadRecents, recordUse, rankLookup } = require('../lib/recents');

function withStateDirectory(run) {
    const previous = process.env.HERDR_PLUGIN_STATE_DIR;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'palette-recents-'));
    process.env.HERDR_PLUGIN_STATE_DIR = directory;
    try {
        run(directory);
    } finally {
        if (previous === undefined) {
            delete process.env.HERDR_PLUGIN_STATE_DIR;
        } else {
            process.env.HERDR_PLUGIN_STATE_DIR = previous;
        }
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('loadRecents returns an empty list when nothing has been stored', () => {
    withStateDirectory(() => {
        assert.deepEqual(loadRecents(), []);
    });
});

test('loadRecents degrades to an empty list on corrupt json', () => {
    withStateDirectory(() => {
        fs.writeFileSync(recentsPath(), '{not json', 'utf8');
        assert.deepEqual(loadRecents(), []);
    });
});

test('loadRecents drops non-string entries', () => {
    withStateDirectory(() => {
        fs.writeFileSync(recentsPath(), JSON.stringify(['a.b', 42, '', null]), 'utf8');
        assert.deepEqual(loadRecents(), ['a.b']);
    });
});

test('recordUse puts the newest action first and creates the state directory', () => {
    withStateDirectory((directory) => {
        fs.rmSync(directory, { recursive: true, force: true });
        recordUse('acme.tools.one');
        recordUse('acme.tools.two');
        assert.deepEqual(loadRecents(), ['acme.tools.two', 'acme.tools.one']);
    });
});

test('recordUse moves a repeated action back to the front without duplicating it', () => {
    withStateDirectory(() => {
        recordUse('a.one');
        recordUse('a.two');
        recordUse('a.one');
        assert.deepEqual(loadRecents(), ['a.one', 'a.two']);
    });
});

test('recordUse caps the stored history', () => {
    withStateDirectory(() => {
        for (let index = 0; index <= MAX_RECENTS; index += 1) {
            recordUse(`a.action-${index}`);
        }
        assert.equal(loadRecents().length, MAX_RECENTS);
    });
});

test('recordUse ignores an empty id', () => {
    withStateDirectory(() => {
        recordUse('a.one');
        assert.deepEqual(recordUse(''), ['a.one']);
    });
});

test('rankLookup orders known ids by position and sinks unknown ones', () => {
    const rankOf = rankLookup(['a.one', 'a.two']);
    assert.equal(rankOf('a.one'), 0);
    assert.equal(rankOf('a.two'), 1);
    assert.ok(rankOf('a.three') > 1);
});
