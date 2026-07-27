import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Development/testing D-Bus surface, exported on gnome-shell's session bus connection
// (destination org.gnome.Shell). Lets an outside harness inspect the actual frame rects
// Mutter is using and drive windows, so tiling behavior can be asserted structurally.
//
// DEV BUILDS ONLY: this file lives in dev/ and is overlaid onto helpers/devdbus.js by
// `./package.sh dev` (which dev/pod.sh uses). Release builds ship the no-op stub at
// src/helpers/devdbus.js instead — this surface is unauthenticated and must never
// reach users.
//
// Screenshots are NOT provided here: GNOME's own gnome-screenshot (which owns the
// allow-listed org.gnome.Screenshot bus name) captures the compositor frame from the
// harness without any in-shell code — re-exposing capture here would just reintroduce the
// unauthenticated screen-capture that GNOME's ScreenshotService allow-list exists to block.
//
//   gdbus call ... --method xyz.voidverse.Gi3.Dev.ListWindows

const DEV_IFACE = `
<node>
  <interface name="xyz.voidverse.Gi3.Dev">
    <method name="ListWindows">
      <arg type="s" direction="out" name="json"/>
    </method>
    <method name="Activate">
      <arg type="u" direction="in" name="windowId"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
    <method name="MoveResize">
      <arg type="u" direction="in" name="windowId"/>
      <arg type="i" direction="in" name="x"/>
      <arg type="i" direction="in" name="y"/>
      <arg type="i" direction="in" name="width"/>
      <arg type="i" direction="in" name="height"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
    <method name="Minimize">
      <arg type="u" direction="in" name="windowId"/>
      <arg type="b" direction="in" name="minimize"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
    <method name="SwitchWorkspace">
      <arg type="u" direction="in" name="index"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
    <method name="Close">
      <arg type="u" direction="in" name="windowId"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
    <method name="RunCommand">
      <arg type="s" direction="in" name="commandJson"/>
      <arg type="b" direction="out" name="ok"/>
    </method>
  </interface>
</node>`;

export default class DevDbus {
    constructor(tiler = null) {
        this._tiler = tiler;
        this._dbus = Gio.DBusExportedObject.wrapJSObject(DEV_IFACE, this);
        this._dbus.export(Gio.DBus.session, '/xyz/voidverse/Gi3/Dev');
    }

    destroy() {
        this._dbus?.unexport();
        this._dbus = null;
        this._tiler = null;
    }

    /** Run a tiler Command (see tiling/engine/engine.js), e.g. '{"type":"split","orientation":"vertical"}'. */
    RunCommand(commandJson) {
        if (!this._tiler) {
            return false;
        }
        let command;
        try {
            command = JSON.parse(commandJson);
        } catch {
            return false;
        }
        if (!command || typeof command.type !== 'string') {
            return false;
        }
        this._tiler.runCommand(command);
        return true;
    }

    Activate(windowId) {
        let window = global.display.list_all_windows().find((w) => w.get_id() === windowId);
        if (!window) {
            return false;
        }
        Main.activateWindow(window);
        return true;
    }

    MoveResize(windowId, x, y, width, height) {
        let window = global.display.list_all_windows().find((w) => w.get_id() === windowId);
        if (!window) {
            return false;
        }
        window.move_resize_frame(false, x, y, width, height);
        return true;
    }

    Minimize(windowId, minimize) {
        let window = global.display.list_all_windows().find((w) => w.get_id() === windowId);
        if (!window) {
            return false;
        }
        if (minimize) window.minimize();
        else window.unminimize();
        return true;
    }

    Close(windowId) {
        let window = global.display.list_all_windows().find((w) => w.get_id() === windowId);
        if (!window) {
            return false;
        }
        window.delete(global.get_current_time());
        return true;
    }

    SwitchWorkspace(index) {
        let workspace = global.workspace_manager.get_workspace_by_index(index);
        if (!workspace) {
            return false;
        }
        workspace.activate(global.get_current_time());
        return true;
    }

    ListWindows() {
        let windows = global.display.list_all_windows().map((w) => {
            let rect = w.get_frame_rect();
            return {
                id: w.get_id(),
                title: w.get_title(),
                wmClass: w.get_wm_class(),
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                monitor: w.get_monitor(),
                workspace: w.get_workspace()?.index() ?? -1,
                minimized: w.minimized,
                fullscreen: w.is_fullscreen(),
                focused: global.display.focus_window === w,
            };
        });
        return JSON.stringify(windows);
    }
}
