// Pure import/export of the extension's KEYBINDS as an i3/sway-style config. Import parses
// `bindsym` lines and maps recognized commands onto this extension's keybind settings; export
// writes the current keybinds back out as a config the import side round-trips. Only keybinds
// are handled (no gaps/rules/detection). File I/O lives in prefs.js so this module stays pure
// and node-testable (no gi:// imports).

import Settings from './settings.js';
import { parseConfig } from '../tiling/config/parser.js';
import { swayComboToMutter, mutterAccelToSway } from '../tiling/keymap.js';

/**
 * The single source of truth mapping each keybind setting <-> an i3/sway command, in BOTH
 * directions: `command` is emitted on export; `match(parsedCommand)` recognizes it on import.
 * Order matters for import (first match wins) — entries are mutually exclusive here.
 * @type {Array<{key: string, command: string, match: (c: any) => boolean}>}
 */
const TABLE = [
    {
        key: Settings.KEY_FOCUS_LEFT,
        command: 'focus left',
        match: (parsedCommand) => parsedCommand.type === 'focus' && parsedCommand.dir === 'left',
    },
    {
        key: Settings.KEY_FOCUS_RIGHT,
        command: 'focus right',
        match: (parsedCommand) => parsedCommand.type === 'focus' && parsedCommand.dir === 'right',
    },
    {
        key: Settings.KEY_FOCUS_UP,
        command: 'focus up',
        match: (parsedCommand) => parsedCommand.type === 'focus' && parsedCommand.dir === 'up',
    },
    {
        key: Settings.KEY_FOCUS_DOWN,
        command: 'focus down',
        match: (parsedCommand) => parsedCommand.type === 'focus' && parsedCommand.dir === 'down',
    },
    {
        key: Settings.KEY_MOVE_LEFT,
        command: 'move left',
        match: (parsedCommand) => parsedCommand.type === 'move' && parsedCommand.dir === 'left',
    },
    {
        key: Settings.KEY_MOVE_RIGHT,
        command: 'move right',
        match: (parsedCommand) => parsedCommand.type === 'move' && parsedCommand.dir === 'right',
    },
    {
        key: Settings.KEY_MOVE_UP,
        command: 'move up',
        match: (parsedCommand) => parsedCommand.type === 'move' && parsedCommand.dir === 'up',
    },
    {
        key: Settings.KEY_MOVE_DOWN,
        command: 'move down',
        match: (parsedCommand) => parsedCommand.type === 'move' && parsedCommand.dir === 'down',
    },
    {
        key: Settings.KEY_GROW_X,
        command: 'resize grow width 5 ppt',
        match: (parsedCommand) => (
            parsedCommand.type === 'resize' &&
            parsedCommand.mode === 'grow' &&
            parsedCommand.axis === 'width'
        ),
    },
    {
        key: Settings.KEY_SHRINK_X,
        command: 'resize shrink width 5 ppt',
        match: (parsedCommand) => (
            parsedCommand.type === 'resize' &&
            parsedCommand.mode === 'shrink' &&
            parsedCommand.axis === 'width'
        ),
    },
    {
        key: Settings.KEY_GROW_Y,
        command: 'resize grow height 5 ppt',
        match: (parsedCommand) => (
            parsedCommand.type === 'resize' &&
            parsedCommand.mode === 'grow' &&
            parsedCommand.axis === 'height'
        ),
    },
    {
        key: Settings.KEY_SHRINK_Y,
        command: 'resize shrink height 5 ppt',
        match: (parsedCommand) => (
            parsedCommand.type === 'resize' &&
            parsedCommand.mode === 'shrink' &&
            parsedCommand.axis === 'height'
        ),
    },
    {
        key: Settings.KEY_TILE_SPLIT_H,
        command: 'split h',
        match: (parsedCommand) => parsedCommand.type === 'split' && parsedCommand.orientation === 'horizontal',
    },
    {
        key: Settings.KEY_TILE_SPLIT_V,
        command: 'split v',
        match: (parsedCommand) => parsedCommand.type === 'split' && parsedCommand.orientation === 'vertical',
    },
    {
        key: Settings.KEY_TILE_LAYOUT_CYCLE,
        command: 'layout toggle split',
        match: (parsedCommand) => parsedCommand.type === 'layoutToggleSplit' || parsedCommand.type === 'layout',
    },
    {
        key: Settings.KEY_TILE_FOCUS_PARENT,
        command: 'focus parent',
        match: (parsedCommand) => parsedCommand.type === 'focusParent',
    },
    {
        key: Settings.KEY_TILE_FOCUS_CHILD,
        command: 'focus child',
        match: (parsedCommand) => parsedCommand.type === 'focusChild',
    },
    {
        key: Settings.KEY_TILE_TOGGLE_FLOATING,
        command: 'floating toggle',
        match: (parsedCommand) => parsedCommand.type === 'floatingToggle',
    },
    {
        key: Settings.KEY_TILE_TOGGLE_FULLSCREEN,
        command: 'fullscreen',
        match: (parsedCommand) => parsedCommand.type === 'fullscreen',
    },
    {
        key: Settings.KEY_TILE_MOVE_TO_WORKSPACE_NEXT,
        command: 'move container to workspace next',
        match: (parsedCommand) => parsedCommand.type === 'moveToWorkspace' && parsedCommand.workspace === 'next',
    },
    {
        key: Settings.KEY_TILE_MOVE_TO_WORKSPACE_PREV,
        command: 'move container to workspace prev',
        match: (parsedCommand) => parsedCommand.type === 'moveToWorkspace' && parsedCommand.workspace === 'prev',
    },
    {
        key: Settings.KEY_TILE_MOVE_TO_SCRATCHPAD,
        command: 'move scratchpad',
        match: (parsedCommand) => parsedCommand.type === 'moveScratchpad',
    },
    {
        key: Settings.KEY_TILE_TOGGLE_SCRATCHPAD,
        command: 'scratchpad show',
        match: (parsedCommand) => parsedCommand.type === 'scratchpadShow',
    },
];

export function keybindTable() {
    return TABLE;
}

/**
 * Parse an i3/sway config text into recognized keybinds. Pure — no settings I/O.
 * @param {string} text
 * @returns {{bindings: Array<{key: string, accelerator: string}>}}
 */
export function parseKeybindConfig(text) {
    const bindings = [];
    for (const binding of parseConfig(text).bindings) {
        if (binding.command.type === 'nop') {
            continue;
        }
        const entry = TABLE.find((candidate) => candidate.match(binding.command));
        const accelerator = entry ? swayComboToMutter(binding.combo) : null;
        if (entry && accelerator) {
            bindings.push({ key: entry.key, accelerator });
        }
    }
    return { bindings };
}

/**
 * Build an i3/sway config text from the extension's current keybinds. Pure — takes a getter.
 * @param {(settingKey: string) => string} getAccel
 * @returns {string}
 */
export function buildKeybindConfig(getAccel) {
    const lines = [
        '# gi3 keybindings (i3/sway style) — re-importable from the extension prefs.',
        'set $mod Mod4',
        '',
    ];
    for (const entry of TABLE) {
        const accel = getAccel(entry.key);
        const combo = accel ? mutterAccelToSway(accel) : null;
        if (combo) {
            lines.push(`bindsym ${combo} ${entry.command}`);
        }
    }
    return lines.join('\n') + '\n';
}
