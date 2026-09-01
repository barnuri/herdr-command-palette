#!/usr/bin/env node
'use strict';

const path = require('node:path');
// Held as a module reference rather than destructured so a test can substitute
// `spawn` and dispatch never launches a real detached process.
const childProcess = require('node:child_process');

const { listPluginActions, listPlugins, listWorkspaces, listTabs } = require('../lib/herdr');
const { buildPluginEntries, pluginNameLookup } = require('../lib/actions');
const { mergeEntries, searchText } = require('../lib/entries');
const { loadCatalog } = require('../lib/catalog');
const { buildContext } = require('../lib/context');
const { selectorChoices } = require('../lib/selectors');
const { resolveCommand } = require('../lib/resolve');
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
        red: '\x1b[31m',
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

    static LIST_MODE = 'list';

    static INPUT_MODE = 'input';

    static DEFAULT_ROWS = 24;

    static DEFAULT_COLUMNS = 80;

    // prompt line, separator, footer, and one spare row so the popup border never
    // eats the last result.
    static CHROME_ROWS = 4;

    static MARKER_WIDTH = 2;

    static COLUMN_GAP = 2;

    static MAX_SOURCE_WIDTH = 22;

    static MAX_CHORD_WIDTH = 18;

    static MIN_TITLE_WIDTH = 12;

    static ELLIPSIS = '…';

    static ESCAPE_SEQUENCE = /\x1b(\[[0-9;?]*[ -/]*[@-~]|O.|.)?/g;

    // A popup PTY commonly runs with application cursor keys (DECCKM) enabled, so
    // the arrows arrive as SS3 (`\x1bOA`) instead of CSI (`\x1b[A`). Fold both
    // encodings onto one key name rather than betting on the host's mode.
    static SS3_TO_CSI = {
        '\x1bOA': '\x1b[A',
        '\x1bOB': '\x1b[B',
        '\x1bOC': '\x1b[C',
        '\x1bOD': '\x1b[D',
        '\x1bOH': '\x1b[H',
        '\x1bOF': '\x1b[F',
    };

    static KEY_ALIASES = {
        '\x1b[1~': '\x1b[H',
        '\x1b[7~': '\x1b[H',
        '\x1b[4~': '\x1b[F',
        '\x1b[8~': '\x1b[F',
    };

    static SEQUENCE_FINAL = /[@-~]/;

    static PLUGIN_ID = 'barnuri.command-palette';

    static INVOKER_SCRIPT = 'invoke.js';

    static CANCELLED = null;

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

    static readSequence(chunk, start) {
        const introducer = chunk[start + 1];

        if (introducer === '[') {
            let end = start + 2;
            while (end < chunk.length && !Palette.SEQUENCE_FINAL.test(chunk[end])) {
                end += 1;
            }
            return chunk.slice(start, Math.min(end + 1, chunk.length));
        }
        if (introducer === 'O' && chunk.length > start + 2) {
            return chunk.slice(start, start + 3);
        }
        return Palette.KEY.escape;
    }

    static normalizeKey(sequence) {
        const csi = Palette.SS3_TO_CSI[sequence] || sequence;
        return Palette.KEY_ALIASES[csi] || csi;
    }

    // One read can carry several keys — an arrow pressed while text is still in
    // flight, or a key repeat. Comparing the whole chunk against a single key
    // loses every one of them, so split it into keys first.
    static splitKeys(chunk) {
        const keys = [];
        let text = '';
        let index = 0;

        const flush = () => {
            if (text.length > 0) {
                keys.push(text);
                text = '';
            }
        };

        while (index < chunk.length) {
            const character = chunk[index];

            if (character === Palette.KEY.escape) {
                flush();
                const sequence = Palette.readSequence(chunk, index);
                keys.push(Palette.normalizeKey(sequence));
                index += sequence.length;
                continue;
            }

            const code = character.codePointAt(0);
            if (code < 0x20 || code === 0x7f) {
                flush();
                keys.push(character);
                index += 1;
                continue;
            }

            text += character;
            index += 1;
        }

        flush();
        return keys;
    }

    static entryColumns(entry) {
        return { title: entry.title, source: entry.sourceLabel, chord: entry.chord || '' };
    }

    static choiceColumns(choice) {
        return { title: choice.label, source: '', chord: '' };
    }

    constructor({ input = process.stdin, output = process.stdout } = {}) {
        this.input = input;
        this.output = output;
        this.started = false;
        this.pending = null;
        this.mode = Palette.LIST_MODE;
        this.promptLabel = '';
        this.query = '';
        this.items = [];
        this.visible = [];
        this.selectedIndex = 0;
        this.scrollOffset = 0;
        this.columnsOf = Palette.entryColumns;
        this.searchOf = searchText;
        this.required = false;
        this.status = '';
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

    start() {
        if (this.started) {
            return;
        }
        this.started = true;

        if (this.input.isTTY) {
            this.input.setRawMode(true);
        }
        this.input.setEncoding('utf8');
        this.input.resume();
        this.output.write(Palette.ANSI.hideCursor);
        this.output.on('resize', () => this.render());
        this.input.on('data', (chunk) => this.handleChunk(chunk));
    }

    close() {
        this.input.removeAllListeners('data');
        if (this.input.isTTY) {
            this.input.setRawMode(false);
        }
        this.input.pause();
        this.output.write(`${Palette.ANSI.showCursor}${Palette.ANSI.clear}`);
    }

    settle(value) {
        const { pending } = this;
        this.pending = null;
        this.status = '';
        if (pending !== null) {
            pending(value);
        }
    }

    chooseFromList({ prompt = '', items, columnsOf = Palette.entryColumns, searchOf = searchText } = {}) {
        this.mode = Palette.LIST_MODE;
        this.promptLabel = prompt;
        this.query = '';
        this.items = items;
        this.columnsOf = columnsOf;
        this.searchOf = searchOf;
        this.applyQuery();
        this.start();
        this.render();

        return new Promise((resolve) => {
            this.pending = resolve;
        });
    }

    promptForInput({ prompt = '', initial = '', required = false } = {}) {
        this.mode = Palette.INPUT_MODE;
        this.promptLabel = prompt;
        this.query = initial;
        this.required = required;
        this.start();
        this.render();

        return new Promise((resolve) => {
            this.pending = resolve;
        });
    }

    applyQuery() {
        this.visible = fuzzyFilter(this.items, this.query, this.searchOf);
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
        const columns = window.map(this.columnsOf);
        const longestSource = columns.reduce((widest, column) => Math.max(widest, column.source.length), 0);
        const longestChord = columns.reduce((widest, column) => Math.max(widest, column.chord.length), 0);
        const sourceWidth = Math.min(Palette.MAX_SOURCE_WIDTH, longestSource);
        const chordWidth = Math.min(Palette.MAX_CHORD_WIDTH, longestChord);
        const used = Palette.MARKER_WIDTH + sourceWidth + chordWidth + Palette.COLUMN_GAP * 2;
        const titleWidth = Math.max(Palette.MIN_TITLE_WIDTH, this.columns - used - 1);
        return { sourceWidth, chordWidth, titleWidth };
    }

    renderRow(item, isSelected, widths) {
        const { ANSI } = Palette;
        const column = this.columnsOf(item);
        const marker = isSelected ? `${ANSI.cyan}▸ ${ANSI.reset}` : '  ';
        const titleStyle = isSelected ? ANSI.bold : '';
        const gap = ' '.repeat(Palette.COLUMN_GAP);

        return (
            `${marker}${titleStyle}${Palette.truncate(column.title, widths.titleWidth)}${ANSI.reset}${gap}` +
            `${ANSI.dim}${Palette.truncate(column.source, widths.sourceWidth)}${ANSI.reset}${gap}` +
            `${ANSI.yellow}${Palette.truncate(column.chord, widths.chordWidth)}${ANSI.reset}`
        );
    }

    promptLine(counter) {
        const { ANSI } = Palette;
        const label = this.promptLabel.length > 0 ? `${this.promptLabel} ` : '';
        const head = `${ANSI.cyan}${label}❯ ${ANSI.reset}${this.query}${ANSI.inverse} ${ANSI.reset}`;
        const padding = Math.max(1, this.columns - label.length - this.query.length - counter.length - 4);
        return `${head}${' '.repeat(padding)}${ANSI.dim}${counter}${ANSI.reset}`;
    }

    renderEmptyState() {
        const { ANSI } = Palette;
        if (this.items.length === 0) {
            return `  ${ANSI.dim}Nothing to choose here.${ANSI.reset}`;
        }
        return `  ${ANSI.dim}No entry matches "${this.query}".${ANSI.reset}`;
    }

    renderInput() {
        const { ANSI } = Palette;
        const lines = [this.promptLine('')];
        lines.push(`${ANSI.dim}${'─'.repeat(Math.max(1, this.columns - 1))}${ANSI.reset}`);
        if (this.status.length > 0) {
            lines.push(`  ${ANSI.red}${this.status}${ANSI.reset}`);
        }
        lines.push('');
        lines.push(`${ANSI.dim}⏎ confirm  esc cancel${ANSI.reset}`);
        return lines;
    }

    renderList() {
        const { ANSI } = Palette;
        const window = this.visible.slice(this.scrollOffset, this.scrollOffset + this.pageSize);
        const widths = this.columnWidths(window);
        const lines = [
            this.promptLine(`${this.visible.length}/${this.items.length}`),
            `${ANSI.dim}${'─'.repeat(Math.max(1, this.columns - 1))}${ANSI.reset}`,
        ];

        if (window.length === 0) {
            lines.push(this.renderEmptyState());
        } else {
            window.forEach((item, offset) => {
                lines.push(this.renderRow(item, this.scrollOffset + offset === this.selectedIndex, widths));
            });
        }

        lines.push('');
        lines.push(`${ANSI.dim}↑↓ select  ⏎ run  esc close${ANSI.reset}`);
        return lines;
    }

    render() {
        const lines = this.mode === Palette.INPUT_MODE ? this.renderInput() : this.renderList();
        this.output.write(`${Palette.ANSI.clear}${lines.join('\r\n')}`);
    }

    confirmInput() {
        if (this.required && this.query.trim().length === 0) {
            this.status = 'This value is required.';
            this.render();
            return;
        }
        this.settle(this.query);
    }

    editQuery(chunk) {
        const { KEY } = Palette;

        switch (chunk) {
            case KEY.backspace:
                this.query = this.query.slice(0, -1);
                return true;
            case KEY.ctrlW:
                this.query = Palette.deleteLastWord(this.query);
                return true;
            case KEY.ctrlU:
                this.query = '';
                return true;
            default: {
                const printable = Palette.printableFrom(chunk);
                if (printable.length === 0) {
                    return false;
                }
                this.query += printable;
                return true;
            }
        }
    }

    handleChunk(chunk) {
        for (const key of Palette.splitKeys(chunk)) {
            // A settled prompt has handed control back to the caller; the rest of
            // this read belongs to whatever it opens next, not to this list.
            if (this.pending === null) {
                return;
            }
            this.handleKey(key);
        }
    }

    handleKey(chunk) {
        const { KEY } = Palette;

        if (chunk === KEY.ctrlC || chunk === KEY.escape) {
            this.settle(Palette.CANCELLED);
            return;
        }
        if (chunk === KEY.enter || chunk === KEY.newline) {
            if (this.mode === Palette.INPUT_MODE) {
                this.confirmInput();
                return;
            }
            this.settle(this.visible[this.selectedIndex] || Palette.CANCELLED);
            return;
        }

        if (this.mode === Palette.INPUT_MODE) {
            if (this.editQuery(chunk)) {
                this.status = '';
                this.render();
            }
            return;
        }

        switch (chunk) {
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
            default:
                if (!this.editQuery(chunk)) {
                    return;
                }
                this.applyQuery();
        }

        this.render();
    }

    static loadContext() {
        let workspaces = [];
        let tabs = [];
        try {
            workspaces = listWorkspaces();
            tabs = listTabs(process.env.PALETTE_ORIGIN_WORKSPACE_ID);
        } catch (error) {
            process.stderr.write(`command-palette: could not read the session layout: ${error.message}\n`);
        }
        return buildContext({ env: process.env, workspaces, tabs });
    }

    static loadEntries(context) {
        const pluginEntries = buildPluginEntries(listPluginActions(), {
            excludePluginId: process.env.HERDR_PLUGIN_ID || Palette.PLUGIN_ID,
            pluginNames: pluginNameLookup(listPlugins()),
        });

        return mergeEntries([pluginEntries, loadCatalog(context)], {
            chords: loadChords(),
            rankOf: rankLookup(loadRecents()),
        });
    }

    // Neither kind can run from here: this process owns a session-modal popup, so
    // anything that opens a pane or popup of its own would be refused with
    // `ui_busy`. Hand the finished command to a detached child and get out of the way.
    static dispatch(entry, argv) {
        recordUse(entry.id);
        const args =
            entry.kind === 'native'
                ? ['--command', ...argv]
                : ['--action', entry.pluginId, entry.actionId];
        const child = childProcess.spawn(process.execPath, [path.join(__dirname, Palette.INVOKER_SCRIPT), ...args], {
            detached: true,
            stdio: 'ignore',
        });
        child.unref();
    }

    static async resolveNative(palette, entry, context) {
        return resolveCommand(entry, context, {
            promptForInput: (specification) => palette.promptForInput(specification),
            choicesFor: (selector, excludeContextKey) =>
                selectorChoices(selector, { context, excludeContextKey }),
            chooseFrom: async ({ prompt, choices }) => {
                const picked = await palette.chooseFromList({
                    prompt,
                    items: choices,
                    columnsOf: Palette.choiceColumns,
                    searchOf: (choice) => choice.label,
                });
                return picked === Palette.CANCELLED ? Palette.CANCELLED : picked.value;
            },
        });
    }

    static async main() {
        const context = Palette.loadContext();

        let entries;
        try {
            entries = Palette.loadEntries(context);
        } catch (error) {
            process.stderr.write(`command-palette: could not list commands: ${error.message}\n`);
            return 1;
        }

        const palette = new Palette({});
        let chosen;
        let argv = null;

        try {
            chosen = await palette.chooseFromList({ items: entries });
            if (chosen !== Palette.CANCELLED && chosen.kind === 'native') {
                argv = await Palette.resolveNative(palette, chosen, context);
            }
        } catch (error) {
            palette.close();
            process.stderr.write(`command-palette: ${error.message}\n`);
            return 1;
        }

        palette.close();

        if (chosen === Palette.CANCELLED) {
            return 0;
        }
        if (chosen.kind === 'native' && argv === Palette.CANCELLED) {
            return 0;
        }

        Palette.dispatch(chosen, argv);
        return 0;
    }
}

if (require.main === module) {
    Palette.main().then((code) => {
        process.exit(code);
    });
}

module.exports = Palette;
