# Project architecture

This document describes gi3's current runtime structure and the boundaries between the GNOME Shell adapter, the pure tiling engine, and supporting features.

## Runtime surfaces

- `src/extension.js` is the GNOME Shell entry point. It initializes settings and keybindings, creates the extension components, snapshots in-memory tiling state before disable, and destroys resources in dependency order.
- `src/prefs.js` runs in the separate preferences process and edits GSettings-backed options and shortcuts.
- `src/gi3.js` is the composition root. It creates the tiler first, then the panel indicators and free-window commands that depend on it.
- `src/metadata.json` declares the extension identity and supported GNOME Shell versions.
- `src/schemas/org.gnome.shell.extensions.gi3.gschema.xml` defines persistent options and accelerators.

## Tiling core

The modules under `src/tiling/engine/` are independent of GNOME Shell APIs and can run in the Node test suite:

- `tree.js` defines nested horizontal and vertical split containers, window leaves, fractions, focus history, floating windows, and fullscreen state.
- `ops.js` implements tree mutations: insertion, removal, splitting, directional focus and movement, parent/child focus, resizing, floating, and fullscreen.
- `computeLayout.js` converts a workspace tree and output rectangle into deterministic window rectangles, including gaps and floating-window clamping.
- `engine.js` owns one workspace tree, applies command objects, returns shell-level intents, renders geometry, and serializes or restores snapshots.

`src/tiling/windowMap.js` connects stable window IDs to live `Meta.Window` objects and remembers their pre-tiling rectangles.

## GNOME Shell adapter

`src/tricks/tiler.js` is the shell-facing lifecycle and policy layer. It owns one engine for each monitor/workspace pair and is responsible for:

- classifying and tracking manageable windows;
- waiting for a new window's first frame before inserting it;
- routing windows when their workspace or monitor changes;
- applying serialized window rules loaded from GSettings;
- translating engine geometry into Mutter frame operations;
- synchronizing focus and fullscreen state;
- managing the global scratchpad;
- checkpointing layout state before suspend;
- reconciling workspace renumbering and settled monitor changes; and
- restoring in-memory state after resume or a Shell disable/enable cycle.

The adapter coalesces pending layout work into a `Meta.LaterType.RESIZE` pass. Target rectangles are recorded before frame operations so size acknowledgements can be distinguished from application-initiated changes. Retries are bounded for applications that constrain their size.

## Workspace and monitor policy

Tiling mode is selected per workspace. Workspaces without an explicit override follow the default `tiling-mode` setting. `src/tricks/tilemode.js` exposes the current workspace's mode and split orientation in the panel.

Each engine is keyed by `monitorIndex:workspaceIndex` and uses the monitor's work area from `src/helpers/screen.js`. Moving a tracked window to another workspace or monitor reroutes it to the corresponding engine. Disabling tiling for a workspace restores remembered free-window geometry.

Monitor-layout changes snapshot and rehydrate engines against the current monitor and workspace routing. Unchanged suspend/resume setups preserve nested structure, split fractions, focus, floating state, and scratchpad state. If one old tree is split across multiple destinations or multiple trees collide on one destination, independently moved windows are adopted into the surviving destination layout.

## Command and layout flow

1. A registered shortcut calls `Tiler.runCommand()` directly or through a shared focus, move, or resize module.
2. The selected engine applies the command through the pure operations in `ops.js`.
3. Shell-only effects, such as closing a window or changing workspaces, are returned as intents for the adapter.
4. `computeLayout.js` renders rectangles using the current monitor work area and gap settings.
5. The adapter applies the resulting geometry in a coalesced resize phase and defers keyboard focus synchronization to the idle phase.

Dragging a tiled window to resize it updates split fractions. Dragging it to move does not reorder the tree; the next layout pass restores the tree-owned position.

## Scratchpad and state restoration

The scratchpad is a single ordered list shared by all monitors and workspaces, including free-mode workspaces. Stashing a window records its frame, removes it from its tiling engine when needed, and minimizes it. Showing or cycling restores the remembered rectangle within the active monitor's work area.

`Engine.snapshotState()` serializes the pure tree, focus, fractions, floating state, fullscreen state, and container counter. `Tiler.snapshotSessionState()` adds engine keys, original free rectangles, scratchpad ordering, visibility, and saved scratchpad rectangles. These snapshots contain plain data and are retained only for the extension's in-process disable/enable cycle; they are not persisted across a GNOME Shell process restart.

Optional per-application free-mode geometry is separate and persistent. `src/helpers/geomStore.js` stores that data under the user's XDG configuration directory.

## i3/Sway-style configuration support

The parser under `src/tiling/config/` is also independent of GNOME Shell APIs:

- `lexer.js` handles logical lines, comments, continuations, quoting, braces, and criteria spans.
- `variables.js` resolves variables from top to bottom.
- `parser.js` collects bindings, named modes, rules, gaps, borders, and floating modifiers while recording unsupported directives instead of failing.
- `commandParser.js` maps supported commands into the engine command model.
- `criteria.js` and `criteriaMatch.js` parse and evaluate supported window-rule conditions.

The preferences import/export path currently handles recognized keybindings only. `src/helpers/configIO.js` maps a finite set of commands to extension shortcut settings and translates between i3/Sway combinations and GNOME accelerators. It does not import a complete desktop configuration, named modes, layout settings, window rules, or arbitrary commands.

The runtime can apply rule objects already stored in the `tiling-rules-json` setting, but the current preferences interface does not create or import those objects.

## Other components

- `src/tricks/focuser.js`, `mover.js`, and `resizer.js` share directional shortcuts with the tiler and use free-window geometry when the focused window is not tiled.
- `src/tricks/snapper.js`, `switcher.js`, and `centerer.js` provide free-window operations.
- `src/helpers/window.js` and `geometry.js` implement monitor-aware window enumeration, directional ranking, and obstacle-aware snapping.
- `src/tricks/apptray.js`, `clipboard.js`, and `sysmon.js` implement the app tray, clipboard history, system monitor, and temperature indicators.
- `src/helpers/shellUtils.js` provides deferred scheduling, actor animations, and reversible handling of GNOME features that conflict with gi3 shortcuts.

## Current limitations

- Split layouts are limited to horizontal and vertical containers; tabbed and stacked commands are unsupported.
- Tiling manages normal, non-transient windows. Dialogs, menus, tooltips, notifications, and other special window types remain outside the tiling tree.
- Directional movement inside a tree does not cross a monitor boundary.
- The Node tests cover the pure engine, parser, geometry, and network helpers. GNOME Shell and Mutter integration still requires testing in a GNOME session.

## Testing and packaging

- `npm test` runs the pure JavaScript suite under `tests/` with Node's built-in test runner.
- `./package.sh` copies the release contents of `src/`, excludes the generated `schemas/gschemas.compiled` file, and writes `gi3.zip`.
- `./install.sh` builds the release archive and installs it with `gnome-extensions`.
