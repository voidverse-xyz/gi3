import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import Gi3 from './gi3.js'
import Keybinds from './helpers/keybinds.js';
import Settings from './helpers/settings.js';

export default class Gi3Extension extends Extension {
    _tricks;
    _keybinds;
    _tilerSessionState;

    enable() {
        Settings.initialize(this.getSettings());

        this._keybinds = new Keybinds();
        this._tricks = new Gi3(this._keybinds, this._tilerSessionState);
        this._tilerSessionState = null;
    }

    disable() {
        // GNOME disables extensions while the lock-screen session mode is active, then calls
        // enable() again on unlock. Preserve the pure tree before normal teardown so nested
        // splits, focus, fractions, floating windows, and the scratchpad can be rehydrated.
        this._tilerSessionState = this._tricks?.snapshotTilingState() ?? this._tilerSessionState;

        this._keybinds?.destroy();
        this._keybinds = null;

        this._tricks?.destroy();
        this._tricks = null;

        // Last: the tricks' destroy() methods disconnect their GSettings handlers through
        // Settings.reference — tearing it down first leaks every one of those handlers,
        // which then fire on destroyed instances after a lock/unlock re-enable cycle.
        Settings.destroy();
    }
}
