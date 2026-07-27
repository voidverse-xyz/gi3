# Dev environment (Fedora GNOME Wayland in podman)

`pod.sh` is an experimental harness for running gi3 inside
`ghcr.io/schneegans/gnome-shell-pod-41` with a nested GNOME Wayland session.

> **Current status:** this harness is incomplete. `pod.sh start` and `pod.sh install`
> expect a `package.sh dev` mode and development D-Bus integration that are not present.
> The commands below describe the intended interface and are not currently operational.

```sh
./dev/pod.sh start          # boot container + session, install + enable the extension
./dev/pod.sh install        # repackage ./src, reinstall, restart the session
./dev/pod.sh app gnome-terminal --window   # launch a Wayland client in the session
./dev/pod.sh key super+t    # send a keystroke (xdotool → Xvfb → nested compositor)
./dev/pod.sh shot NAME      # screenshot → dev/shots/NAME.png (in-compositor capture)
./dev/pod.sh windows        # JSON dump of every window's frame rect/focus/minimized
./dev/pod.sh log            # grep the journal for gjs/extension errors
./dev/pod.sh stop
```

Notes:
- `shot` uses GNOME's own `gnome-screenshot -f` inside the pod. It owns the
  allow-listed `org.gnome.Screenshot` bus name, so the compositor's
  ScreenshotService accepts it (a raw `gdbus` call to `org.gnome.Shell.Screenshot`
  is refused `AccessDenied`) and it returns a full, correct frame. The Xvfb
  framebuffer path (`/opt/Xvfb_screen0`) drops rows under the nested session, so
  `shot` falls back to it only if gnome-screenshot fails.
- `dev/devdbus.js` defines the intended in-process window inspection and manipulation
  interface (`ListWindows`, `Activate`, `MoveResize`, and `Minimize`). The release
  extension does not import or export this interface, and the current schema has no
  setting to enable it. The `windows` command therefore remains unavailable until the
  development packaging and integration path is restored.
- The container needs `--shm-size=2g` and Xvfb needs `-extension MIT-SHM`
  (a systemd drop-in `start` installs) or llvmpipe can't present and the
  screen stays black.
- `systemctl --user set-environment WAYLAND_DISPLAY=wayland-0 ...` is required so
  D-Bus-activated apps (gnome-terminal-server) can find the nested compositor.
- Keystrokes reach the session because the nested compositor is an X client of
  Xvfb `:99`; `tiling-mode` persists in dconf across session restarts — check
  `gsettings get ... tiling-mode` before assuming Super+T turned it on.
