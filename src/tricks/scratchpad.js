import St from 'gi://St';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Settings from '../helpers/settings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const OPACITY_MUTED = 110;
const OPACITY_SHOWN = 255;

/** Top-bar scratchpad indicator. The scratchpad is global (one stash for every
 *  workspace), so unlike the per-workspace tile-mode indicator it gets its own button:
 *  hidden while the scratchpad is empty, muted while all members are stashed, full
 *  opacity while one is shown. Clicking it runs `scratchpad show` (toggle/cycle). */
export default GObject.registerClass(
    class ScratchpadIndicator extends GObject.Object {
        _tiler;
        _tracker;
        _indicator;
        _iconLayout;
        _iconsKey;

        constructor(tiler) {
            super();

            this._tiler = tiler;
            this._tracker = Shell.WindowTracker.get_default();

            this._indicator = new PanelMenu.Button(0.0, 'Scratchpad', false);
            this._iconLayout = new St.Widget({
                layout_manager: new Clutter.FixedLayout(),
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._indicator.add_child(this._iconLayout);
            this._indicator.connect('button-press-event', () =>
                this._tiler.runCommand({ type: 'scratchpadShow' })
            );

            let position = Main.panel._leftBox.get_n_children();
            Main.panel.addToStatusArea('gi3-scratchpad', this._indicator, position, 'left');

            this._tiler.onStateChanged(this._refresh.bind(this));
            this._refresh();
        }

        _refresh() {
            if (!this._indicator) {
                return; // destroyed; a late tiler notification can still fire
            }

            let count = this._tiler.scratchpadCount();
            let shown = this._tiler.isScratchpadVisible();
            this._indicator.visible = count > 0;
            this._renderIcons(this._tiler.scratchpadWindows());
            this._iconLayout.opacity = shown ? OPACITY_SHOWN : OPACITY_MUTED;
            this._indicator.set_accessible_name(
                shown ? 'Scratchpad (a window is shown)' : `Scratchpad (${count} stashed)`
            );
        }

        _renderIcons(windows) {
            let size = Settings.tryGetInteger(Settings.APP_TRAY_ICON_SIZE) ?? 20;
            let appIds = new Set();
            let apps = [];

            for (let window of windows) {
                let app = this._tracker.get_window_app(window);
                let appId = app?.get_id();
                if (!app || !appId || appIds.has(appId)) {
                    continue;
                }

                appIds.add(appId);
                apps.push(app);
            }

            let key = `${size}\n${apps.map((app) => app.get_id()).join('\n')}`;
            if (key === this._iconsKey) {
                return;
            }
            this._iconsKey = key;
            this._iconLayout.destroy_all_children();

            let step = Math.max(1, Math.round(size * 0.55));
            let icons = [];
            for (let app of apps) {
                let icon = app.create_icon_texture(size);
                if (!icon) {
                    continue;
                }

                icon.set_style_class_name('bar-app-icon');
                icon.set_position(icons.length * step, 0);
                this._iconLayout.add_child(icon);
                icons.push(icon);
            }

            if (icons.length === 0) {
                let icon = new St.Icon({
                    icon_name: 'application-x-executable-symbolic',
                    icon_size: size,
                    style_class: 'bar-app-icon',
                });
                this._iconLayout.add_child(icon);
                icons.push(icon);
            }

            // Match the app tray stack: the leading icon stays on top of later icons.
            for (let i = 1; i < icons.length; i++) {
                this._iconLayout.set_child_below_sibling(icons[i], icons[i - 1]);
            }
        }

        destroy() {
            this._indicator.destroy();
            this._indicator = null;
            this._iconLayout = null;
            this._iconsKey = null;
            this._tracker = null;
            this._tiler = null;
        }
    }
);
