// Turns raw Sway config text into logical lines of tokens. Sway's config is line-oriented:
//   - a line whose first non-blank character is `#` is a comment (so `#rrggbb` colour args,
//     which are not at line-start, are preserved);
//   - a trailing `\` continues onto the next physical line;
//   - tokens are whitespace-separated, with single/double quotes grouping (quotes stripped);
//   - `{` and `}` are structural tokens (block start/end);
//   - a `[ ... ]` criteria span is captured whole as one token for the criteria parser.

/**
 * @typedef {object} LogicalLine
 * @property {string[]} tokens
 * @property {number} line 1-based line number of the (first) physical line, for diagnostics.
 * @property {string} raw
 */

/** @param {string} input @returns {LogicalLine[]} */
export function lex(input) {
    const physical = input.split('\n');
    const out = [];

    let i = 0;
    while (i < physical.length) {
        const startLine = i + 1;

        // Skip whole-line comments and blank lines.
        if (isCommentOrBlank(physical[i])) {
            i++;
            continue;
        }

        // Join continuation lines (trailing backslash).
        let raw = physical[i];
        while (endsWithContinuation(raw) && i + 1 < physical.length) {
            raw = raw.slice(0, raw.lastIndexOf('\\')) + ' ' + physical[i + 1];
            i++;
        }
        i++;

        const tokens = tokenize(raw);
        if (tokens.length > 0) out.push({ tokens, line: startLine, raw });
    }
    return out;
}

function isCommentOrBlank(line) {
    // Avoid String.prototype.trimStart so the lexer stays friendly to older embedded JS engines.
    const trimmed = line.replace(/^\s+/, '');
    return trimmed.length === 0 || trimmed.startsWith('#');
}

function endsWithContinuation(line) {
    // A backslash immediately before the (stripped) newline continues the line.
    return /\\\s*$/.test(line);
}

function tokenize(line) {
    const tokens = [];
    let cur = '';
    let hasCur = false; // distinguishes an empty quoted token "" from no token

    const push = () => {
        if (hasCur) tokens.push(cur);
        cur = '';
        hasCur = false;
    };

    for (let p = 0; p < line.length; p++) {
        const ch = line[p];

        if (ch === ' ' || ch === '\t') {
            push();
            continue;
        }
        if (ch === '{' || ch === '}') {
            push();
            tokens.push(ch);
            continue;
        }
        if (ch === '[' && !hasCur) {
            // Capture the whole criteria span (including brackets), respecting quotes.
            const end = findCriteriaEnd(line, p);
            tokens.push(line.slice(p, end + 1));
            p = end;
            continue;
        }
        if (ch === '"' || ch === "'") {
            const quoted = readQuoted(line, p, ch);
            cur += quoted.content;
            hasCur = true;
            p = quoted.end;
            continue;
        }
        cur += ch;
        hasCur = true;
    }
    push();
    return tokens;
}

function findCriteriaEnd(line, start) {
    for (let p = start + 1; p < line.length; p++) {
        const ch = line[p];
        if (ch === '"' || ch === "'") {
            p = readQuoted(line, p, ch).end;
            continue;
        }
        if (ch === ']') return p;
    }
    return line.length - 1; // unterminated — take the rest
}

function readQuoted(line, start, quote) {
    let content = '';
    for (let p = start + 1; p < line.length; p++) {
        if (line[p] === quote) return { content, end: p };
        content += line[p];
    }
    return { content, end: line.length - 1 }; // unterminated — take the rest
}
