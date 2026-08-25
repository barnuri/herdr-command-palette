'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fuzzyScore, fuzzyFilter } = require('../lib/fuzzy');

test('fuzzyScore returns null when a query character is missing', () => {
    assert.equal(fuzzyScore('open project picker', 'zzz'), null);
});

test('fuzzyScore returns 0 for an empty query', () => {
    assert.equal(fuzzyScore('anything', ''), 0);
});

test('fuzzyScore rewards word starts over mid-word matches', () => {
    const wordStart = fuzzyScore('open picker', 'op');
    const midWord = fuzzyScore('stop picker', 'op');
    assert.ok(wordStart > midWord);
});

test('fuzzyScore rewards consecutive matches', () => {
    assert.ok(fuzzyScore('telegram', 'tele') > fuzzyScore('telegram', 'tlgm'));
});

test('fuzzyScore ignores spaces in the query so multi-word typing still matches', () => {
    assert.ok(fuzzyScore('send test telegram message', 'send tel') !== null);
});

test('fuzzyScore is case insensitive', () => {
    assert.equal(fuzzyScore('Open Picker', 'op'), fuzzyScore('open picker', 'OP'));
});

test('fuzzyFilter returns the original list for a blank query', () => {
    const items = ['b', 'a'];
    assert.deepEqual(fuzzyFilter(items, '   '), items);
});

test('fuzzyFilter drops non-matching items and ranks the best match first', () => {
    const items = ['edit config', 'open picker', 'open project'];
    assert.deepEqual(fuzzyFilter(items, 'open p'), ['open picker', 'open project']);
});

test('fuzzyFilter keeps the incoming order for equally scored items', () => {
    const items = ['open x', 'open x'];
    const keyed = items.map((title, index) => ({ title, index }));
    const filtered = fuzzyFilter(keyed, 'open', (item) => item.title);
    assert.deepEqual(
        filtered.map((item) => item.index),
        [0, 1]
    );
});

test('fuzzyFilter tolerates a non-array input', () => {
    assert.deepEqual(fuzzyFilter(null, 'x'), []);
});
