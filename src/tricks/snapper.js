import GObject from 'gi://GObject';
import Direction from '../enums/direction.js';
import Settings from '../helpers/settings.js';
import * as windowHelper from '../helpers/window.js';
import * as screenHelper from '../helpers/screen.js';
import { snapStop } from '../helpers/geometry.js';

export default GObject.registerClass(
    class Snapper extends GObject.Object {
        _keybinds;
        _tiler;

        constructor(keybinds, tiler) {
            super();

            this._keybinds = keybinds;
            this._tiler = tiler;
            this._keybinds.registerKeybind(Settings.KEY_SNAP_RIGHT, this.snapRight.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_SNAP_LEFT, this.snapLeft.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_SNAP_UP, this.snapUp.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_SNAP_DOWN, this.snapDown.bind(this));
        }

        snapRight() {
            this._snap(Direction.Right);
        }

        snapLeft() {
            this._snap(Direction.Left);
        }

        snapUp() {
            this._snap(Direction.Up);
        }

        snapDown() {
            this._snap(Direction.Down);
        }

        _snap(direction) {
            let window = windowHelper.getFocusedWindow();
            if (!window || this._tiler.isWindowTiled(window.ref)) {
                return;
            }

            let workArea = screenHelper.getMonitorWorkArea(window.workspace, window.monitor);
            let obstacles = windowHelper
                .getWindowsInWorkspace(window.workspace, window.monitor)
                .filter((other) => other.ref !== window.ref)
                .map((other) => other.size);

            let target = snapStop(direction, window.size, workArea, obstacles);
            if (!target) {
                return;
            }

            let size = window.size;
            size.x = target.x;
            size.y = target.y;
            windowHelper.resizeWindow(window, size);
        }

        destroy() {
            this._keybinds.removeKeybinding(Settings.KEY_SNAP_RIGHT);
            this._keybinds.removeKeybinding(Settings.KEY_SNAP_LEFT);
            this._keybinds.removeKeybinding(Settings.KEY_SNAP_UP);
            this._keybinds.removeKeybinding(Settings.KEY_SNAP_DOWN);

            this._keybinds = null;
            this._tiler = null;
        }
    }
);
