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
const S = Settings;
const TABLE = [
    { key: S.KEY_FOCUS_LEFT, command: 'focus left', match: (c) => c.type === 'focus' && c.dir === 'left' },
    { key: S.KEY_FOCUS_RIGHT, command: 'focus right', match: (c) => c.type === 'focus' && c.dir === 'right' },
    { key: S.KEY_FOCUS_UP, command: 'focus up', match: (c) => c.type === 'focus' && c.dir === 'up' },
    { key: S.KEY_FOCUS_DOWN, command: 'focus down', match: (c) => c.type === 'focus' && c.dir === 'down' },

    { key: S.KEY_MOVE_LEFT, command: 'move left', match: (c) => c.type === 'move' && c.dir === 'left' },
    { key: S.KEY_MOVE_RIGHT, command: 'move right', match: (c) => c.type === 'move' && c.dir === 'right' },
    { key: S.KEY_MOVE_UP, command: 'move up', match: (c) => c.type === 'move' && c.dir === 'up' },
    { key: S.KEY_MOVE_DOWN, command: 'move down', match: (c) => c.type === 'move' && c.dir === 'down' },

    { key: S.KEY_GROW_X, command: 'resize grow width 5 ppt', match: (c) => c.type === 'resize' && c.mode === 'grow' && c.axis === 'width' },
    { key: S.KEY_SHRINK_X, command: 'resize shrink width 5 ppt', match: (c) => c.type === 'resize' && c.mode === 'shrink' && c.axis === 'width' },
    { key: S.KEY_GROW_Y, command: 'resize grow height 5 ppt', match: (c) => c.type === 'resize' && c.mode === 'grow' && c.axis === 'height' },
    { key: S.KEY_SHRINK_Y, command: 'resize shrink height 5 ppt', match: (c) => c.type === 'resize' && c.mode === 'shrink' && c.axis === 'height' },

    { key: S.KEY_TILE_SPLIT_H, command: 'split h', match: (c) => c.type === 'split' && c.orientation === 'horizontal' },
    { key: S.KEY_TILE_SPLIT_V, command: 'split v', match: (c) => c.type === 'split' && c.orientation === 'vertical' },
    { key: S.KEY_TILE_LAYOUT_CYCLE, command: 'layout toggle split', match: (c) => c.type === 'layoutToggleSplit' || c.type === 'layout' },
    { key: S.KEY_TILE_FOCUS_PARENT, command: 'focus parent', match: (c) => c.type === 'focusParent' },
    { key: S.KEY_TILE_FOCUS_CHILD, command: 'focus child', match: (c) => c.type === 'focusChild' },
    { key: S.KEY_TILE_TOGGLE_FLOATING, command: 'floating toggle', match: (c) => c.type === 'floatingToggle' },
    { key: S.KEY_TILE_TOGGLE_FULLSCREEN, command: 'fullscreen', match: (c) => c.type === 'fullscreen' },
    { key: S.KEY_TILE_MOVE_TO_WORKSPACE_NEXT, command: 'move container to workspace next', match: (c) => c.type === 'moveToWorkspace' && c.workspace === 'next' },
    { key: S.KEY_TILE_MOVE_TO_WORKSPACE_PREV, command: 'move container to workspace prev', match: (c) => c.type === 'moveToWorkspace' && c.workspace === 'prev' },
    { key: S.KEY_TILE_MOVE_TO_SCRATCHPAD, command: 'move scratchpad', match: (c) => c.type === 'moveScratchpad' },
    { key: S.KEY_TILE_TOGGLE_SCRATCHPAD, command: 'scratchpad show', match: (c) => c.type === 'scratchpadShow' },
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
        const entry = TABLE.find((e) => e.match(binding.command));
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
