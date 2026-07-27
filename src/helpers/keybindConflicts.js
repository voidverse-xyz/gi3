// Keybinding conflict detection for the preferences window (PREFS-ONLY: imports Gtk/Gdk,
// which must not be loaded in the gnome-shell process).
//
// Scans the extension's own hotkeys against GNOME's system shortcut schemas (window
// manager, Mutter, GNOME Shell, media keys, and user-defined custom shortcuts) plus the
// extension's other hotkeys, comparing *normalized* accelerators (Gtk.accelerator_parse +
// lowercased keyval, so '<Super>H', '<Super>h' and mod-order variants all collide).

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Settings from './settings.js';

/** [schemaId, human label] of the GNOME schemas that hold global shortcuts. */
const SYSTEM_SCHEMAS = [
    ['org.gnome.desktop.wm.keybindings', 'Window Manager'],
    ['org.gnome.mutter.keybindings', 'Mutter'],
    ['org.gnome.mutter.wayland.keybindings', 'Mutter (Wayland)'],
    ['org.gnome.shell.keybindings', 'GNOME Shell'],
    ['org.gnome.settings-daemon.plugins.media-keys', 'System Shortcuts'],
];

const CUSTOM_KEYBINDING_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding';

/** '<Shift><Super>h' -> 'keyval:mods' identity, or null if unparseable/empty. */
function normalize(accel) {
    if (!accel || accel === 'disabled') return null;
    const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
    if (!ok || (keyval === 0 && mods === 0)) return null;
    return `${Gdk.keyval_to_lower(keyval)}:${mods}`;
}

/** 'tile-focus-right-hotkey' -> 'Tile focus right' */
export function bindingLabel(settingKey) {
    const words = settingKey.replace(/-hotkey$/, '').replaceAll('-', ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** All of the extension's hotkey setting keys (the KEY_* constants). */
export function extensionBindingKeys() {
    return Object.keys(Settings)
        .filter((name) => name.startsWith('KEY_'))
        .map((name) => Settings[name]);
}

/** Every system shortcut as {sourceLabel, name, accel, norm}, unparseable entries dropped. */
function collectSystemBindings() {
    const out = [];
    const source = Gio.SettingsSchemaSource.get_default();

    for (const [schemaId, sourceLabel] of SYSTEM_SCHEMAS) {
        const schema = source.lookup(schemaId, true);
        if (!schema) continue;
        const settings = new Gio.Settings({ settings_schema: schema });
        for (const key of schema.list_keys()) {
            if (settings.get_value(key).get_type_string() !== 'as') continue;
            for (const accel of settings.get_strv(key)) {
                const norm = normalize(accel);
                if (norm) out.push({ sourceLabel, name: key, accel, norm });
            }
        }
    }

    // User-defined custom shortcuts live under relocatable schema paths. Constructing
    // Gio.Settings with a missing schema or malformed path is a FATAL GLib error (not a
    // catchable JS exception), so validate both before construction.
    const mediaKeys = source.lookup('org.gnome.settings-daemon.plugins.media-keys', true);
    const customSchema = source.lookup(CUSTOM_KEYBINDING_SCHEMA, true);
    if (mediaKeys && customSchema && mediaKeys.has_key('custom-keybindings')) {
        const settings = new Gio.Settings({ settings_schema: mediaKeys });
        for (const path of settings.get_strv('custom-keybindings')) {
            if (!path.startsWith('/') || !path.endsWith('/')) continue;
            try {
                const custom = new Gio.Settings({ settings_schema: customSchema, path });
                const norm = normalize(custom.get_string('binding'));
                if (norm) {
                    out.push({
                        sourceLabel: 'Custom Shortcut',
                        name: custom.get_string('name') || path,
                        accel: custom.get_string('binding'),
                        norm,
                    });
                }
            } catch (_e) {
                // Dangling path entry; ignore.
            }
        }
    }

    // The extension clears the GNOME shortcuts it takes over (minimize/screensaver always;
    // app-view/message-tray while tiling), so the live scan above sees them empty and would
    // hide those conflicts. Add them back from the persisted backups so the page still shows
    // e.g. "Super+V collides with Message Tray", flagged as already handled.
    // Backup format is owned by ConflictingShellFeatures (helpers/shellUtils.js) — kept in
    // sync by hand because shellUtils must not be imported into the prefs process.
    for (const backupKey of [Settings.KEYBIND_OVERRIDDEN_STATE, Settings.TILING_OVERRIDDEN_STATE]) {
        for (const { key, value } of Settings.tryGetJson(backupKey)?.keybinds ?? []) {
            for (const accel of value ?? []) {
                const norm = normalize(accel);
                if (norm) out.push({ sourceLabel: 'GNOME (overridden by gi3)', name: key, accel, norm });
            }
        }
    }
    return out;
}

/**
 * Compare the extension's hotkeys against system shortcuts and each other.
 *
 * @param {Gio.Settings} settings the extension's own settings
 * @returns {{conflicts: Array<{settingKey: string, label: string, accel: string,
 *            hits: Array<{sourceLabel: string, name: string, accel: string}>}>,
 *            scanned: number}}
 */
export function findConflicts(settings) {
    const system = collectSystemBindings();
    const byNorm = new Map();
    for (const b of system) {
        if (!byNorm.has(b.norm)) byNorm.set(b.norm, []);
        byNorm.get(b.norm).push(b);
    }

    // The extension's bindings, normalized (each hotkey is a strv; entries beyond the
    // first are legal in the schema, so check them all).
    const own = [];
    for (const settingKey of extensionBindingKeys()) {
        for (const accel of settings.get_strv(settingKey)) {
            const norm = normalize(accel);
            if (norm) own.push({ settingKey, label: bindingLabel(settingKey), accel, norm });
        }
    }

    const conflicts = [];
    for (const binding of own) {
        const hits = [];

        for (const hit of byNorm.get(binding.norm) ?? []) {
            hits.push({ sourceLabel: hit.sourceLabel, name: hit.name, accel: hit.accel });
        }
        for (const other of own) {
            if (other.settingKey !== binding.settingKey && other.norm === binding.norm) {
                hits.push({ sourceLabel: 'gi3', name: other.label, accel: other.accel });
            }
        }

        if (hits.length > 0) {
            conflicts.push({ settingKey: binding.settingKey, label: binding.label, accel: binding.accel, hits });
        }
    }
    return { conflicts, scanned: system.length };
}
