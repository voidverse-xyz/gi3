// Top-level Sway config parser: lexes the text, resolves variables top-to-bottom, and
// dispatches each logical line by its keyword into the resolved Config. Block directives
// (`mode { ... }`, and the shell-owned `input/output/bar { ... }`) are handled by tracking brace
// depth. Like Sway, unrecognised lines are recorded (as ignored/warnings) rather than fatal.

import { parseCommand } from './commandParser.js';
import { parseCriteria } from './criteria.js';
import { lex } from './lexer.js';
import { emptySettings } from './model.js';
import { VariableTable } from './variables.js';

/** Keywords that open a shell-owned block we skip entirely. */
const SKIP_BLOCKS = new Set(['input', 'output', 'bar', 'seat']);

/** Keywords we recognise but intentionally don't act on, with why. */
const IGNORED = {
    exec: 'system',
    exec_always: 'system',
    output: 'system',
    input: 'system',
    seat: 'system',
    bar: 'system',
    font: 'decoration',
    titlebar_padding: 'decoration',
    titlebar_border_thickness: 'decoration',
    default_floating_border: 'decoration',
    title_align: 'decoration',
};

/** @param {string} input @returns {import('./model.js').Config} */
export function parseConfig(input) {
    const lines = lex(input);
    const vars = new VariableTable();
    const config = {
        variables: new Map(),
        settings: emptySettings(),
        bindings: [],
        modes: {},
        rules: [],
        ignored: [],
        warnings: [],
    };

    // Where bindings currently go (the default set, or a named mode's set).
    let bindingTarget = config.bindings;
    let skipDepth = 0; // >0 while inside a skipped block

    for (const ln of lines) {
        if (skipDepth > 0) {
            skipDepth += braceDelta(ln.tokens);
            continue;
        }

        // `set` defines a variable from its raw (only the value is variable-expanded).
        if (ln.tokens[0] === 'set' && ln.tokens[1]?.startsWith('$')) {
            const name = ln.tokens[1].slice(1);
            const value = ln.tokens
                .slice(2)
                .map((t) => vars.substitute(t))
                .join(' ');
            vars.define(name, value);
            continue;
        }

        const tokens = ln.tokens.map((t) => vars.substitute(t));
        const keyword = tokens[0].toLowerCase();
        const opensBlock = tokens[tokens.length - 1] === '{';

        // Close the current block.
        if (keyword === '}') {
            bindingTarget = config.bindings;
            continue;
        }

        if (opensBlock) {
            if (keyword === 'mode') {
                const name = blockName(tokens);
                config.modes[name] ??= [];
                bindingTarget = config.modes[name];
            } else {
                // Shell-owned (input/output/bar/seat) or unknown block -> skip its body.
                if (!SKIP_BLOCKS.has(keyword)) recordIgnored(config, keyword, ln, 'unsupported');
                else recordIgnored(config, keyword, ln, 'system');
                skipDepth = 1;
            }
            continue;
        }

        dispatch(config, bindingTarget, keyword, tokens, ln);
    }

    config.variables = vars.snapshot();
    config.settings.mod = vars.get('mod') ?? null;
    return config;
}

function dispatch(config, bindings, keyword, tokens, ln) {
    switch (keyword) {
        case 'bindsym':
        case 'bindcode': {
            const spec = parseBinding(tokens, keyword === 'bindcode');
            if (spec) bindings.push(spec);
            else config.warnings.push({ line: ln.line, message: 'malformed binding' });
            return;
        }
        case 'for_window':
        case 'assign': {
            const rule = parseRule(keyword, tokens);
            if (rule) config.rules.push(rule);
            return;
        }
        case 'gaps':
            applyGaps(config, tokens);
            return;
        case 'default_border':
            config.settings.defaultBorder = parseBorder(tokens.slice(1));
            return;
        case 'floating_modifier':
            config.settings.floatingModifier = tokens[1] ?? null;
            return;
        default:
            if (keyword.startsWith('client.')) {
                recordIgnored(config, keyword, ln, 'decoration');
            } else if (keyword in IGNORED) {
                recordIgnored(config, keyword, ln, IGNORED[keyword]);
            } else {
                recordIgnored(config, keyword, ln, 'unsupported');
            }
    }
}

function parseBinding(tokens, byCode) {
    let p = 1;
    const flags = [];
    while (tokens[p]?.startsWith('--')) flags.push(tokens[p++]);
    const combo = tokens[p++];
    if (!combo) return null;
    return { combo, flags, byCode, command: parseCommand(tokens.slice(p)) };
}

function parseRule(kind, tokens) {
    const criteriaTok = tokens[1];
    if (!criteriaTok?.startsWith('[')) return null;
    const { criteria } = parseCriteria(criteriaTok);
    // `assign [crit] [→] workspace N` carries an implicit move-to-workspace command.
    const rest = tokens.slice(2).filter((t) => t !== '→');
    const command = kind === 'assign' ? parseCommand(['move', 'container', 'to', ...rest]) : parseCommand(rest);
    return { kind, criteria, command };
}

function applyGaps(config, tokens) {
    const which = tokens[1]?.toLowerCase();
    const amount = Number(tokens[2]);
    if (Number.isNaN(amount)) return;
    if (which === 'inner') config.settings.gapsInner = amount;
    else if (which === 'outer') config.settings.gapsOuter = amount;
}

function parseBorder(rest) {
    const style = rest[0]?.toLowerCase();
    if (style === 'none') return { style: 'none', px: 0 };
    if (style === 'pixel') return { style: 'pixel', px: Number(rest[1] ?? 1) || 1 };
    return { style: 'normal', px: Number(rest[1] ?? 2) || 2 };
}

/** The name of a `mode [--flags] "name" {` block: the last token before `{`. */
function blockName(tokens) {
    return tokens[tokens.length - 2] ?? '';
}

function braceDelta(tokens) {
    let d = 0;
    for (const t of tokens) {
        if (t === '{') d++;
        else if (t === '}') d--;
    }
    return d;
}

function recordIgnored(config, keyword, ln, reason) {
    config.ignored.push({ keyword, line: ln.line, reason });
}
