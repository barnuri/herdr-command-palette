'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { searchText, mergeEntries } = require('../lib/entries');

function pluginEntry(id, title) {
    return { kind: 'plugin', id, title, description: '', sourceLabel: 'Acme Tools' };
}

function nativeEntry(id, title) {
    return { kind: 'native', id, title, description: '', sourceLabel: 'Herdr' };
}

test('mergeEntries keeps entries from both sources in one list', () => {
    const merged = mergeEntries([[pluginEntry('a.b.c', 'Do C')], [nativeEntry('tab.close', 'Tab: Close current')]]);
    assert.deepEqual(merged.map((entry) => entry.kind).sort(), ['native', 'plugin']);
});

test('mergeEntries sorts by source then title when nothing is recent', () => {
    const merged = mergeEntries([
        [pluginEntry('a.b.z', 'Z action'), pluginEntry('a.b.a', 'A action')],
        [nativeEntry('tab.close', 'Tab: Close current')],
    ]);
    assert.deepEqual(merged.map((entry) => entry.title), ['A action', 'Z action', 'Tab: Close current']);
});

test('mergeEntries floats recently used entries above everything else', () => {
    const merged = mergeEntries(
        [[pluginEntry('a.b.a', 'A action')], [nativeEntry('tab.close', 'Tab: Close current')]],
        { rankOf: (id) => (id === 'tab.close' ? 0 : 99) }
    );
    assert.deepEqual(merged.map((entry) => entry.id), ['tab.close', 'a.b.a']);
});

test('mergeEntries attaches the bound chord by entry id and blanks the rest', () => {
    const merged = mergeEntries([[pluginEntry('a.b.c', 'Do C')], [nativeEntry('tab.close', 'Close')]], {
        chords: new Map([['a.b.c', 'prefix+d']]),
    });
    assert.equal(merged.find((entry) => entry.id === 'a.b.c').chord, 'prefix+d');
    assert.equal(merged.find((entry) => entry.id === 'tab.close').chord, '');
});

test('mergeEntries skips a source that is not an array', () => {
    assert.equal(mergeEntries([null, [nativeEntry('tab.close', 'Close')]]).length, 1);
});

test('searchText spans source label, title, description and id', () => {
    const haystack = searchText({
        sourceLabel: 'Herdr',
        title: 'Tab: Close current',
        description: 'Close the current tab.',
        id: 'tab.close',
    });
    assert.ok(haystack.includes('Herdr'));
    assert.ok(haystack.includes('Tab: Close current'));
    assert.ok(haystack.includes('Close the current tab.'));
    assert.ok(haystack.includes('tab.close'));
});
