#!/bin/bash
# Dev harness: run gi3 inside a Fedora GNOME (Wayland, nested) podman
# container based on ghcr.io/schneegans/gnome-shell-pod. Subcommands:
#
#   ./dev/pod.sh start        - start container + nested GNOME Wayland session
#   ./dev/pod.sh install      - (re)install the extension from ./src and restart the session
#   ./dev/pod.sh shot NAME    - capture screenshot to dev/shots/NAME.png
#   ./dev/pod.sh key KEYS     - send an xdotool keystroke (e.g. "super+ctrl+h")
#   ./dev/pod.sh exec CMD...  - run a command inside the pod as the gnomeshell user
#   ./dev/pod.sh app CMD      - launch a GUI app inside the session (async)
#   ./dev/pod.sh log          - tail gnome-shell journal (grep gi3/gjs errors)
#   ./dev/pod.sh stop         - kill the container
#
set -e

IMAGE="ghcr.io/schneegans/gnome-shell-pod-41"
NAME="wt-dev-pod"
UUID="gi3@voidverse.xyz"
SESSION="gnome-wayland-nested"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

do_in_pod() {
  podman exec --user gnomeshell --workdir /home/gnomeshell "${NAME}" set-env.sh "$@"
}

cmd_start() {
  if podman ps --format '{{.Names}}' | grep -q "^${NAME}$"; then
    echo "Pod already running."
  else
    podman run --rm --name "${NAME}" --cap-add=SYS_NICE --cap-add=IPC_LOCK --shm-size=2g -td "${IMAGE}"
    echo "Waiting for D-Bus..."
    sleep 5
  fi
  do_in_pod gsettings set org.gnome.shell welcome-dialog-last-shown-version "999" || true
  # cmd_shot needs gnome-screenshot (owns the allow-listed org.gnome.Screenshot bus name);
  # the image doesn't ship it, and the raw Xvfb-framebuffer fallback drops the bottom rows.
  podman exec "${NAME}" dnf install -y gnome-screenshot >/dev/null 2>&1 || true
  # MESA in the nested session fails to attach X11 SHM segments and renders BLACK frames
  # unless Xvfb runs with MIT-SHM disabled; the image's xvfb@.service doesn't do that, so
  # install a drop-in and restart the display (must happen before the session starts).
  podman exec "${NAME}" bash -c 'mkdir -p /etc/systemd/system/xvfb@.service.d && printf "[Service]\nExecStart=\nExecStart=Xvfb %%I \$XVFB_SCREENS -fbdir \${XVFB_FBDIR} -extension MIT-SHM\n" > /etc/systemd/system/xvfb@.service.d/no-mitshm.conf && systemctl daemon-reload && systemctl restart "xvfb@:99"'
  sleep 2
  cmd_install
}

cmd_install() {
  # Dev build (real dev D-Bus surface overlaid onto the stub) via the shared packager.
  "${DIR}/package.sh" dev
  podman cp "${DIR}/gi3.zip" "${NAME}:/home/gnomeshell/${UUID}.zip"

  do_in_pod systemctl --user stop "${SESSION}@:99" 2>/dev/null || true
  sleep 1
  do_in_pod gnome-extensions install --force "${UUID}.zip"
  do_in_pod systemctl --user start "${SESSION}@:99"
  echo "Waiting for GNOME Shell..."
  sleep 8
  # D-Bus-activated apps (gnome-terminal-server etc.) must see the nested compositor.
  do_in_pod systemctl --user set-environment \
    WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 DISPLAY=:99
  do_in_pod systemctl --user stop gnome-terminal-server.service 2>/dev/null || true
  do_in_pod gnome-extensions enable "${UUID}"
  # The dev/testing D-Bus surface (Screenshot/ListWindows/...) ships disabled by default;
  # turn it on for the harness only.
  do_in_pod gsettings --schemadir "/home/gnomeshell/.local/share/gnome-shell/extensions/${UUID}/schemas" \
    set org.gnome.shell.extensions.gi3 dev-dbus-enabled true || true
  sleep 2
  # Close the overview.
  cmd_key super
  sleep 2
  echo "Extension installed and enabled."
}

cmd_shot() {
  local name="${1:-shot}"
  mkdir -p "${DIR}/dev/shots"
  # Preferred: GNOME's own gnome-screenshot, which owns the allow-listed org.gnome.Screenshot
  # bus name so the compositor's ScreenshotService accepts it (a raw gdbus call to
  # org.gnome.Shell.Screenshot is refused with AccessDenied). This is a full, correct frame
  # even when the raw Xvfb framebuffer path drops rows. Fallback: raw Xvfb copy.
  if do_in_pod gnome-screenshot -f "/tmp/_shot.png" >/dev/null 2>&1; then
    podman cp "${NAME}:/tmp/_shot.png" "${DIR}/dev/shots/${name}.png"
  else
    podman cp "${NAME}:/opt/Xvfb_screen0" - | tar xf - --to-command "convert xwd:- ${DIR}/dev/shots/${name}.png" 2>/dev/null
  fi
  echo "${DIR}/dev/shots/${name}.png"
}

cmd_windows() {
  do_in_pod gdbus call --session --dest org.gnome.Shell \
    --object-path /xyz/voidverse/Gi3/Dev \
    --method xyz.voidverse.Gi3.Dev.ListWindows |
    sed -e "s/^('//" -e "s/',)$//" | sed 's/\\\\"/"/g' | python3 -m json.tool 2>/dev/null || true
}

cmd_key() {
  do_in_pod xdotool keydown "${1}"
  sleep 0.4
  do_in_pod xdotool keyup "${1}"
}

cmd_app() {
  do_in_pod bash -c "export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0; $* >/dev/null 2>&1 &" || true
}

cmd_log() {
  do_in_pod sudo journalctl --no-pager -n 200 | grep -i "gjs\|gi3\|JS ERROR" || echo "(no matches)"
}

cmd_stop() {
  podman kill "${NAME}" 2>/dev/null || true
}

case "${1}" in
  start) cmd_start ;;
  install) cmd_install ;;
  shot) shift; cmd_shot "$@" ;;
  key) shift; cmd_key "$@" ;;
  exec) shift; do_in_pod "$@" ;;
  app) shift; cmd_app "$@" ;;
  log) cmd_log ;;
  stop) cmd_stop ;;
  windows) cmd_windows ;;
  *) echo "usage: $0 start|install|shot|windows|key|exec|app|log|stop"; exit 1 ;;
esac
