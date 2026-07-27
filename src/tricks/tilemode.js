import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Settings from '../helpers/settings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// Symbolic icons for the top-bar status indicator (all ship with Adwaita/gnome-shell).
// The split icon is view-dual (a frame divided into two side-by-side panes); for a vertical
// split we rotate that same glyph 90° so it reads as two stacked (top/bottom) panes — a clean
// matched pair. Free mode uses a big single square that fills the icon box.
// (The scratchpad has its own indicator — see scratchpad.js.)
const ICON_TILING = 'view-dual-symbolic';        // two panes (rotated for vertical)
const ICON_FREE = 'checkbox-symbolic';           // one big single pane/square

/** Top-bar tiling/floating status indicator, toggling tiling mode on click or hotkey. */
export default GObject.registerClass(
    class TileMode extends GObject.Object {
        _keybinds;
        _tiler;
        _indicator;
        _icon;
        _modeChangedSignal;

        constructor(keybinds, tiler, position) {
            super();

            this._keybinds = keybinds;
            this._tiler = tiler;

            this._indicator = new PanelMenu.Button(0.0, 'Tiling Mode', false);
            let box = new St.BoxLayout({
                style_class: 'panel-status-indicators-box',
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._icon = new St.Icon({
                style_class: 'system-status-icon',
                y_align: Clutter.ActorAlign.CENTER,
            });
            box.add_child(this._icon);
            this._indicator.add_child(box);
            this._refresh();
            this._indicator.connect('button-press-event', this._toggle.bind(this));

            // gi3's indicators sit as a group at the left edge of the right box, before
            // GNOME's system indicators; gi3.js hands each one its position in the group.
            Main.panel.addToStatusArea('gi3-tile-mode', this._indicator, position, 'right');

            this._tiler.onStateChanged(this._refresh.bind(this));
            this._keybinds.registerKeybind(Settings.KEY_TILE_TOGGLE_MODE, this._toggle.bind(this));
            this._modeChangedSignal = Settings.reference.connect(
                `changed::${Settings.TILING_MODE}`,
                this._refresh.bind(this)
            );
        }

        _toggle() {
            this._tiler.setEnabled(!this._tiler.isEnabled());
            // Don't rely solely on the changed::tiling-mode GSettings signal here — it
            // round-trips through dconf and can lag, leaving the indicator stale right
            // after the very click/keybind that changed it.
            this._refresh();
        }

        _refresh() {
            if (!this._icon) {
                return; // destroyed; a late tiler notification can still fire
            }
            // Rotate the split glyph 90° for a vertical split; keep it upright otherwise.
            this._icon.set_pivot_point(0.5, 0.5);
            if (!this._tiler.isEnabled()) {
                this._icon.set_icon_name(ICON_FREE);
                this._icon.rotation_angle_z = 0;
                this._indicator.set_accessible_name('Floating');
            } else {
                let orientation = this._tiler.currentSplitOrientation();
                this._icon.set_icon_name(ICON_TILING);
                if (orientation === 'vertical') {
                    this._icon.rotation_angle_z = 90;
                    this._indicator.set_accessible_name('Tiling (vertical split)');
                } else {
                    this._icon.rotation_angle_z = 0;
                    this._indicator.set_accessible_name(
                        orientation === 'horizontal' ? 'Tiling (horizontal split)' : 'Tiling');
                }
            }
        }

        destroy() {
            this._keybinds.removeKeybinding(Settings.KEY_TILE_TOGGLE_MODE);
            Settings.reference?.disconnect(this._modeChangedSignal);
            this._indicator.destroy();

            this._keybinds = null;
            this._tiler = null;
            this._indicator = null;
            this._icon = null;
            this._modeChangedSignal = null;
        }
    }
);
