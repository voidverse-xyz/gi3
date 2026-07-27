import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GObject from 'gi://GObject';
import Settings from './settings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default GObject.registerClass(
    class Keybinds extends GObject.Object {
        _keys;
        _settings;

        constructor() {
            super();

            this._keys = [];
            this._settings = Settings.reference;
        }

        _setupKeyBinds(settingKey, callback) {
            Main.wm.addKeybinding(
                settingKey,
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                (callback).bind(this)
            );
        }

        registerKeybind(settingKey, callback) {
            this._keys.push(settingKey);
            this._setupKeyBinds(settingKey, callback);
        }

        removeKeybinding(key) {
            Main.wm.removeKeybinding(key);
        }

        destroy() {
            for (let key of this._keys) {
                Main.wm.removeKeybinding(key);
            }
            this._keys =[];
        }
    }
);