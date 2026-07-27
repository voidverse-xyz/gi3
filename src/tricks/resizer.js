import GObject from 'gi://GObject';
import Settings from '../helpers/settings.js';
import * as windowHelper from '../helpers/window.js';
import * as screenHelper from '../helpers/screen.js';

export default GObject.registerClass(
    class Resizer extends GObject.Object {
        _keybinds;
        _tiler;

        constructor(keybinds, tiler) {
            super();

            this._keybinds = keybinds;
            this._tiler = tiler;
            this._keybinds.registerKeybind(Settings.KEY_GROW_X, this.growX.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_GROW_Y, this.growY.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_SHRINK_X, this.shrinkX.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_SHRINK_Y, this.shrinkY.bind(this));
        }

        shrinkX() {
            this._resize(false, false);
        }

        shrinkY() {
            this._resize(false, true);
        }

        growX() {
            this._resize(true, false);
        }

        growY() {
            this._resize(true, true);
        }

        _resize(grow, vertical) {
            let window = windowHelper.getFocusedWindow();
            if (!window) {
                return;
            }
            // Sway-style single binding: resize the tiling split for tiled windows, or the
            // floating frame otherwise. 0.05 = a 5% step of the parent container.
            if (this._tiler.isWindowTiled(window.ref)) {
                this._tiler.runCommand({
                    type: 'resize',
                    mode: grow ? 'grow' : 'shrink',
                    axis: vertical ? 'height' : 'width',
                    amount: 0.05,
                    unit: 'ppt',
                });
                return;
            }

            let workspace = window.workspace;
            let windowSize = window.size;
            let screenSize = screenHelper.getMonitorWorkArea(workspace, window.monitor);

            let amount = this._getResizeAmount() * 10 * (grow ? 1 : -1);

            if (vertical) {
                windowSize.height += amount;
            } else {
                windowSize.width += amount;
            }

            let windowWidth = windowSize.x + windowSize.width;
            let screenWidth = screenSize.x + screenSize.width;

            let windowHeight = windowSize.y + windowSize.height;
            let screenHeight = screenSize.y + screenSize.height;

            if (windowWidth > screenWidth) {
                windowSize.width -= windowWidth - screenWidth;
            }

            if (windowHeight > screenHeight) {
                windowSize.height -= windowHeight - screenHeight;
            }

            windowHelper.resizeWindow(window, windowSize);
        }

        _getResizeAmount() {
            return Settings.tryGetInteger(Settings.WINDOW_ADJUST_AMOUNT) ?? 5;
        }

        destroy() {
            this._keybinds.removeKeybinding(Settings.KEY_GROW_X);
            this._keybinds.removeKeybinding(Settings.KEY_GROW_Y);
            this._keybinds.removeKeybinding(Settings.KEY_SHRINK_X);
            this._keybinds.removeKeybinding(Settings.KEY_SHRINK_Y);

            this._keybinds = null;
            this._tiler = null;
        }
    }
);
