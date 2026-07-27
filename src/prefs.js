/*
 * Portions adapted from vKeyBind (GPLv3) and Tiling Shell.
 * Copyright (C) 2025 Domenico Ferraro — GPL-3.0-or-later.
 * Shortcut validation routines are adapted through Tiling Shell from GNOME Control Center.
 * Copyright (C) 2010 Intel, Inc; Copyright (C) 2014 Red Hat, Inc — GPL-2.0-or-later.
 * Modified for gi3 in 2026. See THIRD_PARTY_NOTICES.md.
 */

import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Settings from './helpers/settings.js';
import { parseKeybindConfig, buildKeybindConfig } from './helpers/configIO.js';
import { findConflicts } from './helpers/keybindConflicts.js';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class Gi3ExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        Settings.initialize(this.getSettings());

        const prefsPage = new Adw.PreferencesPage({
            name: 'general',
            title: 'General',
            iconName: 'dialog-information-symbolic',
        });

        window.add(prefsPage);

        const settingGroup = new Adw.PreferencesGroup({
            title: 'Window Settings',
            description: `Configure window settings.`,
        });
        prefsPage.add(settingGroup);

        const keepOriginalSizeSwitch = this._buildSwitchRow(
            Settings.ORIGINAL_SIZE_MODE,
            'Original size mode',
            'Keep original window size when windows are switched.',
        );
        settingGroup.add(keepOriginalSizeSwitch);

        const clipboardSwitch = this._buildSwitchRow(
            Settings.CLIPBOARD_STATE,
            'Enable clipboard history',
            'Show clipboard history indicator. Restart required.',
        );
        settingGroup.add(clipboardSwitch);

        const sysmonSwitch = this._buildSwitchRow(
            Settings.SYSMON_STATE,
            'Enable system monitor',
            'Show network, CPU/memory, and NVIDIA GPU usage in the top bar. Restart required.',
        );
        settingGroup.add(sysmonSwitch);

        const tempsSwitch = this._buildSwitchRow(
            Settings.TEMPS_STATE,
            'Enable temperature indicator',
            'Show the hottest sensor in the top bar; click it for all sensors. Restart required.',
        );
        settingGroup.add(tempsSwitch);

        const appTraySwitch = this._buildSwitchRow(
            Settings.APP_TRAY_STATE,
            'Enable app tray',
            'Show app tray indicator. Restart required.',
        );
        settingGroup.add(appTraySwitch);

        const appTrayIconSize = this._buildRangeButtonRow(
            Settings.APP_TRAY_ICON_SIZE,
            'App icon size',
            'App tray app icon size.',
        );
        settingGroup.add(appTrayIconSize);

        const windowAdjustRow = this._buildRangeButtonRow(
            Settings.WINDOW_ADJUST_AMOUNT,
            'Window adjustment',
            'Window adjustment amount.',
        );
        settingGroup.add(windowAdjustRow);

        const tilingPage = new Adw.PreferencesPage({
            name: 'tiling',
            title: 'Tiling',
            iconName: 'view-grid-symbolic',
        });
        window.add(tilingPage);

        const tilingSettingGroup = new Adw.PreferencesGroup({
            title: 'Tiling Settings',
            description: 'Configure i3/sway-style tiling.',
        });
        tilingPage.add(tilingSettingGroup);

        const tilingModeSwitch = this._buildSwitchRow(
            Settings.TILING_MODE,
            'Tile workspaces by default',
            'Default mode for workspaces you haven\'t set. Each workspace\'s mode is toggled independently from the top bar (sway-style per-workspace tiling).',
        );
        tilingSettingGroup.add(tilingModeSwitch);

        const warpPointerSwitch = this._buildSwitchRow(
            Settings.TILING_WARP_POINTER,
            'Warp pointer to focus',
            'Move the mouse pointer to the centre of the focused tiled window.',
        );
        tilingSettingGroup.add(warpPointerSwitch);

        const restoreAppSizeSwitch = this._buildSwitchRow(
            Settings.TILING_RESTORE_APP_SIZE,
            'Remember free-mode size',
            "Reopen apps at the size and location they last had in free mode, so a tiling session doesn't leave them reopening small.",
        );
        tilingSettingGroup.add(restoreAppSizeSwitch);

        const gapsInnerRow = this._buildRangeButtonRow(
            Settings.TILING_GAPS_INNER,
            'Inner gap',
            'Gap between tiled windows, in pixels.',
            0, 128,
        );
        tilingSettingGroup.add(gapsInnerRow);

        const gapsOuterRow = this._buildRangeButtonRow(
            Settings.TILING_GAPS_OUTER,
            'Outer gap',
            'Gap between tiled windows and the screen edge, in pixels.',
            0, 128,
        );
        tilingSettingGroup.add(gapsOuterRow);

        const defaultLayoutRow = this._buildComboRow(
            Settings.TILING_DEFAULT_LAYOUT,
            'Default layout',
            'Layout new tiling containers start with.',
            ['splith', 'splitv'],
        );
        tilingSettingGroup.add(defaultLayoutRow);

        this._buildKeybindsPage(window);
        this._buildConflictsPage(window);

        const footerGroup = new Adw.PreferencesGroup();
        prefsPage.add(footerGroup);

        let githubLink = `<a href="https://github.com/voidverse-xyz/gi3">GitHub</a>`;
        footerGroup.add(
            new Gtk.Label({
                label: `${this.metadata['name']} v${this.metadata['version']} · ${githubLink}`,
                useMarkup: true,
                margin_bottom: 32,
            }),
        );

        window.searchEnabled = true;
        window.connect('close-request', () => {
            if (this._conflictsChangedSignal) {
                Settings.reference?.disconnect(this._conflictsChangedSignal);
                this._conflictsChangedSignal = null;
            }
            Settings.destroy();
        });
    }

    _buildKeybindsPage(window) {
        const page = new Adw.PreferencesPage({
            name: 'keybinds',
            title: 'Keybinds',
            iconName: 'preferences-desktop-keyboard-shortcuts-symbolic',
        });
        window.add(page);

        const addGroup = (title, description, rows) => {
            const group = new Adw.PreferencesGroup({ title, description });
            for (const [key, label] of rows) {
                group.add(this._buildShortcutButtonRow(key, label));
            }
            page.add(group);
            return group;
        };

        // Clipboard.
        addGroup('Clipboard', null, [[Settings.KEY_CLIPBOARD, 'Open clipboard.']]);

        // Shared: one binding per action. The free-form focuser/mover/resizer own these keys
        // and delegate to the tiler when the focused window is tiled, so the same key acts on
        // the tiling tree in tiling mode and free-form in free mode.
        addGroup(
            'Movement — free and tiling',
            'These act on the tiling tree when the focused window is tiled, and free-form otherwise.',
            [
                [Settings.KEY_FOCUS_LEFT, 'Focus left.'],
                [Settings.KEY_FOCUS_RIGHT, 'Focus right.'],
                [Settings.KEY_FOCUS_UP, 'Focus up.'],
                [Settings.KEY_FOCUS_DOWN, 'Focus down.'],
                [Settings.KEY_MOVE_LEFT, 'Move window left.'],
                [Settings.KEY_MOVE_RIGHT, 'Move window right.'],
                [Settings.KEY_MOVE_UP, 'Move window up.'],
                [Settings.KEY_MOVE_DOWN, 'Move window down.'],
                [Settings.KEY_GROW_X, 'Grow width.'],
                [Settings.KEY_SHRINK_X, 'Shrink width.'],
                [Settings.KEY_GROW_Y, 'Grow height.'],
                [Settings.KEY_SHRINK_Y, 'Shrink height.'],
            ],
        );

        // Free mode only: no tiling analogue (they no-op while a window is tiled).
        addGroup(
            'Free mode only',
            'Directional window switching, edge snapping, and centering — used in free mode.',
            [
                [Settings.KEY_SWITCH_LEFT, 'Switch to window on the left.'],
                [Settings.KEY_SWITCH_RIGHT, 'Switch to window on the right.'],
                [Settings.KEY_SWITCH_UP, 'Switch to window above.'],
                [Settings.KEY_SWITCH_DOWN, 'Switch to window below.'],
                [Settings.KEY_SNAP_LEFT, 'Snap window left.'],
                [Settings.KEY_SNAP_RIGHT, 'Snap window right.'],
                [Settings.KEY_SNAP_UP, 'Snap window up.'],
                [Settings.KEY_SNAP_DOWN, 'Snap window down.'],
                [Settings.KEY_CENTER_WINDOW, 'Center window.'],
                [Settings.KEY_CENTER_WINDOWS, 'Center all windows.'],
                [Settings.KEY_CENTER_WORKSPACE, 'Center workspace.'],
            ],
        );

        // Tiling only.
        addGroup(
            'Tiling only',
            'Commands that only apply while tiling mode is on.',
            [
                [Settings.KEY_TILE_SPLIT_H, 'Split horizontally.'],
                [Settings.KEY_TILE_SPLIT_V, 'Split vertically.'],
                [Settings.KEY_TILE_LAYOUT_CYCLE, 'Toggle container layout (splith/splitv).'],
                [Settings.KEY_TILE_FOCUS_PARENT, 'Focus parent container.'],
                [Settings.KEY_TILE_FOCUS_CHILD, 'Focus container child.'],
                [Settings.KEY_TILE_TOGGLE_FLOATING, 'Toggle floating.'],
                [Settings.KEY_TILE_TOGGLE_FULLSCREEN, 'Toggle fullscreen.'],
                [Settings.KEY_TILE_GAP_INCREASE, 'Increase gap.'],
                [Settings.KEY_TILE_GAP_DECREASE, 'Decrease gap.'],
                [Settings.KEY_TILE_MOVE_TO_WORKSPACE_NEXT, 'Move window to next workspace.'],
                [Settings.KEY_TILE_MOVE_TO_WORKSPACE_PREV, 'Move window to previous workspace.'],
                [Settings.KEY_TILE_MOVE_TO_SCRATCHPAD, 'Move window to / from the scratchpad.'],
                [Settings.KEY_TILE_TOGGLE_SCRATCHPAD, 'Show or hide the scratchpad window.'],
                [Settings.KEY_TILE_CYCLE_SCRATCHPAD, 'Cycle directly to the next scratchpad window.'],
                [Settings.KEY_TILE_TOGGLE_MODE, 'Toggle tiling mode.'],
            ],
        );

        const configGroup = new Adw.PreferencesGroup({
            title: 'Import / Export keybinds',
            description: 'Import keybindings from an i3/sway config, or export the keybindings above as an i3/sway config you can re-import later.',
        });
        page.add(configGroup);

        const statusRow = new Adw.ActionRow({ title: 'Status', subtitle: 'Ready.' });

        configGroup.add(this._buildActionButtonRow(
            'Import keybinds',
            'Read an i3/sway config file and apply its bindsym keybindings.',
            'Import…',
            () => this._importKeybinds(window, statusRow),
        ));
        configGroup.add(this._buildActionButtonRow(
            'Export keybinds',
            'Save the current keybindings as an i3/sway-style config file.',
            'Export…',
            () => this._exportKeybinds(window, statusRow),
        ));
        configGroup.add(statusRow);

        const resetGroup = new Adw.PreferencesGroup();
        const resetButton = new Gtk.Button({
            label: 'Reset all keybinds',
            halign: Gtk.Align.CENTER,
            marginTop: 8,
        });
        resetButton.add_css_class('destructive-action');
        resetButton.connect('clicked', () => {
            Settings.resetKeyBinds();
            window.close();
        });
        resetGroup.add(resetButton);
        page.add(resetGroup);
    }

    _buildConflictsPage(window) {
        const page = new Adw.PreferencesPage({
            name: 'conflicts',
            title: 'Conflicts',
            iconName: 'dialog-warning-symbolic',
        });
        window.add(page);

        const refreshButton = new Gtk.Button({
            label: 'Refresh',
            valign: Gtk.Align.CENTER,
        });

        const group = new Adw.PreferencesGroup({
            title: 'Conflicting keybindings',
            headerSuffix: refreshButton,
        });
        page.add(group);

        let rows = [];
        const rebuild = () => {
            for (const row of rows) group.remove(row);
            rows = [];

            const { conflicts, scanned } = findConflicts(Settings.reference);
            group.set_description(
                `gi3 hotkeys that are also bound elsewhere (GNOME system shortcuts, ` +
                `custom shortcuts, or other gi3 hotkeys). ${scanned} system bindings scanned.`,
            );

            if (conflicts.length === 0) {
                const row = new Adw.ActionRow({
                    title: 'No conflicts found',
                    subtitle: 'Every gi3 hotkey is unique on this system.',
                });
                row.add_prefix(Gtk.Image.new_from_icon_name('emblem-ok-symbolic'));
                group.add(row);
                rows.push(row);
                return;
            }

            for (const conflict of conflicts) {
                const hits = conflict.hits
                    .map((hit) => `${hit.sourceLabel} · ${hit.name}`)
                    .join('\n');
                const row = new Adw.ActionRow({
                    title: conflict.label,
                    subtitle: hits,
                    subtitleLines: conflict.hits.length,
                });
                row.add_prefix(Gtk.Image.new_from_icon_name('dialog-warning-symbolic'));
                row.add_suffix(new Gtk.ShortcutLabel({
                    accelerator: conflict.accel,
                    valign: Gtk.Align.CENTER,
                }));
                group.add(row);
                rows.push(row);
            }
        };

        refreshButton.connect('clicked', rebuild);
        // Rebuild whenever a hotkey is edited on the other pages, too. The id is
        // disconnected on close-request: the Gio.Settings instance outlives this window
        // (getSettings() caches it), so a leaked handler would fire rebuild() against
        // disposed widgets from a reopened prefs dialog.
        this._conflictsChangedSignal = Settings.reference.connect('changed', (_s, key) => {
            if (key.endsWith('-hotkey')) rebuild();
        });
        rebuild();
    }

    _buildSwitchRow(settingKey, title, subtitle, suffix) {
        const gtkSwitch = new Gtk.Switch({
            vexpand: false,
            valign: Gtk.Align.CENTER,
        });

        const adwRow = new Adw.ActionRow({
            title,
            subtitle,
            activatableWidget: gtkSwitch,
        });

        if (suffix)
            adwRow.add_suffix(suffix);

        adwRow.add_suffix(gtkSwitch);

        Settings.bind(settingKey, gtkSwitch, 'active');

        return adwRow;
    }

    _buildRangeButtonRow(settingKey, title, subtitle, min = 0, max = 32) {
        const button = Gtk.SpinButton.new_with_range(min, max, 1);
        button.set_vexpand(false);
        button.set_valign(Gtk.Align.CENTER);

        const adwRow = new Adw.ActionRow({
            title,
            subtitle,
            activatableWidget: button,
        });

        adwRow.add_suffix(button);

        Settings.bind(settingKey, button, 'value');

        return adwRow;
    }

    _buildComboRow(settingKey, title, subtitle, options) {
        const model = Gtk.StringList.new(options);
        const comboRow = new Adw.ComboRow({
            title,
            subtitle,
            model,
        });

        const current = Settings.tryGetString(settingKey) ?? options[0];
        const index = options.indexOf(current);
        comboRow.set_selected(index >= 0 ? index : 0);

        comboRow.connect('notify::selected', () => {
            Settings.setString(settingKey, options[comboRow.selected]);
        });

        return comboRow;
    }

    _importKeybinds(window, statusRow) {
        const dialog = new Gtk.FileDialog({ title: 'Import i3/sway config' });
        dialog.open(window, null, (_source, result) => {
            let file;
            try {
                file = dialog.open_finish(result);
            } catch (_e) {
                return; // cancelled
            }
            if (!file) {
                return;
            }
            const path = file.get_path();
            let text = null;
            try {
                const [ok, contents] = file.load_contents(null);
                if (ok) text = new TextDecoder('utf-8').decode(contents);
            } catch (_e) {
                text = null;
            }
            if (text === null) {
                statusRow.set_subtitle(`Could not read ${path}`);
                return;
            }
            const { bindings } = parseKeybindConfig(text);
            for (const { key, accelerator } of bindings) {
                Settings.setKeyBind(key, accelerator);
            }
            statusRow.set_subtitle(`Imported ${bindings.length} keybind(s) from ${GLib.path_get_basename(path)}.`);
        });
    }

    _exportKeybinds(window, statusRow) {
        const dialog = new Gtk.FileDialog({ title: 'Export keybinds', initialName: 'gi3.conf' });
        dialog.save(window, null, (_source, result) => {
            let file;
            try {
                file = dialog.save_finish(result);
            } catch (_e) {
                return; // cancelled
            }
            if (!file) {
                return;
            }
            const path = file.get_path();
            const text = buildKeybindConfig((key) => Settings.getKeyBind(key));
            let ok = false;
            try {
                file.replace_contents(new TextEncoder().encode(text), null, false, Gio.FileCreateFlags.NONE, null);
                ok = true;
            } catch (_e) {
                ok = false;
            }
            if (!ok) {
                statusRow.set_subtitle(`Could not write ${path}`);
                return;
            }
            const count = parseKeybindConfig(text).bindings.length;
            statusRow.set_subtitle(`Exported ${count} keybind(s) to ${GLib.path_get_basename(path)}.`);
        });
    }

    _buildActionButtonRow(title, subtitle, buttonLabel, onClick) {
        const button = new Gtk.Button({
            label: buttonLabel,
            valign: Gtk.Align.CENTER,
        });
        button.connect('clicked', onClick);

        const adwRow = new Adw.ActionRow({ title, subtitle, activatableWidget: button });
        adwRow.add_suffix(button);

        return adwRow;
    }

    _buildLinkButton(label, uri) {
        const btn = new Gtk.Button({
            label,
            hexpand: false,
        });

        btn.connect('clicked', () => {
            Gtk.show_uri(null, uri, Gdk.CURRENT_TIME);
        });

        return btn;
    }

    _buildShortcutButtonRow(key, title) {
        var shortcut = Settings.getKeyBind(key);

        const btn = new KeyMapper(shortcut);
        btn.set_vexpand(false);
        btn.set_valign(Gtk.Align.CENTER);
        btn.connect('changed', (_, value) => Settings.setKeyBind(key, value.toString()));

        const adwRow = new Adw.ActionRow({
            title,
            activatableWidget: btn,
        });
        adwRow.add_suffix(btn);

        return adwRow;
    }
}

