import GObject from 'gi://GObject';
import Settings from '../helpers/settings.js';
import Direction from '../enums/direction.js';
import * as windowHelper from '../helpers/window.js';

export default GObject.registerClass(
    class Switcher extends GObject.Object {
        _keybinds;
        _tiler;

        constructor(keybinds, tiler) {
            super();

            this._keybinds = keybinds;
            this._tiler = tiler;
            this._keybinds.registerKeybind(Settings.KEY_SWITCH_RIGHT, this.switchRight.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_SWITCH_LEFT, this.switchLeft.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_SWITCH_UP, this.switchUp.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_SWITCH_DOWN, this.switchDown.bind(this));
        }

        switchRight() {
            this._switch(Direction.Right);
        }

        switchLeft() {
            this._switch(Direction.Left);
        }

        switchUp() {
            this._switch(Direction.Up);
        }

        switchDown() {
            this._switch(Direction.Down);
        }

        _switch(direction) {
            let window = windowHelper.getFocusedWindow();
            if (!window || this._tiler.isWindowTiled(window.ref)) {
                return;
            }

            let windows = windowHelper.getNearbyWindows(window, direction, { crossMonitor: true });
            if (windows.length === 0) {
                return;
            }

            let otherWindow = windows[0];
            if (this._tiler.isWindowTiled(otherWindow.ref)) {
                return;
            }

            let windowSize = window.size;
            let otherWindowSize = otherWindow.size;

            if (this._getKeepOriginalSize()) {
                this._switchSizes(direction, windowSize, otherWindowSize);
            } else {
                [windowSize, otherWindowSize] = [otherWindowSize, windowSize];
            }

            windowHelper.resizeWindow(window, windowSize);
            windowHelper.resizeWindow(otherWindow, otherWindowSize);
        }

        _switchSizes(direction, sizeA, sizeB) {
            if (direction === Direction.Right || direction === Direction.Down) {
                [sizeA, sizeB] = [sizeB, sizeA];
            }

            if (Direction.isVertical(direction)) {
                [sizeA.y, sizeB.y] = [sizeB.y, sizeA.y]
            } else {
                [sizeA.x, sizeB.x] = [sizeB.x, sizeA.x]
            }
        }

        _getKeepOriginalSize() {
            return Settings.tryGetBoolean(Settings.ORIGINAL_SIZE_MODE) ?? true;
        }

        destroy() {
            this._keybinds.removeKeybinding(Settings.KEY_SWITCH_RIGHT);
            this._keybinds.removeKeybinding(Settings.KEY_SWITCH_LEFT);
            this._keybinds.removeKeybinding(Settings.KEY_SWITCH_UP);
            this._keybinds.removeKeybinding(Settings.KEY_SWITCH_DOWN);

            this._keybinds = null;
            this._tiler = null;
        }
    }
);
