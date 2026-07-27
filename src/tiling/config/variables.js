// Sway `set $name value` variables. Sway substitutes `$name` occurrences textually; this
// resolves them at parse time, top-to-bottom (define-before-use), so a binding sees only the
// variables defined above it — matching Sway's behaviour.

const IDENT = /[A-Za-z0-9_]/;

export class VariableTable {
    _vars = new Map();

    /** Define `$name` (pass the name without the leading `$`). */
    define(name, value) {
        this._vars.set(name, value);
    }

    get(name) {
        return this._vars.get(name);
    }

    /** Snapshot for inclusion in the resolved Config. */
    snapshot() {
        return new Map(this._vars);
    }

    /**
     * Replace `$name` occurrences in `token` with their values. Identifiers run over word
     * characters, so `$mod+$left` resolves both halves and `$term_app_id` matches the full
     * name (not a `$term` prefix). Unknown variables are left verbatim, as Sway does.
     */
    substitute(token) {
        if (!token.includes('$')) return token;
        let out = '';
        for (let i = 0; i < token.length; i++) {
            if (token[i] !== '$') {
                out += token[i];
                continue;
            }
            let j = i + 1;
            while (j < token.length && IDENT.test(token[j])) j++;
            const name = token.slice(i + 1, j);
            const value = this._vars.get(name);
            if (name.length > 0 && value !== undefined) {
                out += value;
                i = j - 1;
            } else {
                out += '$';
            }
        }
        return out;
    }
}
