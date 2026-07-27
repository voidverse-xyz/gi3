export default class Settings {
    static _settings;

    static ORIGINAL_SIZE_MODE = "original-size-mode";
    static WINDOW_ADJUST_AMOUNT = 'window-adjust-amount';
    static CLIPBOARD_STATE = 'clipboard-state';
    static APP_TRAY_STATE = 'app-tray-state';
    static SYSMON_STATE = 'sysmon-state';
    static TEMPS_STATE = 'temps-state';
    static APP_TRAY_ICON_SIZE = 'app-tray-icon-size';

    static TILING_MODE = 'tiling-mode';
    static TILING_WORKSPACE_MODES = 'tiling-workspace-modes';
    static TILING_WARP_POINTER = 'tiling-warp-pointer';
    static TILING_GAPS_INNER = 'tiling-gaps-inner';
    static TILING_GAPS_OUTER = 'tiling-gaps-outer';
    static TILING_DEFAULT_LAYOUT = 'tiling-default-layout';
    static TILING_RULES_JSON = 'tiling-rules-json';
    static SCRATCHPAD_VISIBLE = 'scratchpad-visible';
    static TILING_OVERRIDDEN_STATE = 'tiling-overridden-state';
    static KEYBIND_OVERRIDDEN_STATE = 'keybind-overridden-state';
    static TILING_RESTORE_APP_SIZE = 'tiling-restore-app-size';

    static KEY_CLIPBOARD = "clipboard-hotkey";
    static KEY_CENTER_WINDOW = "center-window-hotkey";
    static KEY_CENTER_WINDOWS = "center-windows-hotkey";
    static KEY_CENTER_WORKSPACE = "center-workspace-hotkey";
    static KEY_SWITCH_RIGHT = "switch-right-hotkey";
    static KEY_SWITCH_LEFT = "switch-left-hotkey";
    static KEY_SWITCH_UP = "switch-up-hotkey";
    static KEY_SWITCH_DOWN = "switch-down-hotkey";
    static KEY_SNAP_RIGHT = "snap-right-hotkey";
    static KEY_SNAP_LEFT = "snap-left-hotkey";
    static KEY_SNAP_UP = "snap-up-hotkey";
    static KEY_SNAP_DOWN = "snap-down-hotkey";
    static KEY_MOVE_RIGHT = "move-right-hotkey";
    static KEY_MOVE_LEFT = "move-left-hotkey";
    static KEY_MOVE_UP = "move-up-hotkey";
    static KEY_MOVE_DOWN = "move-down-hotkey";
    static KEY_SHRINK_X = "shrink-x-hotkey";
    static KEY_SHRINK_Y = "shrink-y-hotkey";
    static KEY_GROW_X = "grow-x-hotkey";
    static KEY_GROW_Y = "grow-y-hotkey";
    static KEY_FOCUS_RIGHT = "focus-right-hotkey";
    static KEY_FOCUS_LEFT = "focus-left-hotkey";
    static KEY_FOCUS_UP = "focus-up-hotkey";
    static KEY_FOCUS_DOWN = "focus-down-hotkey";

    static KEY_TILE_SPLIT_H = "tile-split-h-hotkey";
    static KEY_TILE_SPLIT_V = "tile-split-v-hotkey";
    static KEY_TILE_LAYOUT_CYCLE = "tile-layout-cycle-hotkey";
    static KEY_TILE_MOVE_RIGHT = "tile-move-right-hotkey";
    static KEY_TILE_MOVE_LEFT = "tile-move-left-hotkey";
    static KEY_TILE_MOVE_UP = "tile-move-up-hotkey";
    static KEY_TILE_MOVE_DOWN = "tile-move-down-hotkey";
    static KEY_TILE_FOCUS_RIGHT = "tile-focus-right-hotkey";
    static KEY_TILE_FOCUS_LEFT = "tile-focus-left-hotkey";
    static KEY_TILE_FOCUS_UP = "tile-focus-up-hotkey";
    static KEY_TILE_FOCUS_DOWN = "tile-focus-down-hotkey";
    static KEY_TILE_FOCUS_PARENT = "tile-focus-parent-hotkey";
    static KEY_TILE_FOCUS_CHILD = "tile-focus-child-hotkey";
    static KEY_TILE_TOGGLE_FLOATING = "tile-toggle-floating-hotkey";
    static KEY_TILE_TOGGLE_FULLSCREEN = "tile-toggle-fullscreen-hotkey";
    static KEY_TILE_MOVE_TO_WORKSPACE_NEXT = "tile-move-to-workspace-next-hotkey";
    static KEY_TILE_MOVE_TO_WORKSPACE_PREV = "tile-move-to-workspace-prev-hotkey";
    static KEY_TILE_GAP_INCREASE = "tile-gap-increase-hotkey";
    static KEY_TILE_GAP_DECREASE = "tile-gap-decrease-hotkey";
    static KEY_TILE_TOGGLE_MODE = "tile-toggle-mode-hotkey";
    static KEY_TILE_MOVE_TO_SCRATCHPAD = "tile-move-to-scratchpad-hotkey";
    static KEY_TILE_TOGGLE_SCRATCHPAD = "tile-toggle-scratchpad-hotkey";
    static KEY_TILE_CYCLE_SCRATCHPAD = "tile-cycle-scratchpad-hotkey";

    static get reference() {
        return this._settings;
    }

    static initialize(settings) {
        this._settings = settings;
    }

    static resetKeyBinds() {
        for (let key of Object.keys(this)) {
            if (key.startsWith("KEY_")) {
                this._settings.reset(this[key]);
            }
        }
    }

    static tryGetBoolean(key){
        if (!this._settings)
            return null;

        try{
            return this._settings.get_boolean(key);
        }catch{
            return null;
        }
    }

    static tryGetInteger(key){
         if (!this._settings)
            return null;

        try{
            return this._settings.get_uint(key);
        }catch{
            return null;
        }
    }

    static tryGetString(key) {
        if (!this._settings)
            return null;

        try{
            return this._settings.get_string(key);
        }catch{
            return null;
        }
    }

    /** Parse a JSON-holding string setting; null on empty/missing/corrupt. */
    static tryGetJson(key) {
        const raw = this.tryGetString(key);
        if (!raw)
            return null;

        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    static setBoolean(key, value) {
        return (this._settings?.set_boolean(key, value) ?? false);
    }

    static setInteger(key, value) {
        return (this._settings?.set_uint(key, value) ?? false);
    }

    static setString(key, value) {
        return (this._settings?.set_string(key, value) ?? false);
    }

    static getKeyBind(key) {
        return (this._settings?.get_strv(key)[0] ?? '');
    }

    static setKeyBind(key, keybind) {
        return (this._settings?.set_strv(key, [keybind]) ?? false);
    }

    static bind(key, object, property, flags) {
        this._settings?.bind(key, object, property, flags);
    }

    static destroy() {
        this._settings = null;
    }

}