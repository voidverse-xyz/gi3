import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Settings from '../../src/helpers/settings.js';
import { keybindTable, buildKeybindConfig, parseKeybindConfig } from '../../src/helpers/configIO.js';

// Representative accelerators for a subset of keys, covering letters, Shift/Alt/Ctrl mods,
// $mod (Super), and named keys (minus).
const ACCELS = {
    [Settings.KEY_FOCUS_LEFT]: '<Super>H',
    [Settings.KEY_FOCUS_RIGHT]: '<Super>L',
    [Settings.KEY_MOVE_UP]: '<Shift><Super>K',
    [Settings.KEY_GROW_X]: '<Alt><Super>L',
    [Settings.KEY_TILE_SPLIT_V]: '<Super>V',
    [Settings.KEY_TILE_MOVE_TO_SCRATCHPAD]: '<Shift><Super>minus',
    [Settings.KEY_TILE_TOGGLE_FULLSCREEN]: '<Super>F',
};

describe('configIO keybind import/export', () => {
    it('round-trips build -> parse for every configured key', () => {
        const text = buildKeybindConfig((key) => ACCELS[key] ?? '');
        const { bindings } = parseKeybindConfig(text);
        const got = Object.fromEntries(bindings.map((b) => [b.key, b.accelerator]));

        for (const [key, accel] of Object.entries(ACCELS)) {
            assert.equal(got[key], accel, `round-trip failed for ${key}`);
        }
        // Keys without an accelerator are not emitted, so not parsed back.
        assert.equal(bindings.length, Object.keys(ACCELS).length);
    });

    it('parses real i3-style bindsym lines onto the right settings', () => {
        const text = [
            'set $mod Mod4',
            'bindsym $mod+h focus left',
            'bindsym $mod+Shift+j move down',
            'bindsym $mod+b split h',
            'bindsym $mod+f fullscreen',
            'bindsym $mod+minus move scratchpad',
            'bindsym $mod+d exec rofi', // unsupported -> ignored
        ].join('\n');

        const { bindings } = parseKeybindConfig(text);
        const got = Object.fromEntries(bindings.map((b) => [b.key, b.accelerator]));

        assert.equal(got[Settings.KEY_FOCUS_LEFT], '<Super>H');
        assert.equal(got[Settings.KEY_MOVE_DOWN], '<Shift><Super>J');
        assert.equal(got[Settings.KEY_TILE_SPLIT_H], '<Super>B');
        assert.equal(got[Settings.KEY_TILE_TOGGLE_FULLSCREEN], '<Super>F');
        assert.equal(got[Settings.KEY_TILE_MOVE_TO_SCRATCHPAD], '<Super>minus');
        assert.equal(bindings.length, 5); // exec rofi not counted
    });

    it('every table entry has a distinct key and command', () => {
        const table = keybindTable();
        assert.equal(new Set(table.map((e) => e.key)).size, table.length);
        assert.equal(new Set(table.map((e) => e.command)).size, table.length);
    });
});
