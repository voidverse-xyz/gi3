# License and third-party notices

## gi3

Unless otherwise noted below, gi3 is distributed under the GNU General Public License, version 3 only (`GPL-3.0-only`). See [`LICENSE`](LICENSE).

The project icon and documentation screenshots are original gi3 assets and are distributed under the same license.

## PaperWM

gi3's Mutter integration uses window-management techniques informed by PaperWM.

- Project: [PaperWM](https://github.com/paperwm/PaperWM)
- License: GNU General Public License, version 3
- License text: [`licenses/paperwm/LICENSE`](licenses/paperwm/LICENSE)

PaperWM's contributors retain copyright in their contributions.

## vKeyBind

gi3 includes code adapted from vKeyBind in 2026. Adapted areas include the preferences UI, settings and keybinding helpers, direction model, window helpers, free-window operations, and GSettings schema.

- Project: [vKeyBind](https://github.com/00000vish/vKeyBind)
- Upstream license: GNU General Public License, version 3
- License text: [`licenses/vkeybind/LICENSE`](licenses/vkeybind/LICENSE)
- Principal local files: `src/prefs.js`, `src/enums/direction.js`, `src/helpers/{keybinds,screen,settings,window}.js`, `src/tricks/{centerer,focuser,mover,resizer,snapper,switcher}.js`, and `src/schemas/org.gnome.shell.extensions.gi3.gschema.xml`

vKeyBind's contributors retain copyright in their contributions. The adapted code has been modified for gi3.

## Tiling Shell

gi3 includes preferences-interface code and tiling patterns adapted from Tiling Shell in 2026.

- Project: [Tiling Shell](https://github.com/domferr/tilingshell)
- Copyright: Copyright (C) 2025 Domenico Ferraro
- Upstream license: GNU General Public License, version 3 or later (`GPL-3.0-or-later`)
- License text: [`licenses/tiling-shell/LICENSE`](licenses/tiling-shell/LICENSE)
- Principal local file: `src/prefs.js`

The adapted code has been modified for gi3.

## GNOME Control Center

The shortcut validation routines in `src/prefs.js` are adapted from GNOME Control Center's `panels/keyboard/keyboard-shortcuts.c`, through Tiling Shell, and were modified for gi3 in 2026.

- Project: [GNOME Control Center](https://gitlab.gnome.org/GNOME/gnome-control-center)
- Source file: [`panels/keyboard/keyboard-shortcuts.c`](https://gitlab.gnome.org/GNOME/gnome-control-center/-/blob/main/panels/keyboard/keyboard-shortcuts.c)
- Copyright: Copyright (C) 2010 Intel, Inc
- Copyright: Copyright (C) 2014 Red Hat, Inc
- Upstream license: GNU General Public License, version 2 or later (`GPL-2.0-or-later`)
- License text: [`licenses/gnome-control-center/COPYING`](licenses/gnome-control-center/COPYING)

The adapted routines are distributed as part of gi3 under GPL version 3, as permitted by their GPL-2.0-or-later terms.
