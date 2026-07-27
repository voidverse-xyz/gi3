import GObject from 'gi://GObject';
import Direction from '../enums/direction.js';
import Settings from '../helpers/settings.js';
import * as windowHelper from '../helpers/window.js'
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default GObject.registerClass(
    class Focuser extends GObject.Object {
        _keybinds;
        _tiler;

        constructor(keybinds, tiler) {
            super()

            this._keybinds = keybinds;
            this._tiler = tiler;
            this._keybinds.registerKeybind(Settings.KEY_FOCUS_RIGHT, this.focusRight.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_FOCUS_LEFT, this.focusLeft.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_FOCUS_UP, this.focusUp.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_FOCUS_DOWN, this.focusDown.bind(this));
        }

        focusRight() {
            this._focus(Direction.Right);
        }

        focusLeft() {
            this._focus(Direction.Left);
        }

        focusUp() {
            this._focus(Direction.Up);
        }

        focusDown() {
            this._focus(Direction.Down);
        }

        _focus(direction) {
            let window = windowHelper.getFocusedWindow();
            if (!window) {
                return;
            }
            // One key per direction, sway-style: if the focused window is tiled, drive the
            // tiling tree; otherwise fall back to geometric focus for floating windows.
            if (this._tiler.isWindowTiled(window.ref)) {
                this._tiler.runCommand({ type: 'focus', dir: direction });
                return;
            }

            let windows = windowHelper.getNearbyWindows(window, direction, { crossMonitor: true });
            if (windows.length === 0) {
                return;
            }

           windowHelper.focusWindow(windows[0]);
        }

        destroy() {
            this._keybinds.removeKeybinding(Settings.KEY_FOCUS_RIGHT);
            this._keybinds.removeKeybinding(Settings.KEY_FOCUS_LEFT);
            this._keybinds.removeKeybinding(Settings.KEY_FOCUS_UP);
            this._keybinds.removeKeybinding(Settings.KEY_FOCUS_DOWN);

            this._keybinds = null;
            this._tiler = null;
        }
    }
);