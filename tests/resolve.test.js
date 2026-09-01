'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CANCELLED, resolveCommand } = require('../lib/resolve');

function entry(overrides = {}) {
    return { command: ['tab', 'close'], arguments: [{ source: 'context', key: 'tab_id' }], ...overrides };
}

test('a context argument is substituted from the captured origin', async () => {
    const argv = await resolveCommand(entry(), { tab_id: 'wE:t8' }, {});
    assert.deepEqual(argv, ['tab', 'close', 'wE:t8']);
});

test('a missing context value fails loudly rather than running a truncated command', async () => {
    await assert.rejects(() => resolveCommand(entry(), {}, {}), /missing "tab_id"/);
});

test('literal arguments are passed through in order', async () => {
    const argv = await resolveCommand(
        entry({
            command: ['pane', 'split'],
            arguments: [
                { source: 'literal', value: '--pane' },
                { source: 'context', key: 'pane_id' },
                { source: 'literal', value: '--direction' },
                { source: 'literal', value: 'right' },
            ],
        }),
        { pane_id: 'wE:pR' },
        {}
    );
    assert.deepEqual(argv, ['pane', 'split', '--pane', 'wE:pR', '--direction', 'right']);
});

test('an input argument is filled from the prompt callback', async () => {
    const argv = await resolveCommand(
        entry({
            command: ['tab', 'rename'],
            arguments: [
                { source: 'context', key: 'tab_id' },
                { source: 'input', prompt: 'tab label', required: true },
            ],
        }),
        { tab_id: 't1' },
        { promptForInput: async () => 'Release work' }
    );
    assert.deepEqual(argv, ['tab', 'rename', 't1', 'Release work']);
});

test('an input argument seeds its prompt from default_context', async () => {
    const seen = [];
    await resolveCommand(
        entry({
            command: ['workspace', 'create'],
            arguments: [{ source: 'input', prompt: 'directory', default_context: 'cwd', required: true }],
        }),
        { cwd: '/Users/me/code' },
        {
            promptForInput: async (specification) => {
                seen.push(specification);
                return specification.initial;
            },
        }
    );
    assert.deepEqual(seen, [{ prompt: 'directory', initial: '/Users/me/code', required: true }]);
});

test('an input prompt with no default_context starts empty', async () => {
    let initial = 'unset';
    await resolveCommand(
        entry({ command: ['tab', 'rename'], arguments: [{ source: 'input', prompt: 'label' }] }),
        {},
        {
            promptForInput: async (specification) => {
                initial = specification.initial;
                return 'x';
            },
        }
    );
    assert.equal(initial, '');
});

test('cancelling an input aborts the whole command', async () => {
    const argv = await resolveCommand(
        entry({ command: ['tab', 'rename'], arguments: [{ source: 'input', prompt: 'label' }] }),
        {},
        { promptForInput: async () => CANCELLED }
    );
    assert.equal(argv, CANCELLED);
});

test('a select argument contributes the picked value', async () => {
    const argv = await resolveCommand(
        entry({
            command: ['workspace', 'focus'],
            arguments: [{ source: 'select', selector: 'workspaces', prompt: 'workspace' }],
        }),
        {},
        {
            choicesFor: async () => [{ value: 'wB', label: 'second' }],
            chooseFrom: async ({ choices }) => choices[0].value,
        }
    );
    assert.deepEqual(argv, ['workspace', 'focus', 'wB']);
});

test('a select argument forwards its exclusion key to the choices lookup', async () => {
    let seen;
    await resolveCommand(
        entry({
            command: ['workspace', 'focus'],
            arguments: [
                {
                    source: 'select',
                    selector: 'workspaces',
                    prompt: 'workspace',
                    exclude_context: 'workspace_id',
                },
            ],
        }),
        { workspace_id: 'wA' },
        {
            choicesFor: async (selector, excludeContextKey) => {
                seen = { selector, excludeContextKey };
                return [{ value: 'wB', label: 'second' }];
            },
            chooseFrom: async ({ choices }) => choices[0].value,
        }
    );
    assert.deepEqual(seen, { selector: 'workspaces', excludeContextKey: 'workspace_id' });
});

test('a select with nothing to offer fails instead of showing an empty picker', async () => {
    await assert.rejects(
        () =>
            resolveCommand(
                entry({
                    command: ['agent', 'focus'],
                    arguments: [{ source: 'select', selector: 'agents', prompt: 'agent' }],
                }),
                {},
                { choicesFor: async () => [] }
            ),
        /nothing to choose for "agent"/
    );
});

test('cancelling a select aborts the whole command', async () => {
    const argv = await resolveCommand(
        entry({
            command: ['workspace', 'focus'],
            arguments: [{ source: 'select', selector: 'workspaces', prompt: 'workspace' }],
        }),
        {},
        { choicesFor: async () => [{ value: 'wB', label: 'second' }], chooseFrom: async () => CANCELLED }
    );
    assert.equal(argv, CANCELLED);
});

test('a command with no arguments resolves to its bare argv', async () => {
    const argv = await resolveCommand(
        entry({ command: ['server', 'reload-config'], arguments: [] }),
        {},
        {}
    );
    assert.deepEqual(argv, ['server', 'reload-config']);
});

test('an unsupported argument source is reported rather than silently skipped', async () => {
    await assert.rejects(
        () => resolveCommand(entry({ arguments: [{ source: 'magic' }] }), {}, {}),
        /unsupported argument source "magic"/
    );
});
