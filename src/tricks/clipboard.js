import St from 'gi://St';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Settings from '../helpers/settings.js';
import { updateMenuScrollHeight } from '../helpers/menu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Safety cap so runaway copying can't grow the history without bound. The menu itself scrolls,
// so this is only a memory backstop, well above any practical history depth.
const HISTORY_CAP = 500;

export default GObject.registerClass(
    class ClipboardManager extends PanelMenu.Button {
        // NB: no class field declarations. In a GObject subclass that sets up in _init(), bare
        // field initializers run AFTER _init and would reset every field (e.g. _clipboard) back
        // to undefined — which silently broke clipboard capture.

        _init(keybinds, position) {
            // 0.5 = the menu's arrow points at the CENTRE of the icon, so it opens directly
            // under it (0.0 anchored it to the icon's left edge and shoved it to the screen edge).
            super._init(0.5, 'Clipboard');

            this._lastItem = null;
            this._copyItems = [];
            this._keybinds = keybinds;
            this._clipboard = St.Clipboard.get_default();

            this._icon = new St.Icon({
                icon_name: 'edit-paste-symbolic',
                style_class: 'system-status-icon',
            });
            this.add_child(this._icon);

            this.menu.box.add_style_class_name('clipboard-menu');
            this._buildMenu();

            this._keybinds.registerKeybind(Settings.KEY_CLIPBOARD, () => this.menu.toggle());
            this._startMonitoring();

            // Positioned by gi3.js within the indicator group, before GNOME's system icons.
            Main.panel.addToStatusArea('gi3-clipboard', this, position, 'right');
        }

        _buildMenu() {
            // Header — pinned above the scrolling list.
            let header = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
            header.add_style_class_name('clipboard-header');

            let title = new St.Label({
                text: 'Clipboard',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-title',
            });
            header.add_child(title);

            this._countLabel = new St.Label({
                text: '0',
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-count',
            });
            header.add_child(this._countLabel);

            this._clearButton = new St.Button({
                style_class: 'clipboard-icon-button',
                child: new St.Icon({ icon_name: 'user-trash-symbolic', icon_size: 16 }),
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._clearButton.connect('clicked', () => this._clearAll());
            header.add_child(this._clearButton);

            this.menu.addMenuItem(header);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            // Scrollable list of entries — grows to a capped height then scrolls.
            this._itemSection = new PopupMenu.PopupMenuSection();
            this._itemScroll = new St.ScrollView({ x_expand: true });
            this._itemScroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
            if (this._itemScroll.set_child) {
                this._itemScroll.set_child(this._itemSection.actor);
            } else {
                this._itemScroll.add_actor(this._itemSection.actor);
            }
            updateMenuScrollHeight(this._itemScroll);
            this.menu.box.add_child(this._itemScroll);

            // Rebuilding the row actors is O(history) inside the compositor, so it's deferred
            // while the menu is closed: history changes just mark dirty (and update the cheap
            // header bits), and the list is rebuilt once on open.
            this._itemsDirty = false;
            this.menu.connect('open-state-changed', (_menu, open) => {
                if (!open) {
                    return;
                }

                updateMenuScrollHeight(this._itemScroll);
                if (this._itemsDirty) {
                    this._refreshItems();
                }
            });
            this._workareasSignal = global.display.connect('workareas-changed', () => {
                if (this.menu.isOpen) {
                    updateMenuScrollHeight(this._itemScroll);
                }
            });

            this._refreshItems();
        }

        _clearAll() {
            this._copyItems = [];
            this._lastItem = null;
            this._onHistoryChanged();
        }

        _onHistoryChanged() {
            if (this.menu.isOpen) {
                this._refreshItems();
                return;
            }
            this._itemsDirty = true;
            this._countLabel.text = `${this._copyItems.length}`;
            this._clearButton.visible = this._copyItems.length > 0;
        }

        _startMonitoring() {
            // Poll the clipboard (this is what the original, working version did). St.Clipboard's
            // get_text reads the selection fine; the event-driven Meta.Selection rewrite that
            // replaced it stopped capturing copies, so it's reverted here.
            this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                this._checkClipboard();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _checkClipboard() {
            this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (_, data) => {
                this._addItem(data?.toString());
            });
        }

        _addItem(text) {
            if (!text || text.trim().length === 0 || text === this._lastItem) {
                return;
            }
            this._lastItem = text;
            this._copyItems = [text, ...this._copyItems.filter((x) => x !== text)].slice(0, HISTORY_CAP);
            this._onHistoryChanged();
        }

        _refreshItems() {
            this._itemsDirty = false;
            this._itemSection.removeAll();
            this._countLabel.text = `${this._copyItems.length}`;
            this._clearButton.visible = this._copyItems.length > 0;

            if (this._copyItems.length === 0) {
                let empty = new PopupMenu.PopupMenuItem('Clipboard is empty');
                empty.setSensitive(false);
                empty.label.add_style_class_name('clipboard-empty');
                this._itemSection.addMenuItem(empty);
                return;
            }

            this._copyItems.forEach((item, index) => this._itemSection.addMenuItem(this._buildItem(item, index)));
        }

        _buildItem(item, index) {
            let menuItem = new PopupMenu.PopupBaseMenuItem();
            menuItem.add_style_class_name('clipboard-item');

            let ordinal = new St.Label({
                text: `${index + 1}`,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-ordinal',
            });
            menuItem.add_child(ordinal);

            // Collapse whitespace/newlines so a multi-line copy shows as one tidy line, ellipsized.
            let label = new St.Label({
                text: item.replace(/\s+/g, ' ').trim(),
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'clipboard-label',
            });
            label.clutter_text.set_single_line_mode(true);
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            menuItem.add_child(label);

            let remove = new St.Button({
                style_class: 'clipboard-icon-button',
                child: new St.Icon({ icon_name: 'window-close-symbolic', icon_size: 16 }),
                y_align: Clutter.ActorAlign.CENTER,
            });
            remove.connect('clicked', () => {
                this._copyItems = this._copyItems.filter((x) => x !== item);
                if (this._copyItems.length === 0) {
                    this._lastItem = null;
                }
                this._onHistoryChanged();
            });
            menuItem.add_child(remove);

            menuItem.connect('activate', () => {
                this._clipboard.set_text(St.ClipboardType.CLIPBOARD, item);
                this._lastItem = item;
                this.menu.close();
            });

            return menuItem;
        }

        destroy() {
            if (this._timer) {
                GLib.source_remove(this._timer);
                this._timer = null;
            }
            if (this._workareasSignal) {
                global.display.disconnect(this._workareasSignal);
                this._workareasSignal = null;
            }
            this._keybinds?.removeKeybinding(Settings.KEY_CLIPBOARD);
            this._keybinds = null;
            this._lastItem = null;
            this._copyItems = null;
            this._clipboard = null;

            super.destroy();
        }
    }
);
