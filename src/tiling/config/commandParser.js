// Parses a Sway command (a token list) into this project's Command model. The SAME parser is
// used for config bindings/rules and for live command dispatch, so `bindsym $mod+h focus left`
// and a runtime `focus left` produce identical Commands. Commands we don't implement (exec,
// opacity, output moves, …) resolve to `{ type: "nop" }` so they're recognised but harmless.

const NOP = { type: 'nop' };

/** @param {string[]} tokens @returns {import('../engine/engine.js').Command} */
export function parseCommand(tokens) {
    if (tokens.length === 0) return NOP;
    const [head, ...rest] = tokens;

    switch (head.toLowerCase()) {
        case 'exec':
        case 'exec_always':
            return NOP; // launching apps is left to the user's desktop session
        case 'kill':
            return { type: 'kill' };
        case 'reload':
            return { type: 'reload' };
        case 'fullscreen':
            return { type: 'fullscreen' };
        case 'focus':
            return parseFocus(rest);
        case 'move':
            return parseMove(rest);
        case 'resize':
            return parseResize(rest);
        case 'split':
            return parseSplit(rest);
        case 'splith':
            return { type: 'split', orientation: 'horizontal' };
        case 'splitv':
            return { type: 'split', orientation: 'vertical' };
        case 'layout':
            return parseLayout(rest);
        case 'floating':
            return parseFloating(rest);
        case 'workspace':
            return parseWorkspace(rest);
        case 'scratchpad':
            return rest[0]?.toLowerCase() === 'show' ? { type: 'scratchpadShow' } : NOP;
        case 'nop':
            return { type: 'nop' };
        default:
            return NOP;
    }
}

const DIRECTIONS = new Set(['left', 'right', 'up', 'down']);

function parseFocus(rest) {
    const a = rest[0]?.toLowerCase();
    if (a && DIRECTIONS.has(a)) return { type: 'focus', dir: a };
    if (a === 'parent') return { type: 'focusParent' };
    if (a === 'child') return { type: 'focusChild' };
    if (a === 'mode_toggle') return { type: 'focusModeToggle' };
    return NOP;
}

function parseMove(rest) {
    const a = rest[0]?.toLowerCase();
    if (a && DIRECTIONS.has(a)) return { type: 'move', dir: a };
    if (a === 'scratchpad' || (a === 'to' && rest[1]?.toLowerCase() === 'scratchpad')) {
        return { type: 'moveScratchpad' };
    }
    // move [container|window] [to] workspace [number] <target>
    const ws = workspaceTarget(rest);
    if (ws !== null) return { type: 'moveToWorkspace', workspace: ws };
    return NOP;
}

function parseResize(rest) {
    const mode = rest[0]?.toLowerCase();
    if (mode !== 'grow' && mode !== 'shrink') return NOP;
    const axisTok = rest[1]?.toLowerCase();
    const axis = axisTok === 'width' ? 'width' : axisTok === 'height' ? 'height' : null;
    if (!axis) return NOP;
    const { amount, unit } = parseAmount(rest.slice(2));
    return { type: 'resize', mode, axis, amount, unit };
}

function parseFloating(rest) {
    switch (rest[0]?.toLowerCase()) {
        case 'toggle':
            return { type: 'floatingToggle' };
        case 'enable':
            return { type: 'setFloating', floating: true };
        case 'disable':
            return { type: 'setFloating', floating: false };
        default:
            return NOP;
    }
}

function parseSplit(rest) {
    const a = rest[0]?.toLowerCase();
    if (a === 'h' || a === 'horizontal') return { type: 'split', orientation: 'horizontal' };
    if (a === 'v' || a === 'vertical') return { type: 'split', orientation: 'vertical' };
    if (a === 'toggle') return { type: 'layoutToggleSplit' };
    return NOP;
}

function parseLayout(rest) {
    const a = rest[0]?.toLowerCase();
    switch (a) {
        case 'default':
        case 'splith':
            return { type: 'layout', layout: 'splith' };
        case 'splitv':
            return { type: 'layout', layout: 'splitv' };
        case 'tabbed':
        case 'stacking':
            // Not implemented — this extension only supports splith/splitv containers.
            return NOP;
        case 'toggle':
            // `layout toggle split` (and bare `layout toggle`) flip between the split layouts.
            return { type: 'layoutToggleSplit' };
        default:
            return NOP;
    }
}

const RELATIVE_WORKSPACES = new Set(['next', 'prev', 'next_on_output', 'prev_on_output', 'back_and_forth', 'current']);

function parseWorkspace(rest) {
    let p = 0;
    if (rest[p]?.toLowerCase() === 'number') p++;
    const tok = rest[p];
    if (tok === undefined || RELATIVE_WORKSPACES.has(tok.toLowerCase())) return NOP;
    const target = /^\d+$/.test(tok) ? Number(tok) : rest.slice(p).join(' ');
    return { type: 'workspace', workspace: target };
}

/** Resolve a `[container] [to] workspace [number] <target>` tail to a name or number. */
function workspaceTarget(rest) {
    const idx = rest.findIndex((t) => t.toLowerCase() === 'workspace');
    if (idx < 0) return null;
    let p = idx + 1;
    if (rest[p]?.toLowerCase() === 'number') p++;
    const tok = rest[p];
    if (tok === undefined) return null;
    return /^\d+$/.test(tok) ? Number(tok) : rest.slice(p).join(' ');
}

function parseAmount(tokens) {
    const first = tokens[0] ?? '';
    const m = first.match(/^(\d+)(px|ppt)?$/);
    if (m) {
        const value = Number(m[1]);
        if (m[2] === 'ppt') return { amount: value / 100, unit: 'ppt' };
        if (m[2] === 'px') return { amount: value, unit: 'px' };
        // bare number — a following token may name the unit
        const unit = tokens[1]?.toLowerCase();
        if (unit === 'ppt') return { amount: value / 100, unit: 'ppt' };
        return { amount: value, unit: 'px' };
    }
    return { amount: 10, unit: 'px' };
}
