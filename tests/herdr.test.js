'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { herdrBinary, runHerdr, listPluginActions, listPlugins, invokeAction, openPluginPane } = require('../lib/herdr');

// A stub `herdr` on disk is the only way to exercise the spawn path end to end:
// it records the argv it was called with and prints whatever envelope the test needs.
function withStubHerdr(script, run) {
    const previous = process.env.HERDR_BIN_PATH;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'palette-herdr-'));
    const binary = path.join(directory, 'herdr');
    const argvLog = path.join(directory, 'argv.txt');

    fs.writeFileSync(binary, `#!/bin/sh\nprintf '%s\\n' "$*" > "${argvLog}"\n${script}\n`, 'utf8');
    fs.chmodSync(binary, 0o755);
    process.env.HERDR_BIN_PATH = binary;

    try {
        run(() => fs.readFileSync(argvLog, 'utf8').trim());
    } finally {
        if (previous === undefined) {
            delete process.env.HERDR_BIN_PATH;
        } else {
            process.env.HERDR_BIN_PATH = previous;
        }
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('herdrBinary prefers HERDR_BIN_PATH over the bare command', () => {
    withStubHerdr('exit 0', () => {
        assert.equal(herdrBinary(), process.env.HERDR_BIN_PATH);
    });
});

test('runHerdr unwraps the result out of the JSON envelope', () => {
    withStubHerdr(`echo '{"id":"cli:test","result":{"value":7}}'`, () => {
        assert.deepEqual(runHerdr(['anything']), { value: 7 });
    });
});

test('runHerdr reports a non-zero exit with the stderr text', () => {
    withStubHerdr('echo "boom" >&2\nexit 3', () => {
        assert.throws(() => runHerdr(['fail']), /exited with code 3: boom/);
    });
});

test('runHerdr reports output that is not a JSON envelope', () => {
    withStubHerdr('echo "plain text"', () => {
        assert.throws(() => runHerdr(['text']), /did not print a JSON envelope/);
    });
});

test('runHerdr reports a binary that cannot be spawned', () => {
    const previous = process.env.HERDR_BIN_PATH;
    process.env.HERDR_BIN_PATH = '/nonexistent/herdr';
    try {
        assert.throws(() => runHerdr(['status']), /failed to spawn/);
    } finally {
        if (previous === undefined) {
            delete process.env.HERDR_BIN_PATH;
        } else {
            process.env.HERDR_BIN_PATH = previous;
        }
    }
});

test('listPluginActions returns an empty list when the result carries no actions', () => {
    withStubHerdr(`echo '{"id":"cli:plugin","result":{}}'`, () => {
        assert.deepEqual(listPluginActions(), []);
    });
});

test('listPluginActions asks for the plugin action list', () => {
    withStubHerdr(`echo '{"id":"cli:plugin","result":{"actions":[{"action_id":"a"}]}}'`, (argv) => {
        assert.deepEqual(listPluginActions(), [{ action_id: 'a' }]);
        assert.equal(argv(), 'plugin action list');
    });
});

test('listPlugins asks for the json plugin listing', () => {
    withStubHerdr(`echo '{"id":"cli:plugin","result":{"plugins":[]}}'`, (argv) => {
        listPlugins();
        assert.equal(argv(), 'plugin list --json');
    });
});

test('invokeAction passes the action id positionally and the plugin as a flag', () => {
    withStubHerdr('exit 0', (argv) => {
        invokeAction('acme.tools', 'do-thing');
        assert.equal(argv(), 'plugin action invoke do-thing --plugin acme.tools');
    });
});

test('invokeAction rejects missing ids before spawning anything', () => {
    assert.throws(() => invokeAction('', 'do-thing'), TypeError);
    assert.throws(() => invokeAction('acme.tools', ''), TypeError);
});

test('openPluginPane focuses the pane and forwards only non-empty env values', () => {
    withStubHerdr(`echo '{"id":"cli:plugin","result":{}}'`, (argv) => {
        openPluginPane({ pluginId: 'acme.tools', entrypoint: 'palette', env: { A: '1', B: '' } });
        assert.equal(
            argv(),
            'plugin pane open --plugin acme.tools --entrypoint palette --focus --env A=1'
        );
    });
});

test('openPluginPane rejects a missing plugin id or entrypoint', () => {
    assert.throws(() => openPluginPane({ entrypoint: 'palette' }), TypeError);
    assert.throws(() => openPluginPane({ pluginId: 'acme.tools' }), TypeError);
});
