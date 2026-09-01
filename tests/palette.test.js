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

function entry(title, overrides = {}) {
    const id = `acme.tools.${title.toLowerCase().replace(/\s+/g, '-')}`;
    return {
        kind: 'plugin',
        id,
        pluginId: 'acme.tools',
        actionId: id.split('.').pop(),
        title,
        description: '',
        sourceLabel: 'Acme Tools',
        chord: '',
        ...overrides,
    };
}

function startList(items, options = {}) {
    const input = new FakeInput();
    const output = new FakeOutput(options);
    const palette = new Palette({ input, output });
    const finished = palette.chooseFromList({ items, ...(options.prompt ? { prompt: options.prompt } : {}) });
    return { palette, input, output, finished };
}

function startInput(specification = {}) {
    const input = new FakeInput();
    const output = new FakeOutput();
    const palette = new Palette({ input, output });
    const finished = palette.promptForInput(specification);
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
    const { palette, input } = startList([entry('Open picker'), entry('Send message')]);
    input.emit('data', 'send');
    assert.deepEqual(palette.visible.map((item) => item.title), ['Send message']);
});

test('backspace and ctrl+u restore the filtered entries', () => {
    const { palette, input } = startList([entry('Open picker'), entry('Send message')]);
    input.emit('data', 'send');
    input.emit('data', Palette.KEY.backspace);
    assert.equal(palette.query, 'sen');
    input.emit('data', Palette.KEY.ctrlU);
    assert.equal(palette.visible.length, 2);
});

test('ctrl+w deletes a whole word from the query', () => {
    const { palette, input } = startList([entry('Open picker')]);
    input.emit('data', 'open pick');
    input.emit('data', Palette.KEY.ctrlW);
    assert.equal(palette.query, 'open');
});

test('arrow keys move the selection and stop at both ends', () => {
    const { palette, input } = startList([entry('One'), entry('Two')]);
    input.emit('data', Palette.KEY.up);
    assert.equal(palette.selectedIndex, 0);
    input.emit('data', Palette.KEY.down);
    input.emit('data', Palette.KEY.down);
    assert.equal(palette.selectedIndex, 1);
});

test('application-cursor arrows move the selection like the normal ones', () => {
    const { palette, input } = startList([entry('One'), entry('Two')]);
    input.emit('data', '\x1bOB');
    assert.equal(palette.selectedIndex, 1);
    input.emit('data', '\x1bOA');
    assert.equal(palette.selectedIndex, 0);
});

test('a chunk carrying several keys applies every one of them', () => {
    const { palette, input } = startList([entry('One'), entry('Two'), entry('Three')]);
    input.emit('data', `${Palette.KEY.down}${Palette.KEY.down}`);
    assert.equal(palette.selectedIndex, 2);
});

test('an arrow arriving with typed text filters and then moves', () => {
    const { palette, input } = startList([entry('One'), entry('Only')]);
    input.emit('data', `o${Palette.KEY.down}`);
    assert.equal(palette.query, 'o');
    assert.equal(palette.selectedIndex, 1);
});

test('splitKeys separates sequences, control characters and text', () => {
    assert.deepEqual(Palette.splitKeys('ab\x1b[Bc\x7f'), ['ab', '\x1b[B', 'c', '\x7f']);
    assert.deepEqual(Palette.splitKeys('\x1b'), [Palette.KEY.escape]);
    assert.deepEqual(Palette.splitKeys('\x1b[5~'), [Palette.KEY.pageUp]);
    assert.deepEqual(Palette.splitKeys('\x1bOH'), [Palette.KEY.home]);
});

test('the selection scrolls once it passes the bottom of the window', () => {
    const items = Array.from({ length: 20 }, (_, index) => entry(`Action ${index}`));
    const { palette, input } = startList(items, { rows: 8 });
    for (let index = 0; index < 10; index += 1) {
        input.emit('data', Palette.KEY.down);
    }
    assert.equal(palette.selectedIndex, 10);
    assert.ok(palette.scrollOffset > 0);
    assert.ok(palette.selectedIndex < palette.scrollOffset + palette.pageSize);
});

test('enter resolves with the highlighted entry', async () => {
    const { input, finished } = startList([entry('One'), entry('Two')]);
    input.emit('data', Palette.KEY.down);
    input.emit('data', Palette.KEY.enter);
    assert.equal((await finished).title, 'Two');
});

test('escape and ctrl+c resolve with nothing', async () => {
    const escaped = startList([entry('One')]);
    escaped.input.emit('data', Palette.KEY.escape);
    assert.equal(await escaped.finished, Palette.CANCELLED);

    const interrupted = startList([entry('One')]);
    interrupted.input.emit('data', Palette.KEY.ctrlC);
    assert.equal(await interrupted.finished, Palette.CANCELLED);
});

test('enter on an empty result set resolves with nothing rather than throwing', async () => {
    const { input, finished } = startList([entry('One')]);
    input.emit('data', 'zzzz');
    input.emit('data', Palette.KEY.enter);
    assert.equal(await finished, Palette.CANCELLED);
});