const KeyMapper = GObject.registerClass(
    {
        Properties: {
            shortcut: GObject.ParamSpec.string(
                'shortcut',
                'shortcut',
                'The shortcut',
                GObject.ParamFlags.READWRITE,
                '',
            ),
        },
        Signals: {
            changed: { param_types: [GObject.TYPE_STRING] },
        },
    },
    class KeyMapper extends Gtk.Button {
        _editor;
        _label;
        shortcut;

        constructor(value) {
            super({
                halign: Gtk.Align.CENTER,
                hexpand: false,
                vexpand: false,
                has_frame: false,
            });

            this._editor = null;
            this._label = new Gtk.ShortcutLabel({
                disabled_text: 'New accelerator…',
                valign: Gtk.Align.CENTER,
                hexpand: false,
                vexpand: false,
            });

            this.set_child(this._label);

            this.connect('clicked', this._onActivated.bind(this));
            this.shortcut = value;
            this._label.set_accelerator(this.shortcut);
            this.bind_property(
                'shortcut',
                this._label,
                'accelerator',
                GObject.BindingFlags.DEFAULT,
            );
        }

        _onActivated(widget) {
            const ctl = new Gtk.EventControllerKey();

            const content = new Adw.StatusPage({
                title: 'New accelerator…',
                icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
            });

            this._editor = new Adw.Window({
                modal: true,
                hide_on_close: true,
                transient_for: widget.get_root(),
                width_request: 480,
                height_request: 320,
                content,
            });

            this._editor.add_controller(ctl);
            ctl.connect('key-pressed', this._onKeyPressed.bind(this));
            this._editor.present();
        }

        _onKeyPressed(_widget, keyval, keycode, state) {

            let mask = state & Gtk.accelerator_get_default_mod_mask();
            mask &= ~Gdk.ModifierType.LOCK_MASK;

            if (!mask && keyval === Gdk.KEY_Escape) {
                this._editor?.close();
                return Gdk.EVENT_STOP;
            }

            if (
                !this.isValidBinding(mask, keycode, keyval) ||
                !this.isValidAccel(mask, keyval)
            )
                return Gdk.EVENT_STOP;

            if (!keyval && !keycode) {
                this._editor?.destroy();
                return Gdk.EVENT_STOP;
            } else {
                this.shortcut = Gtk.accelerator_name_with_keycode(
                    null,
                    keyval,
                    keycode,
                    mask,
                );
                this._label.set_accelerator(this.shortcut);
                this.emit('changed', this.shortcut);
            }

            this._editor?.destroy();
            return Gdk.EVENT_STOP;
        }

        // Adapted from GNOME Control Center's panels/keyboard/keyboard-shortcuts.c.
        keyvalIsForbidden(keyval) {
            return [
                Gdk.KEY_Home,
                Gdk.KEY_Left,
                Gdk.KEY_Up,
                Gdk.KEY_Right,
                Gdk.KEY_Down,
                Gdk.KEY_Page_Up,
                Gdk.KEY_Page_Down,
                Gdk.KEY_End,
                Gdk.KEY_Tab,
                Gdk.KEY_KP_Enter,
                Gdk.KEY_Return,
                Gdk.KEY_Mode_switch,
            ].includes(keyval);
        }

        isValidBinding(mask, keycode, keyval) {
            return !(
                mask === 0 ||
                (mask === Gdk.SHIFT_MASK &&
                    keycode !== 0 &&
                    ((keyval >= Gdk.KEY_a && keyval <= Gdk.KEY_z) ||
                        (keyval >= Gdk.KEY_A && keyval <= Gdk.KEY_Z) ||
                        (keyval >= Gdk.KEY_0 && keyval <= Gdk.KEY_9) ||
                        (keyval >= Gdk.KEY_kana_fullstop &&
                            keyval <= Gdk.KEY_semivoicedsound) ||
                        (keyval >= Gdk.KEY_Arabic_comma &&
                            keyval <= Gdk.KEY_Arabic_sukun) ||
                        (keyval >= Gdk.KEY_Serbian_dje &&
                            keyval <= Gdk.KEY_Cyrillic_HARDSIGN) ||
                        (keyval >= Gdk.KEY_Greek_ALPHAaccent &&
                            keyval <= Gdk.KEY_Greek_omega) ||
                        (keyval >= Gdk.KEY_hebrew_doublelowline &&
                            keyval <= Gdk.KEY_hebrew_taf) ||
                        (keyval >= Gdk.KEY_Thai_kokai &&
                            keyval <= Gdk.KEY_Thai_lekkao) ||
                        (keyval >= Gdk.KEY_Hangul_Kiyeog &&
                            keyval <= Gdk.KEY_Hangul_J_YeorinHieuh) ||
                        (keyval === Gdk.KEY_space && mask === 0) ||
                        this.keyvalIsForbidden(keyval)))
            );
        }

        isValidAccel(mask, keyval) {
            return (
                Gtk.accelerator_valid(keyval, mask) ||
                (keyval === Gdk.KEY_Tab && mask !== 0)
            );
        }
    }
);