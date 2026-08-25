'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const Palette = require('../bin/palette.js');

class FakeInput extends EventEmitter {
    constructor() {
        super();
        this.isTTY = false;
        this.paused = false;
    }

    setEncoding() {}

    resume() {
        this.paused = false;
    }

    pause() {
        this.paused = true;
    }
}

class FakeOutput extends EventEmitter {
    constructor({ rows = 12, columns = 80 } = {}) {
        super();
        this.rows = rows;
        this.columns = columns;
        this.frames = [];
    }

    write(text) {
        this.frames.push(text);
    }

    get lastFrame() {
        return this.frames[this.frames.length - 1] || '';
    }
}

function action(title, overrides = {}) {
    return {
        pluginId: 'acme.tools',
        actionId: title.toLowerCase().replace(/\s+/g, '-'),
        qualifiedId: `acme.tools.${title.toLowerCase().replace(/\s+/g, '-')}`,
        title,
        description: '',
        pluginLabel: 'Acme Tools',
        chord: '',
        ...overrides,
    };
}

function startPalette(actions, options = {}) {
    const input = new FakeInput();
    const output = new FakeOutput(options);
    const palette = new Palette({ actions, input, output });
    const finished = palette.run();
    return { palette, input, output, finished };
}

test('truncate pads a short value to the column width', () => {
    assert.equal(Palette.truncate('ab', 5), 'ab   ');
});

test('truncate marks a clipped value with an ellipsis and keeps the width', () => {
    assert.equal(Palette.truncate('abcdef', 4), 'abc…');
});

test('truncate returns nothing for a zero-width column', () => {
    assert.equal(Palette.truncate('abc', 0), '');
});

test('deleteLastWord removes the trailing word and its spacing', () => {
    assert.equal(Palette.deleteLastWord('open project '), 'open');
    assert.equal(Palette.deleteLastWord('open'), '');
});

test('printableFrom keeps typed text', () => {
    assert.equal(Palette.printableFrom('hi there'), 'hi there');
});

test('printableFrom drops whole escape sequences instead of leaking their letters', () => {
    assert.equal(Palette.printableFrom('\x1b[A'), '');
    assert.equal(Palette.printableFrom('\x1b[5~'), '');
    assert.equal(Palette.printableFrom('\x1bOP'), '');
    assert.equal(Palette.printableFrom('a\x1b[Ab'), 'ab');
});

test('typing filters the visible list', () => {
    const { palette, input } = startPalette([action('Open picker'), action('Send message')]);
    input.emit('data', 'send');
    assert.deepEqual(palette.visible.map((entry) => entry.title), ['Send message']);
});

test('backspace restores the previously filtered entries', () => {
    const { palette, input } = startPalette([action('Open picker'), action('Send message')]);
    input.emit('data', 'send');
    input.emit('data', Palette.KEY.backspace);
    assert.equal(palette.query, 'sen');
    input.emit('data', Palette.KEY.ctrlU);
    assert.equal(palette.visible.length, 2);
});

test('ctrl+w deletes a whole word from the query', () => {
    const { palette, input } = startPalette([action('Open picker')]);
    input.emit('data', 'open pick');
    input.emit('data', Palette.KEY.ctrlW);
    assert.equal(palette.query, 'open');
});

test('arrow keys move the selection and stop at both ends', () => {
    const { palette, input } = startPalette([action('One'), action('Two')]);
    input.emit('data', Palette.KEY.up);
    assert.equal(palette.selectedIndex, 0);
    input.emit('data', Palette.KEY.down);
    input.emit('data', Palette.KEY.down);
    assert.equal(palette.selectedIndex, 1);
});

test('the selection scrolls once it passes the bottom of the window', () => {
    const actions = Array.from({ length: 20 }, (_, index) => action(`Action ${index}`));
    const { palette, input } = startPalette(actions, { rows: 8 });
    for (let index = 0; index < 10; index += 1) {
        input.emit('data', Palette.KEY.down);
    }
    assert.equal(palette.selectedIndex, 10);
    assert.ok(palette.scrollOffset > 0);
    assert.ok(palette.selectedIndex < palette.scrollOffset + palette.pageSize);
});

test('filtering resets the selection back to the top', () => {
    const { palette, input } = startPalette([action('One'), action('Two')]);
    input.emit('data', Palette.KEY.down);
    input.emit('data', 'o');
    assert.equal(palette.selectedIndex, 0);
});

test('enter resolves with the highlighted action and releases the terminal', async () => {
    const { input, finished } = startPalette([action('One'), action('Two')]);
    input.emit('data', Palette.KEY.down);
    input.emit('data', Palette.KEY.enter);
    const chosen = await finished;
    assert.equal(chosen.title, 'Two');
    assert.equal(input.paused, true);
});

test('escape resolves with nothing', async () => {
    const { input, finished } = startPalette([action('One')]);
    input.emit('data', Palette.KEY.escape);
    assert.equal(await finished, null);
});

test('ctrl+c resolves with nothing', async () => {
    const { input, finished } = startPalette([action('One')]);
    input.emit('data', Palette.KEY.ctrlC);
    assert.equal(await finished, null);
});

test('enter on an empty result set resolves with nothing rather than throwing', async () => {
    const { input, finished } = startPalette([action('One')]);
    input.emit('data', 'zzzz');
    input.emit('data', Palette.KEY.enter);
    assert.equal(await finished, null);
});

test('the frame shows the chord and the match counter', () => {
    const { output, input } = startPalette([
        action('Open picker', { chord: 'prefix+shift+p' }),
        action('Send message'),
    ]);
    assert.match(output.lastFrame, /prefix\+shift\+p/);
    assert.match(output.lastFrame, /2\/2/);
    input.emit('data', 'send');
    assert.match(output.lastFrame, /1\/2/);
});

test('an unmatched query renders an empty state naming the query', () => {
    const { output, input } = startPalette([action('One')]);
    input.emit('data', 'zzzz');
    assert.match(output.lastFrame, /No action matches "zzzz"/);
});

test('no installed actions renders a distinct empty state', () => {
    const { output } = startPalette([]);
    assert.match(output.lastFrame, /No plugin actions are installed/);
});