test('the frame shows the chord and the match counter', () => {
    const { output, input } = startList([
        entry('Open picker', { chord: 'prefix+shift+p' }),
        entry('Send message'),
    ]);
    assert.match(output.lastFrame, /prefix\+shift\+p/);
    assert.match(output.lastFrame, /2\/2/);
    input.emit('data', 'send');
    assert.match(output.lastFrame, /1\/2/);
});

test('an unmatched query renders an empty state naming the query', () => {
    const { output, input } = startList([entry('One')]);
    input.emit('data', 'zzzz');
    assert.match(output.lastFrame, /No entry matches "zzzz"/);
});

test('an empty source list renders a distinct empty state', () => {
    const { output } = startList([]);
    assert.match(output.lastFrame, /Nothing to choose here/);
});

test('close releases raw mode and pauses the terminal', () => {
    const { palette, input } = startList([entry('One')]);
    palette.close();
    assert.equal(input.paused, true);
});

test('a sub-picker shows its prompt label and picks by value', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const palette = new Palette({ input, output });
    const finished = palette.chooseFromList({
        prompt: 'workspace',
        items: [
            { value: 'wA', label: 'first' },
            { value: 'wB', label: 'second' },
        ],
        columnsOf: Palette.choiceColumns,
        searchOf: (choice) => choice.label,
    });

    assert.match(output.lastFrame, /workspace ❯/);
    input.emit('data', 'seco');
    input.emit('data', Palette.KEY.enter);
    assert.equal((await finished).value, 'wB');
});

test('the input prompt starts from its initial value and returns what was typed', async () => {
    const { input, finished } = startInput({ prompt: 'tab label', initial: 'old' });
    input.emit('data', Palette.KEY.ctrlU);
    input.emit('data', 'new name');
    input.emit('data', Palette.KEY.enter);
    assert.equal(await finished, 'new name');
});

test('the input prompt keeps its default when confirmed untouched', async () => {
    const { input, finished } = startInput({ prompt: 'directory', initial: '/Users/me' });
    input.emit('data', Palette.KEY.enter);
    assert.equal(await finished, '/Users/me');
});

test('a required input refuses to confirm while empty and says so', async () => {
    const { palette, input, output } = startInput({ prompt: 'tab label', required: true });
    input.emit('data', Palette.KEY.enter);
    assert.match(output.lastFrame, /This value is required/);
    assert.equal(palette.pending === null, false);

    input.emit('data', 'ok');
    input.emit('data', Palette.KEY.enter);
    assert.equal(palette.pending, null);
});

test('an optional input may confirm empty', async () => {
    const { input, finished } = startInput({ prompt: 'label' });
    input.emit('data', Palette.KEY.enter);
    assert.equal(await finished, '');
});

test('escape cancels the input prompt', async () => {
    const { input, finished } = startInput({ prompt: 'label', initial: 'x' });
    input.emit('data', Palette.KEY.escape);
    assert.equal(await finished, Palette.CANCELLED);
});

test('arrow keys are not typed into the input prompt', async () => {
    const { palette, input } = startInput({ prompt: 'label' });
    input.emit('data', Palette.KEY.down);
    input.emit('data', Palette.KEY.up);
    assert.equal(palette.query, '');
});

test('one palette instance serves a list then an input prompt in sequence', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const palette = new Palette({ input, output });

    const listResult = palette.chooseFromList({ items: [entry('Rename tab')] });
    input.emit('data', Palette.KEY.enter);
    assert.equal((await listResult).title, 'Rename tab');

    const inputResult = palette.promptForInput({ prompt: 'tab label' });
    input.emit('data', 'shipping');
    input.emit('data', Palette.KEY.enter);
    assert.equal(await inputResult, 'shipping');
});

test('entryColumns and choiceColumns map each shape onto the same three columns', () => {
    assert.deepEqual(Palette.entryColumns(entry('One', { chord: 'f1' })), {
        title: 'One',
        source: 'Acme Tools',
        chord: 'f1',
    });
    assert.deepEqual(Palette.choiceColumns({ value: 'wA', label: 'first' }), {
        title: 'first',
        source: '',
        chord: '',
    });
});

test('dispatch builds an --action request for a plugin entry and --command for a native one', () => {
    const spawned = [];
    const original = require('node:child_process').spawn;
    require('node:child_process').spawn = (command, args) => {
        spawned.push(args.slice(1));
        return { unref() {} };
    };

    try {
        Palette.dispatch(entry('One'), null);
        Palette.dispatch(
            { kind: 'native', id: 'tab.close', title: 'Tab: Close current' },
            ['tab', 'close', 'wE:t8']
        );
    } finally {
        require('node:child_process').spawn = original;
    }

    assert.deepEqual(spawned[0], ['--action', 'acme.tools', 'open']);
    assert.deepEqual(spawned[1], ['--command', 'tab', 'close', 'wE:t8']);
});
