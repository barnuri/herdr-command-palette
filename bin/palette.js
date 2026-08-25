#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const { listPluginActions, listPlugins } = require('../lib/herdr');
const { buildActionList, pluginNameLookup, searchText } = require('../lib/actions');
const { fuzzyFilter } = require('../lib/fuzzy');
const { loadChords } = require('../lib/keybindings');
const { loadRecents, recordUse, rankLookup } = require('../lib/recents');

class Palette {
    static ANSI = {
        clear: '\x1b[2J\x1b[H',
        hideCursor: '\x1b[?25l',
        showCursor: '\x1b[?25h',
        reset: '\x1b[0m',
        bold: '\x1b[1m',
        dim: '\x1b[2m',
        inverse: '\x1b[7m',
        cyan: '\x1b[36m',
        yellow: '\x1b[33m',
    };

    static KEY = {
        ctrlC: '\x03',
        ctrlN: '\x0e',
        ctrlP: '\x10',
        ctrlU: '\x15',
        ctrlW: '\x17',
        escape: '\x1b',
        enter: '\r',
        newline: '\n',
        backspace: '\x7f',
        up: '\x1b[A',
        down: '\x1b[B',
        pageUp: '\x1b[5~',
        pageDown: '\x1b[6~',
        home: '\x1b[H',
        end: '\x1b[F',
    };

    static DEFAULT_ROWS = 24;

    static DEFAULT_COLUMNS = 80;

    // prompt line, separator, footer, and one spare row so the popup border never
    // eats the last result.
    static CHROME_ROWS = 4;

    static MARKER_WIDTH = 2;

    static COLUMN_GAP = 2;

    static MAX_PLUGIN_WIDTH = 22;

    static MAX_CHORD_WIDTH = 18;

    static MIN_TITLE_WIDTH = 12;

    static ELLIPSIS = '…';

