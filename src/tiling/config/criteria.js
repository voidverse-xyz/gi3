// Parses a Sway criteria span like `[app_id="Alacritty" title="^foo" floating]` into a
// structured matcher. Conditions are `field=value`, `field="quoted value"`, or a bare
// `field` (presence). Variables are already resolved by the time this runs.

const KNOWN_FIELDS = new Set([
    'app_id',
    'class',
    'instance',
    'title',
    'con_mark',
    'con_id',
    'window_role',
    'window_type',
    'floating',
    'tiling',
    'urgent',
    'workspace',
    'shell',
    'pid',
    'machine',
]);

/**
 * Returns the parsed criteria plus any unknown field names encountered (for warnings).
 * @param {string} span
 * @returns {{criteria: import('./model.js').Criteria, unknown: string[]}}
 */
export function parseCriteria(span) {
    const inner = stripBrackets(span);
    const conditions = [];
    const unknown = [];

    let i = 0;
    while (i < inner.length) {
        if (inner[i] === ' ' || inner[i] === '\t') {
            i++;
            continue;
        }
        // Field name.
        let f = i;
        while (f < inner.length && inner[f] !== '=' && inner[f] !== ' ' && inner[f] !== '\t') f++;
        const field = inner.slice(i, f);
        i = f;

        // Optional value.
        let value = null;
        if (inner[i] === '=') {
            i++;
            const v = readValue(inner, i);
            value = v.value;
            i = v.next;
        }

        if (KNOWN_FIELDS.has(field)) {
            conditions.push({ field, value });
        } else if (field.length > 0) {
            unknown.push(field);
        }
    }

    return { criteria: { conditions }, unknown };
}

function stripBrackets(span) {
    let s = span.trim();
    if (s.startsWith('[')) s = s.slice(1);
    if (s.endsWith(']')) s = s.slice(0, -1);
    return s;
}

function readValue(s, start) {
    if (s[start] === '"' || s[start] === "'") {
        const quote = s[start];
        let v = '';
        let p = start + 1;
        for (; p < s.length; p++) {
            if (s[p] === quote) {
                p++;
                break;
            }
            v += s[p];
        }
        return { value: v, next: p };
    }
    let p = start;
    while (p < s.length && s[p] !== ' ' && s[p] !== '\t') p++;
    return { value: s.slice(start, p), next: p };
}
