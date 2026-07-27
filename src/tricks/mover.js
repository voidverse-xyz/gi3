import GObject from 'gi://GObject';
import Direction from '../enums/direction.js';
import Settings from '../helpers/settings.js';
import * as windowHelper from '../helpers/window.js';
import * as screenHelper from '../helpers/screen.js';

export default GObject.registerClass(
    class Mover extends GObject.Object {
        _keybinds;
        _tiler;

        constructor(keybinds, tiler) {
            super();

            this._keybinds = keybinds;
            this._tiler = tiler;
            this._keybinds.registerKeybind(Settings.KEY_MOVE_RIGHT, this.moveRight.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_MOVE_LEFT, this.moveLeft.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_MOVE_UP, this.moveUp.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_MOVE_DOWN, this.moveDown.bind(this));
        }

        moveRight() {
            this._move(Direction.Right);
        }

        moveLeft() {
            this._move(Direction.Left);
        }

        moveUp() {
            this._move(Direction.Up);
        }

        moveDown() {
            this._move(Direction.Down);
        }

        _move(direction) {
            let window = windowHelper.getFocusedWindow();
            if (!window) {
                return;
            }
            // Sway-style single binding: tiled windows move within the tiling tree, floating
            // windows slide by the adjust amount.
            if (this._tiler.isWindowTiled(window.ref)) {
                this._tiler.runCommand({ type: 'move', dir: direction });
                return;
            }

            let amount = this._getWindowAdjustValue(direction);
            let workspace = window.workspace;
            let screenSize = screenHelper.getMonitorWorkArea(workspace, window.monitor);
            let windowSize = window.size;

            if (Direction.isVertical(direction)) {
                windowSize.y += amount;
            } else {
                windowSize.x += amount;
            }

            windowSize.x = windowSize.x < screenSize.x ? screenSize.x : windowSize.x;
            windowSize.y = windowSize.y < screenSize.y ? screenSize.y : windowSize.y;

            windowSize.x =
                windowSize.x + windowSize.width > screenSize.x + screenSize.width
                    ? screenSize.x + screenSize.width - windowSize.width
                    : windowSize.x;

            windowSize.y =
                windowSize.y + windowSize.height > screenSize.y + screenSize.height
                    ? screenSize.y + screenSize.height - windowSize.height
                    : windowSize.y;

            windowHelper.resizeWindow(window, windowSize);
        }

        _getWindowAdjustValue(direction) {
            let adjust = direction === Direction.Up || direction == Direction.Left ? -1 : 1;
            return this._getResizeAmount() * adjust;
        }

        _getResizeAmount() {
            return Settings.tryGetInteger(Settings.WINDOW_ADJUST_AMOUNT) ?? 5;
        }

        destroy() {
            this._keybinds.removeKeybinding(Settings.KEY_MOVE_RIGHT);
            this._keybinds.removeKeybinding(Settings.KEY_MOVE_LEFT);
            this._keybinds.removeKeybinding(Settings.KEY_MOVE_UP);
            this._keybinds.removeKeybinding(Settings.KEY_MOVE_DOWN);

            this._keybinds = null;
            this._tiler = null;
        }
    }
);
