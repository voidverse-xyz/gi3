import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Settings from '../helpers/settings.js';
import * as Main from "resource:///org/gnome/shell/ui/main.js"

export default GObject.registerClass(
    class AppTray extends GObject.Object {
        _keybinds;
        _tracker;

        _tray;
        _desktopSignal;
        _workspaceSignal;
        _windowLeftSignal;
        _windowFocusSignal;
        _windowEnteredSignal;
        _windowCreatedSignal;
        _windowAttentionSignal;

        constructor(keybinds) {
            super();

            this._keybinds = keybinds;

            this._workspaceSingals = [];
            this._tray = new St.BoxLayout();
            this._tracker = Shell.WindowTracker.get_default();

            this._windowLeftSignal = global.display.connect('window-left-monitor', this._render.bind(this));
            this._windowFocusSignal = global.display.connect('notify::focus-window', this._render.bind(this));
            this._windowEnteredSignal = global.display.connect('window-entered-monitor', this._render.bind(this));
            this._windowCreatedSignal = global.display.connect('window-created', this._render.bind(this));
            this._windowAttentionSignal = global.display.connect('window-demands-attention', this._render.bind(this));
            this._desktopSignal = global.workspace_manager.connect("showing-desktop-changed", this._render.bind(this));
            this._workspaceSignal = global.workspace_manager.connect("active-workspace-changed", this._render.bind(this));

            Main.panel._leftBox.add_child(this._tray);

            this._render();
        }

        _render() {
            this._tray.destroy_all_children()

            let layout = new St.BoxLayout();

            let workspaceId = global.workspace_manager.get_active_workspace_index();
            let workspaceCount = global.workspace_manager.get_n_workspaces();
            // One MRU walk for all workspaces — get_tab_list filters the global window list,
            // and _render runs on hot signals (every focus change), so per-workspace calls add up.
            let mru = global.display.get_tab_list(Meta.TabList.NORMAL, null);
            for (let id = 0; id < workspaceCount; id++) {
                let isActive = id === workspaceId;
                this._addAppIcon(id, layout, isActive, mru);
            }

            this._tray.add_child(layout);
        }

        _addAppIcon(workspaceId, layout, isActive, mru) {
            let workspaceName = (workspaceId + 1).toString();
            let workspace = global.workspace_manager.get_workspace_by_index(workspaceId)
            let windows = workspace.list_windows();
            if (windows.length === 0) {
                return;
            }

            // A fixed layout lets non-leading icons overlap by explicit positioning. (CSS
            // negative margins on panel actors blank the whole top bar — St allocates a
            // negative width and cogl bails on the 0-size viewport.)
            let iconLayout = new St.Widget({
                layout_manager: new Clutter.FixedLayout(),
                y_align: Clutter.ActorAlign.CENTER,
            });
            let iconApps = [];

            let label = new St.Label();
            label.set_style_class_name(`bar-app-icon`)
            label.set_text(workspaceName);
            label.set_opacity(255);

            let labelLayout = new St.BoxLayout({ y_expand: true, y_align: Clutter.ActorAlign.CENTER });
            labelLayout.add_child(label);

            let workspaceLayout = new St.BoxLayout();
            workspaceLayout.add_child(labelLayout);
            workspaceLayout.add_child(iconLayout);

            // A plain clickable button, NOT a PanelMenu.Button: the latter creates a popup
            // menu (added to Main.uiGroup) for every workspace on every re-render, which
            // _render runs on many window/focus events — those leak and eventually break the
            // panel. A workspace group only needs to activate its workspace on click.
            let button = new St.Button({
                child: workspaceLayout,
                style_class: 'panel-button',
                can_focus: true,
                track_hover: true,
            });
            if (isActive) {
                button.add_style_pseudo_class('checked');
            }
            button.connect('clicked', () => {
                workspace.activate(global.get_current_time());
            });

            layout.add_child(button);

            // Keep every workspace's apps visible. Order each stack by recency so its
            // leading icon still identifies the last-used app after the workspace becomes
            // inactive; windows absent from the normal tab list remain visible at the end.
            let remainingWindows = new Set(windows);
            let iconWindows = [];
            for (let window of mru) {
                if (!remainingWindows.delete(window)) {
                    continue;
                }

                iconWindows.push(window);
            }
            iconWindows.push(...remainingWindows);

            let size = this._getAppIconSize();
            // Each non-leading icon advances by ~half a width, so they overlap into a stack.
            let step = Math.max(1, Math.round(size * 0.55));
            let addedCount = 0;
            let icons = [];
            for (let window of iconWindows) {
                let app = this._tracker.get_window_app(window);
                if (!app || iconApps.includes(app.get_name())) {
                    continue;
                }

                iconApps.push(app.get_name());

                let icon = app.create_icon_texture(size);
                if (!icon) {
                    continue;
                }
                icon.set_style_class_name(`bar-app-icon`)

                // Every workspace uses the same compact stack; active state is conveyed by
                // the workspace button rather than by hiding inactive-workspace icons.
                icon.set_position(addedCount * step, 0);
                icon.set_opacity(255);

                iconLayout.add_child(icon);
                icons.push(icon);
                addedCount++;
            }

            // Z-order: the leading (left) icon sits on top and each icon to its right drops one
            // layer below the previous, so the right-most icon is at the very bottom of the stack.
            for (let i = 1; i < icons.length; i++) {
                iconLayout.set_child_below_sibling(icons[i], icons[i - 1]);
            }
        }

        _getAppIconSize() {
            return Settings.tryGetInteger(Settings.APP_TRAY_ICON_SIZE) ?? 20;
        }

        destroy() {
            Main.panel._leftBox.remove_child(this._tray);

            this._tray.destroy_all_children()

            global.workspace_manager.disconnect(this._desktopSignal);
            global.workspace_manager.disconnect(this._workspaceSignal);
            global.display.disconnect(this._windowLeftSignal);
            global.display.disconnect(this._windowFocusSignal);
            global.display.disconnect(this._windowEnteredSignal);
            global.display.disconnect(this._windowCreatedSignal);
            global.display.disconnect(this._windowAttentionSignal);

            this._tray = null;
            this._tracker = null;
            this._keybinds = null;
            this._desktopSignal = null;
            this._workspaceSignal = null;
            this._windowLeftSignal = null;
            this._windowFocusSignal = null;
            this._windowEnteredSignal = null;
            this._windowCreatedSignal = null;
            this._windowAttentionSignal = null;
        }
    }
);
