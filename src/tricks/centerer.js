import GObject from 'gi://GObject';
import Settings from '../helpers/settings.js';
import * as windowHelper from '../helpers/window.js';
import * as screenHelper from '../helpers/screen.js';

export default GObject.registerClass(
    class Centerer extends GObject.Object {
        _keybinds;
        _tiler;

        constructor(keybinds, tiler) {
            super();

            this._keybinds = keybinds;
            this._tiler = tiler;
            this._keybinds.registerKeybind(Settings.KEY_CENTER_WINDOW, this.centerWindow.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_CENTER_WINDOWS, this.centerAllWindows.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_CENTER_WORKSPACE, this.centerWorkspace.bind(this));
        }

        centerWindow() {
            let window = windowHelper.getFocusedWindow();
            if (!window || this._tiler.isWindowTiled(window.ref)) {
                return;
            }

            let screen = screenHelper.getMonitorWorkArea(window.workspace, window.monitor);
            let screenX = screen.x + (screen.width / 2) - (window.size.width / 2);
            let screenY = screen.y + (screen.height / 2) - (window.size.height / 2);

            window.size.x = screenX;
            window.size.y = screenY;

            windowHelper.resizeWindow(window, window.size);
        }

        centerAllWindows() {
            let window = windowHelper.getFocusedWindow();
            if (!window || this._tiler.isWindowTiled(window.ref)) {
                return;
            }

            let workspace = window.workspace;

            let screenSize = screenHelper.getMonitorWorkArea(workspace, window.monitor);
            let windows = windowHelper.getWindowsInWorkspace(workspace, window.monitor);

            windows = windows.sort(this._sortWindow);

            let initialWidth = 0;
            let initialHeight = 0;

            let maxWidth = windows.reduce((sum, currentWindow) => sum + currentWindow.size.width, initialWidth);

            let maxHeight = windows.reduce((max, currentWindow) => {
                return max > currentWindow.size.height ? max : currentWindow.size.height;
            }, initialHeight);

            let windowX = screenSize.x + screenSize.width / 2 - maxWidth / 2;
            let windowY = screenSize.y + screenSize.height / 2 - maxHeight / 2;

            if (screenSize.width < maxWidth) {
                return;
            }

            for (let window of windows) {
                window.size.x = windowX;
                window.size.y = windowY;

                windowHelper.resizeWindow(window, window.size);

                windowX += window.size.width;
            }
        }

        centerWorkspace() {
            let window = windowHelper.getFocusedWindow();
            if (!window || this._tiler.isWindowTiled(window.ref)) {
                return;
            }

            let workspace = window.workspace;
            let screen = screenHelper.getMonitorWorkArea(workspace, window.monitor);
            let windows = windowHelper.getWindowsInWorkspace(workspace, window.monitor);

            if (windows.length == 0) {
                return;
            }

            let windowSizesX = windows.flatMap((x) => [x.size.x, x.size.x + x.size.width]);
            let windowSizesY = windows.flatMap((x) => [x.size.y, x.size.y + x.size.height]);

            let windowGrid = this._getWindowGridSize(windowSizesX, windowSizesY);

            let screenCenterX = screen.x + screen.width / 2;
            let screenCenterY = screen.y + screen.height / 2;

            let windowCenterX = windowGrid.x + windowGrid.width / 2;
            let windowCenterY = windowGrid.y + windowGrid.height / 2;

            let offsetX = screenCenterX - windowCenterX;
            let offsetY = screenCenterY - windowCenterY;

            for (let window of windows) {
                window.size.x += offsetX;
                window.size.y += offsetY;

                windowHelper.resizeWindow(window, window.size);
            }
        }

        _sortWindow(windowA, windowB) {
            return windowA.size.y - windowB.size.y + (windowA.size.x - windowB.size.x);
        }

        _getWindowGridSize(valuesX, valuesY) {
            let sortedValuesX = valuesX.sort((a, b) => a - b);
            let sortedValuesY = valuesY.sort((a, b) => a - b);

            let minX = sortedValuesX[0];
            let maxX = sortedValuesX[valuesX.length - 1];

            let minY = sortedValuesY[0];
            let maxY = sortedValuesY[valuesY.length - 1];

            return {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
            };
        }

        destroy() {
            this._keybinds.removeKeybinding(Settings.KEY_CENTER_WINDOW);
            this._keybinds.removeKeybinding(Settings.KEY_CENTER_WINDOWS);
            this._keybinds.removeKeybinding(Settings.KEY_CENTER_WORKSPACE);

            this._keybinds = null;
            this._tiler = null;
        }
    }
);
