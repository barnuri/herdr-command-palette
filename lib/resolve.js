'use strict';

const CANCELLED = null;

function contextValue(context, key) {
  const value = context[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`missing "${key}" for this command`);
  }
  return value;
}

// Walks the argument specs in order, pausing on `input` and `select` to ask the
// caller (the popup, the only part of the plugin with a TTY). Returning
// CANCELLED from either callback aborts the whole command, which is what Escape
// in a sub-prompt should mean — not "run it with a blank argument".
async function resolveCommand(entry, context, { promptForInput, chooseFrom, choicesFor } = {}) {
    const argv = [...entry.command];

    for (const argument of entry.arguments) {
        switch (argument.source) {
            case 'literal':
                argv.push(argument.value);
                break;

            case 'context':
                argv.push(contextValue(context, argument.key));
                break;

            case 'input': {
                const initial =
                    argument.default_context === undefined ? '' : context[argument.default_context] || '';
                const typed = await promptForInput({
                    prompt: argument.prompt,
                    initial,
                    required: argument.required === true,
                });
                if (typed === CANCELLED) {
                    return CANCELLED;
                }
                argv.push(typed);
                break;
            }

            case 'select': {
                const choices = await choicesFor(argument.selector, argument.exclude_context);
                if (choices.length === 0) {
                    throw new Error(`nothing to choose for "${argument.prompt}"`);
                }
                const picked = await chooseFrom({ prompt: argument.prompt, choices });
                if (picked === CANCELLED) {
                    return CANCELLED;
                }
                argv.push(picked);
                break;
            }

            default:
                throw new Error(`unsupported argument source "${argument.source}"`);
        }
    }

    return argv;
}

module.exports = { CANCELLED, resolveCommand };