    static ESCAPE_SEQUENCE = /\x1b(\[[0-9;?]*[ -/]*[@-~]|O.|.)?/g;

    static PLUGIN_ID = 'barnuri.command-palette';

    static INVOKER_SCRIPT = 'invoke.js';

    static truncate(text, width) {
        if (width <= 0) {
            return '';
        }
        if (text.length <= width) {
            return text.padEnd(width, ' ');
        }
        return `${text.slice(0, width - 1)}${Palette.ELLIPSIS}`;
    }

    static deleteLastWord(query) {
        return query.replace(/\s*\S+\s*$/, '');
    }

    // An unhandled escape sequence (F-keys, shift+arrows) must contribute nothing.
    // Filtering the chunk character by character would leak its `[`, digits and
    // final letter into the query as if they had been typed, so drop whole
    // sequences first — fast typing can deliver one in the same chunk as real text.
    static printableFrom(chunk) {
        const withoutSequences = chunk.replace(Palette.ESCAPE_SEQUENCE, '');

        let printable = '';
        for (const character of withoutSequences) {
            const code = character.codePointAt(0);
            if (code >= 0x20 && code !== 0x7f) {
                printable += character;
            }
        }
        return printable;
    }

    constructor({ actions, input = process.stdin, output = process.stdout } = {}) {
        this.actions = actions;
        this.input = input;
        this.output = output;
        this.query = '';
        this.selectedIndex = 0;
        this.scrollOffset = 0;
        this.visible = actions;
        this.chosen = null;
    }

    get rows() {
        return this.output.rows || Palette.DEFAULT_ROWS;
    }

    get columns() {
        return this.output.columns || Palette.DEFAULT_COLUMNS;
    }

    get pageSize() {
        return Math.max(1, this.rows - Palette.CHROME_ROWS);
    }

    applyQuery() {
        this.visible = fuzzyFilter(this.actions, this.query, searchText);
        this.selectedIndex = 0;
        this.scrollOffset = 0;
    }

    moveSelection(delta) {
        if (this.visible.length === 0) {
            return;
        }

        const lastIndex = this.visible.length - 1;
        this.selectedIndex = Math.min(lastIndex, Math.max(0, this.selectedIndex + delta));

        if (this.selectedIndex < this.scrollOffset) {
            this.scrollOffset = this.selectedIndex;
            return;
        }
        if (this.selectedIndex >= this.scrollOffset + this.pageSize) {
            this.scrollOffset = this.selectedIndex - this.pageSize + 1;
        }
    }

    columnWidths(window) {
        const longestPlugin = window.reduce((widest, action) => Math.max(widest, action.pluginLabel.length), 0);
        const longestChord = window.reduce((widest, action) => Math.max(widest, action.chord.length), 0);
        const pluginWidth = Math.min(Palette.MAX_PLUGIN_WIDTH, longestPlugin);
        const chordWidth = Math.min(Palette.MAX_CHORD_WIDTH, longestChord);
        const used = Palette.MARKER_WIDTH + pluginWidth + chordWidth + Palette.COLUMN_GAP * 2;
        const titleWidth = Math.max(Palette.MIN_TITLE_WIDTH, this.columns - used - 1);
        return { pluginWidth, chordWidth, titleWidth };
    }

    renderRow(action, isSelected, widths) {
        const { ANSI } = Palette;
        const marker = isSelected ? `${ANSI.cyan}▸ ${ANSI.reset}` : '  ';
        const title = Palette.truncate(action.title, widths.titleWidth);
        const plugin = Palette.truncate(action.pluginLabel, widths.pluginWidth);
        const chord = Palette.truncate(action.chord, widths.chordWidth);
        const titleStyle = isSelected ? ANSI.bold : '';
        const gap = ' '.repeat(Palette.COLUMN_GAP);

        return (
            `${marker}${titleStyle}${title}${ANSI.reset}${gap}` +
            `${ANSI.dim}${plugin}${ANSI.reset}${gap}${ANSI.yellow}${chord}${ANSI.reset}`
        );
    }

    renderEmptyState() {
        const { ANSI } = Palette;
        if (this.actions.length === 0) {
            return `  ${ANSI.dim}No plugin actions are installed.${ANSI.reset}`;
        }
        return `  ${ANSI.dim}No action matches "${this.query}".${ANSI.reset}`;
    }

    render() {
        const { ANSI } = Palette;
        const window = this.visible.slice(this.scrollOffset, this.scrollOffset + this.pageSize);
        const widths = this.columnWidths(window);

        const counter = `${this.visible.length}/${this.actions.length}`;
        const promptText = `${ANSI.cyan}❯ ${ANSI.reset}${this.query}${ANSI.inverse} ${ANSI.reset}`;
        const promptPadding = Math.max(
            1,
            this.columns - this.query.length - counter.length - 4
        );

        const lines = [
            `${promptText}${' '.repeat(promptPadding)}${ANSI.dim}${counter}${ANSI.reset}`,
            `${ANSI.dim}${'─'.repeat(Math.max(1, this.columns - 1))}${ANSI.reset}`,
        ];

        if (window.length === 0) {
            lines.push(this.renderEmptyState());
        } else {
            window.forEach((action, offset) => {
                lines.push(this.renderRow(action, this.scrollOffset + offset === this.selectedIndex, widths));
            });
        }

        lines.push('');
        lines.push(`${ANSI.dim}↑↓ select  ⏎ run  esc close${ANSI.reset}`);

        this.output.write(`${ANSI.clear}${lines.join('\r\n')}`);
    }

    handleChunk(chunk) {
        const { KEY } = Palette;

        switch (chunk) {
            case KEY.ctrlC:
            case KEY.escape:
                this.finish(null);
                return;
            case KEY.enter:
            case KEY.newline:
                this.finish(this.visible[this.selectedIndex] || null);
                return;
            case KEY.up:
            case KEY.ctrlP:
                this.moveSelection(-1);
                break;
            case KEY.down:
            case KEY.ctrlN:
                this.moveSelection(1);
                break;
            case KEY.pageUp:
                this.moveSelection(-this.pageSize);
                break;
            case KEY.pageDown:
                this.moveSelection(this.pageSize);
                break;
            case KEY.home:
                this.moveSelection(-this.visible.length);
                break;
            case KEY.end:
                this.moveSelection(this.visible.length);
                break;
            case KEY.backspace:
                this.query = this.query.slice(0, -1);
                this.applyQuery();
                break;
            case KEY.ctrlW:
                this.query = Palette.deleteLastWord(this.query);
                this.applyQuery();
                break;
            case KEY.ctrlU:
                this.query = '';
                this.applyQuery();
                break;
            default: {
                const printable = Palette.printableFrom(chunk);
                if (printable.length === 0) {
                    return;
                }
                this.query += printable;
                this.applyQuery();
            }
        }

        this.render();
    }

    finish(action) {
        this.chosen = action;
        this.teardown();
        if (this.resolve) {
            this.resolve(action);
        }
    }

    teardown() {
        const { ANSI } = Palette;
        this.input.removeAllListeners('data');
        if (this.input.isTTY) {
            this.input.setRawMode(false);
        }
        this.input.pause();
        this.output.write(`${ANSI.showCursor}${ANSI.clear}`);
    }

    run() {
        const { ANSI } = Palette;
        this.applyQuery();

        if (this.input.isTTY) {
            this.input.setRawMode(true);
        }
        this.input.setEncoding('utf8');
        this.input.resume();
        this.output.write(ANSI.hideCursor);
        this.output.on('resize', () => this.render());
        this.render();

        return new Promise((resolve) => {
            this.resolve = resolve;
            this.input.on('data', (chunk) => this.handleChunk(chunk));
        });
    }

    static loadActions() {
        const rawActions = listPluginActions();
        const pluginNames = pluginNameLookup(listPlugins());
        return buildActionList(rawActions, {
            excludePluginId: process.env.HERDR_PLUGIN_ID || Palette.PLUGIN_ID,
            pluginNames,
            chords: loadChords(),
            rankOf: rankLookup(loadRecents()),
        });
    }

    // The chosen action cannot run from here: this process owns a session-modal
    // popup, so anything that opens a pane or popup of its own would be refused
    // with `ui_busy`. Hand it to a detached child and get out of the way.
    static dispatch(action) {
        recordUse(action.qualifiedId);
        const child = spawn(
            process.execPath,
            [path.join(__dirname, Palette.INVOKER_SCRIPT), action.pluginId, action.actionId],
            { detached: true, stdio: 'ignore' }
        );
        child.unref();
    }

    static async main() {
        let actions;
        try {
            actions = Palette.loadActions();
        } catch (error) {
            process.stderr.write(`command-palette: could not list plugin actions: ${error.message}\n`);
            return 1;
        }

        const chosen = await new Palette({ actions }).run();
        if (chosen === null) {
            return 0;
        }

        Palette.dispatch(chosen);
        return 0;
    }
}

if (require.main === module) {
    Palette.main().then((code) => {
        process.exit(code);
    });
}

module.exports = Palette;
