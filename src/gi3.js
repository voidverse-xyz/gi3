import GObject from 'gi://GObject';
import AppTray from './tricks/apptray.js';
import Centerer from './tricks/centerer.js'
import Clipboard from './tricks/clipboard.js'
import Focuser from './tricks/focuser.js'
import Mover from './tricks/mover.js';
import Resizer from './tricks/resizer.js';
import Snapper from './tricks/snapper.js';
import Switcher from './tricks/switcher.js'
import Tiler from './tricks/tiler.js';
import TileMode from './tricks/tilemode.js';
import ScratchpadIndicator from './tricks/scratchpad.js';
import { SysMonIndicator, TempsIndicator } from './tricks/sysmon.js';
import Settings from './helpers/settings.js';

export default GObject.registerClass(
    class Gi3 extends GObject.Object {
        _keybinds;

        _app;
        _centerer;
        _clipboard;
        _focuser;
        _mover;
        _resizer;
        _snapper;
        _switcher;
        _tiler;
        _tileMode;
        _scratchpadIndicator;
        _sysmon;
        _temps;

        constructor(keybinds, tilerSessionState = null) {
            super()

            this._keybinds = keybinds;

            this._tiler = new Tiler(this._keybinds, tilerSessionState);

            // Right-box top-bar indicators, leftmost first; the running position keeps the
            // group packed left of GNOME's system indicators whichever ones are enabled.
            let panelPosition = 0;
            if (this._getShowSysmon()) {
                this._sysmon = new SysMonIndicator(panelPosition++);
            }
            if (this._getShowTemps()) {
                this._temps = new TempsIndicator(panelPosition++);
            }
            this._tileMode = new TileMode(this._keybinds, this._tiler, panelPosition++);

            this._centerer = new Centerer(this._keybinds, this._tiler);
            this._focuser = new Focuser(this._keybinds, this._tiler);
            this._mover = new Mover(this._keybinds, this._tiler);
            this._resizer = new Resizer(this._keybinds, this._tiler);
            this._snapper = new Snapper(this._keybinds, this._tiler);
            this._switcher = new Switcher(this._keybinds, this._tiler);

            if(this._getShowClipboard()){
                this._clipboard = new Clipboard(this._keybinds, panelPosition++);
            }

            if(this._getShowAppTray()){
                this._app = new AppTray(this._keybinds);
            }

            // Create this after the app tray so it occupies the right edge of the left box.
            this._scratchpadIndicator = new ScratchpadIndicator(this._tiler);
        }

        snapshotTilingState() {
            return this._tiler?.snapshotSessionState() ?? null;
        }

        _getShowSysmon() {
            return Settings.tryGetBoolean(Settings.SYSMON_STATE) ?? true;
        }

        _getShowTemps() {
            return Settings.tryGetBoolean(Settings.TEMPS_STATE) ?? true;
        }

        _getShowClipboard() {
            return Settings.tryGetBoolean(Settings.CLIPBOARD_STATE) ?? true;
        }

        _getShowAppTray() {
            return Settings.tryGetBoolean(Settings.APP_TRAY_STATE) ?? true;
        }

        destroy() {
            this._keybinds = null;

            this._app?.destroy();
            this._centerer?.destroy();
            this._clipboard?.destroy();
            this._focuser?.destroy();
            this._mover?.destroy();
            this._resizer?.destroy();
            this._snapper?.destroy();
            this._switcher?.destroy();
            this._sysmon?.destroy();
            this._temps?.destroy();
            this._scratchpadIndicator?.destroy();
            this._tileMode?.destroy();
            this._tiler?.destroy();
        }
    }
);
