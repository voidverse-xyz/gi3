// Translates a Sway key combo (e.g. `Mod4+shift+h`) into a GNOME accelerator string
// (e.g. `<Super><Shift>H`), for importing bindsym combos into this extension's own settings.

const MODIFIERS = {
    mod4: 'Super',
    mod1: 'Alt',
    super: 'Super',
    logo: 'Super',
    meta: 'Super',
    shift: 'Shift',
    ctrl: 'Control',
    control: 'Control',
    alt: 'Alt',
};

const KEYNAMES = {
    return: 'Return',
    enter: 'Return',
    space: 'space',
    escape: 'Escape',
    esc: 'Escape',
    tab: 'Tab',
    backspace: 'BackSpace',
    delete: 'Delete',
    insert: 'Insert',
    minus: 'minus',
    plus: 'plus',
    equal: 'equal',
    bracketright: 'bracketright',
    bracketleft: 'bracketleft',
    comma: 'comma',
    period: 'period',
    slash: 'slash',
    backslash: 'backslash',
    semicolon: 'semicolon',
    apostrophe: 'apostrophe',
    grave: 'grave',
    print: 'Print',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    home: 'Home',
    end: 'End',
    prior: 'Page_Up',
    pageup: 'Page_Up',
    next: 'Page_Down',
    pagedown: 'Page_Down',
};

// Canonical modifier order + spelling matching this extension's gschema defaults
// (e.g. <Shift><Ctrl><Alt><Super>). GNOME compares by mask so order is cosmetic, but keeping it
// canonical makes imports match hand-written defaults and closes the export→import round-trip.
const MOD_ORDER = [
    ['Shift', '<Shift>'],
    ['Control', '<Ctrl>'],
    ['Alt', '<Alt>'],
    ['Super', '<Super>'],
];

/** @param {string} combo @returns {string|null} */
export function swayComboToMutter(combo) {
    const parts = combo.split('+').filter((p) => p.length > 0);
    if (parts.length === 0) return null;

    const mods = new Set();
    for (let i = 0; i < parts.length - 1; i++) {
        const m = MODIFIERS[parts[i].toLowerCase()];
        if (!m) return null;
        mods.add(m);
    }

    const key = translateKey(parts[parts.length - 1]);
    if (!key) return null;

    const prefix = MOD_ORDER.filter(([m]) => mods.has(m)).map(([, s]) => s).join('');
    return prefix + key;
}

function translateKey(part) {
    const lower = part.toLowerCase();
    if (KEYNAMES[lower]) return KEYNAMES[lower];
    if (/^f([1-9]|1[0-2])$/.test(lower)) return 'F' + lower.slice(1);
    if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
    if (/^[0-9]$/.test(part)) return part;
    return null;
}

// The reverse: a GNOME accelerator (`<Super><Shift>H`) -> an i3/sway combo (`$mod+Shift+h`),
// for EXPORTING this extension's bindings back to a config the import side can round-trip.
// Super is emitted as $mod (the exported config defines `set $mod Mod4`).

/** @param {string} accel @returns {string|null} */
export function mutterAccelToSway(accel) {
    if (!accel) return null;

    let rest = accel;
    const mods = [];
    const modRe = /^<([A-Za-z0-9]+)>/;
    let m;
    while ((m = rest.match(modRe))) {
        mods.push(m[1]);
        rest = rest.slice(m[0].length);
    }

    const key = mutterKeyToSway(rest);
    if (!key) return null;

    const out = [];
    if (mods.includes('Super')) out.push('$mod');
    for (const mod of mods) {
        if (mod === 'Super') continue;
        if (mod === 'Shift' && !out.includes('Shift')) out.push('Shift');
        else if ((mod === 'Control' || mod === 'Primary' || mod === 'Ctrl') && !out.includes('Ctrl')) out.push('Ctrl');
        else if ((mod === 'Alt' || mod === 'Mod1') && !out.includes('Mod1')) out.push('Mod1');
    }
    out.push(key);
    return out.join('+');
}

function mutterKeyToSway(key) {
    if (!key) return null;
    // Names sway/i3 spell differently from GNOME's keysyms (their lowercase must be a key our
    // swayComboToMutter accepts, so the round-trip closes).
    if (key === 'Page_Up') return 'Prior';
    if (key === 'Page_Down') return 'Next';
    if (/^[A-Z]$/.test(key)) return key.toLowerCase(); // single letter -> lowercase
    // digits, F-keys and named symbols (minus, space, Return, Up, …) already round-trip as-is.
    return key;
}
