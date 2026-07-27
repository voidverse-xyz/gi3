import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';
import Settings from './settings.js';

// Meta.Laters scheduling (GNOME 44+). RESIZE for geometry work, IDLE for focus/activation,
// so we never mutate window geometry or focus from inside a Mutter signal dispatch.
export function laterAdd(laterType, callback) {
    return global.compositor.get_laters().add(laterType, callback);
}

export function laterRemove(id) {
    global.compositor.get_laters().remove(id);
}

export const LaterType = {
    RESIZE: Meta.LaterType.RESIZE,
    IDLE: Meta.LaterType.IDLE,
};

// Matches GNOME Shell's own window animation time.
export const ANIMATION_TIME_MS = 250;

export function animationsEnabled() {
    return St.Settings.get().enable_animations;
}

/**
 * Visually slide an actor into its (already committed) frame position from where it was
 * before the move. Only the actor's translation is animated — the real frame geometry has
 * already landed, so this never feeds back into Mutter's layout. PaperWM's principle of
 * "animate the texture, commit the frame at rest", inverted for a static tiler: commit
 * first, then let the pixels catch up.
 */
export function slideActorFrom(actor, dx, dy) {
    if (!animationsEnabled() || (dx === 0 && dy === 0)) {
        return;
    }
    actor.remove_transition('translation-x');
    actor.remove_transition('translation-y');
    actor.translation_x = dx;
    actor.translation_y = dy;
    actor.ease({
        translation_x: 0,
        translation_y: 0,
        duration: ANIMATION_TIME_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

/** Fade an actor in (used to reveal new windows only after they sit in their slot). */
export function fadeActorIn(actor) {
    actor.remove_transition('opacity');
    if (!animationsEnabled()) {
        actor.opacity = 255;
        return;
    }
    actor.ease({
        opacity: 255,
        duration: ANIMATION_TIME_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

/** Undo any in-flight visual effects (extension disable, window untrack). */
export function resetActorEffects(actor) {
    actor.remove_transition('translation-x');
    actor.remove_transition('translation-y');
    actor.remove_transition('opacity');
    actor.translation_x = 0;
    actor.translation_y = 0;
    actor.opacity = 255;
}

// GNOME's own global shortcuts that collide with the sway-style default keybinds. Every bare
// <Super>+key the defaults claim was checked against the live keybinding schemas; these four
// are the only collisions. They split by WHEN they must yield to us:
//
// ALWAYS (whole extension lifetime) — these keys drive DIRECTIONAL FOCUS, which works in both
// free and tiling mode (the focuser falls back to geometric focus when the window is floating),
// so GNOME must never shadow them or "focus left" would just minimise the window:
//   <Super>h -> minimize                     (focus/move left)
//   <Super>l -> screensaver (lock screen)    (focus/move right)
const ALWAYS_KEYBINDINGS = [
    ['org.gnome.desktop.wm.keybindings', 'minimize'],
    ['org.gnome.settings-daemon.plugins.media-keys', 'screensaver'],
];
// TILING ONLY (current workspace tiling) — these back tiling-only commands, so on a free
// workspace GNOME keeps them:
//   <Super>a -> toggle application view      (focus parent)
//   <Super>v -> toggle message tray          (split vertical)
const TILING_KEYBINDINGS = [
    ['org.gnome.shell.keybindings', 'toggle-application-view'],
    ['org.gnome.shell.keybindings', 'toggle-message-tray'],
];
// Mutter features that fight the tiler specifically — only disabled while a workspace tiles.
const TILING_MUTTER_FLAGS = ['edge-tiling', 'attach-modal-dialogs'];

/**
 * GNOME features that fight a manual tiler (PaperWM disables the same set via gsettings
 * rather than trying to intercept them). Originals are backed up when the features are
 * disabled and restored when tiling mode turns off or the extension unloads.
 *
 * The backup is persisted in the extension's own settings (not just in-memory) so it
 * survives an unclean shutdown: if gnome-shell is killed while the GNOME keys are cleared,
 * a naive re-capture on the next enable would record the *cleared* ([]) values as the
 * "originals" and lose them forever. With a persisted backup, re-enabling sees the backup
 * already exists and only re-asserts the cleared state without recapturing.
 */
export class ConflictingShellFeatures {
    constructor() {
        this._mutter = new Gio.Settings({ schema_id: 'org.gnome.mutter' });
        this._keybindSettings = new Map();
    }

    _settingsFor(schemaId) {
        if (!this._keybindSettings.has(schemaId)) {
            this._keybindSettings.set(schemaId, new Gio.Settings({ schema_id: schemaId }));
        }
        return this._keybindSettings.get(schemaId);
    }

    // NB: the backup format ({mutter, keybinds:[{schemaId,key,value}]}) is also read by the
    // prefs-side conflicts page (helpers/keybindConflicts.js, which cannot import this module
    // because it must not load Meta/Clutter/St in the prefs process) — change both together.
    _readBackup(backupKey) {
        return Settings.tryGetJson(backupKey);
    }

    _applyCleared(keybindings, mutterFlags) {
        for (const flag of mutterFlags) {
            this._mutter.set_boolean(flag, false);
        }
        for (const [schemaId, key] of keybindings) {
            this._settingsFor(schemaId).set_strv(key, []);
        }
    }

    _clear(keybindings, mutterFlags, backupKey) {
        // Backup already present (fresh call within this session, or a prior unclean shutdown):
        // don't recapture — the live values may already be our cleared markers.
        if (this._readBackup(backupKey)) {
            this._applyCleared(keybindings, mutterFlags);
            return;
        }
        const state = {
            mutter: mutterFlags.map((flag) => ({ flag, value: this._mutter.get_boolean(flag) })),
            keybinds: keybindings.map(([schemaId, key]) => ({
                schemaId,
                key,
                value: this._settingsFor(schemaId).get_strv(key),
            })),
        };
        Settings.setString(backupKey, JSON.stringify(state));
        this._applyCleared(keybindings, mutterFlags);
    }

    _unclear(backupKey) {
        const state = this._readBackup(backupKey);
        if (!state) {
            return;
        }
        for (const { flag, value } of state.mutter ?? []) {
            this._mutter.set_boolean(flag, value);
        }
        for (const { schemaId, key, value } of state.keybinds ?? []) {
            this._settingsFor(schemaId).set_strv(key, value);
        }
        Settings.setString(backupKey, '');
    }

    /** Clear the GNOME shortcuts that drive directional focus (both modes). Call once on load. */
    enableAlways() {
        this._clear(ALWAYS_KEYBINDINGS, [], Settings.KEYBIND_OVERRIDDEN_STATE);
    }

    /** Clear the tiler-specific GNOME shortcuts + mutter flags (while a workspace tiles). */
    enableTiling() {
        this._clear(TILING_KEYBINDINGS, TILING_MUTTER_FLAGS, Settings.TILING_OVERRIDDEN_STATE);
    }

    disableTiling() {
        this._unclear(Settings.TILING_OVERRIDDEN_STATE);
    }

    destroy() {
        this._unclear(Settings.TILING_OVERRIDDEN_STATE);
        this._unclear(Settings.KEYBIND_OVERRIDDEN_STATE);
        this._mutter = null;
        this._keybindSettings = null;
    }
}
