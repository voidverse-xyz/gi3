import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Clutter from 'gi://Clutter';
import Direction from '../enums/direction.js';
import Settings from '../helpers/settings.js';
import * as screenHelper from '../helpers/screen.js';
import {
    animationsEnabled,
    ConflictingShellFeatures,
    fadeActorIn,
    laterAdd,
    laterRemove,
    LaterType,
    resetActorEffects,
    slideActorFrom,
} from '../helpers/shellUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as LoginManager from 'resource:///org/gnome/shell/misc/loginManager.js';
import { matchesCriteria } from '../tiling/config/criteriaMatch.js';
import { DEFAULT_LAYOUT_OPTIONS, resolveFloatingRect } from '../tiling/engine/computeLayout.js';
import { Engine } from '../tiling/engine/engine.js';
import { isContainer } from '../tiling/engine/tree.js';
import { copyRect, idOf, WindowMap } from '../tiling/windowMap.js';
import { unmaximizeWindow } from '../helpers/window.js';
import { GeomStore } from '../helpers/geomStore.js';

const LAYOUT_CYCLE_ORDER = ['splith', 'splitv'];
const SESSION_SNAPSHOT_VERSION = 1;

/** Max times we re-assert our geometry against a client that keeps changing it before
 *  adopting the client's size. Prevents configure ping-pong with min-size/increment
 *  clients (terminals etc.) — see PaperWM's hasNewTarget/_pos_mismatch_count scheme. */
const MAX_REASSERTS = 2;

/** Max times the writer re-requests a slot that a window is UNDER-filling (window smaller
 *  than its slot, so it can grow into it) after the target stopped changing. Rescues windows
 *  that were transiently clamped to their min size while the layout was briefly overcrowded
 *  and then never regrew once slots widened again. Bounded so a window that genuinely cannot
 *  grow (fixed max size) is adopted instead of ping-ponged forever. */
const MAX_REFILLS = 3;

/** Under-fill smaller than this (px) is left alone: it's the terminal/VTE character-cell snap
 *  (≤ one 8px cell), not a wedged window. Keeps the re-fill loop from chasing the snap. */
const SIZE_FILL_TOLERANCE = 12;

/**
 * The Mutter-facing tiling adapter, rebuilt PaperWM-style around three rules:
 *
 *  1. ONE WRITER. All frame geometry flows through a single coalesced _apply() pass,
 *     scheduled with Meta.Later(RESIZE) — never synchronously from a signal handler.
 *  2. INTENT BEFORE ACTION. Every requested rect is remembered per window (targetRect)
 *     *before* move_resize_frame is issued, so async Wayland geometry events can be
 *     classified as "our own ack" (== target: ignore) vs "foreign" (≠ target: bounded
 *     re-assert, then adopt).
 *  3. NEVER TRUST AN UNMAPPED WAYLAND WINDOW. Classification and insertion wait for the
 *     actor's first-frame; wm_class/window_type are garbage before that.
 *
 * Owns one i3/sway-style container tree (Engine) per (monitor, workspace) pair.
 */
export default GObject.registerClass(
    class Tiler extends GObject.Object {
        _keybinds;
        _keybindActions;

        /** @type {Map<string, import('../tiling/engine/engine.js').Engine>} */
        _engines;
        /** @type {Map<string, string>} windowId -> "monitor:workspace" key */
        _windowLocation;
        _map;
        /**
         * Per-window adapter state.
         * @type {Map<string, {
         *   targetRect: import('../tiling/engine/computeLayout.js').Rect|null,
         *   reasserts: number,
         *   posRetries: number,
         *   unmapped: boolean,
         *   signals: number[],
         *   actor: any|null,
         *   actorSignals: number[],
         * }>}
         */
        _state;
        _rules;
        /** Coarse "is the tiler managing anything" flag = any workspace is (or defaults to)
         *  tiling. Fine-grained per-workspace decisions use _isTilingWorkspaceIndex(). */
        _enabled;
        /** @type {Map<number, boolean>} explicit per-workspace tiling overrides; workspaces
         *  absent here follow the TILING_MODE default. Persisted to tiling-workspace-modes. */
        _workspaceTiling;
        /** Whether the GNOME shortcut overrides are currently applied (tracks the visible
         *  workspace's mode, since those shortcuts are system-global). */
        _conflictsActive;
        _conflicts;

        /** @type {GeomStore} Persistent per-app free-mode geometry (tiling-restore-app-size):
         *  reopen an app at the size/location it last had in free mode, even after a tiling
         *  session made the app remember a small tiled size. */
        _geomStore;

        /** @type {Array<() => void>} Callbacks fired when tiling mode/focus/split/scratchpad
         *  state changes, so the top-bar indicators can reflect it. */
        _stateListeners;

        /** Keys with a pending coalesced apply, and the Later id driving them. */
        _pendingKeys;
        _applyLaterId;
        /** Pending Meta.Later ids for focus/activation, so destroy() can cancel them. */
        _idleLaterIds;

        /** Active grab bookkeeping: {id, op} while a tiled window is user-grabbed. */
        _grab;

        /** @type {string[]} windowIds currently in the scratchpad, front = next to show */
        _scratchpad;
        /** @type {string|null} windowId of the currently-shown scratchpad window, if any */
        _scratchpadVisibleId;
        /** @type {Map<string, import('../tiling/engine/computeLayout.js').Rect>} */
        _scratchpadRects;

        _displaySignals;
        _workspaceChangedSignal;
        /** @type {number[]} workspace-added/removed/reordered signal ids. */
        _workspaceLayoutSignals;
        /** @type {import('gi://Meta').Workspace[]} Workspace objects in index order, so a
         *  renumbering can be diffed (old index -> new index) after the fact. */
        _workspaceSnapshot;
        _monitorsChangedSignal;
        _loginManager;
        _prepareForSleepSignal;
        _screenChangeLaterId;
        _screenChangeSessionState;
        _modeSettingSignal;

        constructor(keybinds, sessionState = null) {
            super();

            this._keybinds = keybinds;
            this._engines = new Map();
            this._windowLocation = new Map();
            this._map = new WindowMap();
            this._state = new Map();
            this._rules = this._loadRules();
            this._loadWorkspaceModes();
            this._enabled = this._anyWorkspaceTiling();
            this._conflictsActive = false;
            this._conflicts = new ConflictingShellFeatures();
            this._geomStore = new GeomStore();
            this._stateListeners = [];
            this._pendingKeys = new Set();
            this._applyLaterId = null;
            this._screenChangeLaterId = null;
            this._screenChangeSessionState = null;
            this._idleLaterIds = new Set();
            this._grab = null;
            this._scratchpad = [];
            this._scratchpadVisibleId = null;
            this._scratchpadRects = new Map();

            this._keybindActions = this._buildKeybindActions();
            for (const [key, handler] of this._keybindActions) {
                this._keybinds.registerKeybind(key, handler);
            }

            this._displaySignals = [
                global.display.connect('window-created', (_d, window) => this._onCreated(window)),
                global.display.connect('notify::focus-window', () => this._onActivated(global.display.focus_window)),
                global.display.connect('grab-op-begin', (_d, window, op) => this._onGrabBegin(window, op)),
                global.display.connect('grab-op-end', (_d, window, op) => this._onGrabEnd(window, op)),
                global.display.connect('window-entered-monitor', (_d, _m, window) =>
                    this._onMonitorWindowLocationChanged(window)
                ),
                global.display.connect('window-left-monitor', (_d, _m, window) =>
                    this._onMonitorWindowLocationChanged(window)
                ),
            ];
            this._workspaceChangedSignal = global.workspace_manager.connect('active-workspace-changed', () =>
                this._onCurrentWorkspaceChanged()
            );
            this._snapshotWorkspaces();
            this._workspaceLayoutSignals = ['workspace-added', 'workspace-removed', 'workspaces-reordered'].map(
                (signal) => global.workspace_manager.connect(signal, () => this._onWorkspacesRenumbered())
            );
            this._monitorsChangedSignal = global.backend
                .get_monitor_manager()
                .connect('monitors-changed', () => this._onScreenChange());
            this._loginManager = LoginManager.getLoginManager();
            this._prepareForSleepSignal = this._loginManager.connect(
                'prepare-for-sleep',
                (_manager, preparing) => this._onPrepareForSleep(preparing),
            );
            // TILING_MODE is the DEFAULT mode for workspaces without an explicit override. When
            // the prefs switch changes it, recompute the coarse flag and reconcile the current
            // workspace if it still follows the default (so the switch behaves intuitively for a
            // single-workspace user). Per-workspace toggling goes through setEnabled().
            this._modeSettingSignal = Settings.reference.connect(
                `changed::${Settings.TILING_MODE}`,
                () => this._onDefaultModeChanged()
            );
            // Super+H/L drive directional focus in BOTH free and tiling modes, so clear their
            // GNOME collisions (minimize / screensaver) for the whole extension lifetime — else
            // "focus left" just minimises the window on a free workspace.
            this._conflicts.enableAlways();
            this._applyConflictsForCurrent();
            this._restoreExisting(sessionState);
            this._scheduleApplyForActiveWorkspace();
        }

        // --- public query surface (used by the free-form tricks) ---------------------------

        isWindowTiled(metaWindow) {
            if (!this._enabled || !metaWindow) {
                return false;
            }

            let key = this._windowLocation.get(idOf(metaWindow));
            let engine = key ? this._engines.get(key) : null;
            if (!engine) {
                return false;
            }

            return !engine.workspace.floating.some((f) => f.windowId === idOf(metaWindow));
        }

        /** For the indicator/keybind: the CURRENT workspace's mode (not a global flag). */
        isEnabled() {
            return this._isCurrentTiling();
        }

        /** Orientation of the focused split while tiling, for the indicator icon.
         *  @returns {'horizontal'|'vertical'|null} */
        currentSplitOrientation() {
            if (!this._isCurrentTiling()) {
                return null;
            }
            let engine = this._engines.get(this._currentKey());
            return engine ? engine.focusedOrientation() : null;
        }

        // --- per-workspace mode --------------------------------------------------------------

        _defaultTiling() {
            return Settings.tryGetBoolean(Settings.TILING_MODE) ?? false;
        }

        /** Mode of a workspace: its explicit override, else the default. */
        _isTilingWorkspaceIndex(index) {
            return this._workspaceTiling.has(index)
                ? this._workspaceTiling.get(index)
                : this._defaultTiling();
        }

        /** The workspace component of a "monitor:workspace" engine key. */
        _workspaceIndexOfKey(key) {
            return Number(key.split(':')[1]);
        }

        _isTilingKey(key) {
            return this._isTilingWorkspaceIndex(this._workspaceIndexOfKey(key));
        }

        _currentWorkspaceIndex() {
            return global.workspace_manager.get_active_workspace_index();
        }

        _isCurrentTiling() {
            return this._isTilingWorkspaceIndex(this._currentWorkspaceIndex());
        }

        _isWindowWorkspaceTiling(window) {
            let index = window.get_workspace()?.index();
            return index != null ? this._isTilingWorkspaceIndex(index) : this._isCurrentTiling();
        }

        /** True if any workspace tiles (or would, by default) — the coarse _enabled flag. */
        _anyWorkspaceTiling() {
            if (this._defaultTiling()) {
                return true;
            }
            for (let on of this._workspaceTiling.values()) {
                if (on) {
                    return true;
                }
            }
            return false;
        }

        _setWorkspaceMode(index, enabled) {
            this._workspaceTiling.set(index, enabled);
            this._persistWorkspaceModes();
            this._enabled = this._anyWorkspaceTiling();
        }

        _loadWorkspaceModes() {
            this._workspaceTiling = new Map();
            let obj = Settings.tryGetJson(Settings.TILING_WORKSPACE_MODES) ?? {};
            for (let k of Object.keys(obj)) {
                if (typeof obj[k] === 'boolean') {
                    this._workspaceTiling.set(Number(k), obj[k]);
                }
            }
        }

        _persistWorkspaceModes() {
            let obj = {};
            for (let [k, v] of this._workspaceTiling) {
                obj[k] = v;
            }
            Settings.setString(Settings.TILING_WORKSPACE_MODES, JSON.stringify(obj));
        }

        _snapshotWorkspaces() {
            let manager = global.workspace_manager;
            this._workspaceSnapshot = Array.from({ length: manager.get_n_workspaces() }, (_, i) =>
                manager.get_workspace_by_index(i)
            );
        }

        /**
         * Dynamic workspaces renumber on add/remove/reorder with NO per-window signal (each
         * MetaWorkspace object survives, only its index changes), so every index-keyed table
         * here — engines, window locations, per-workspace modes — would silently go stale:
         * new windows on one workspace would land in another workspace's engine, whose
         * layout then resizes windows the user can't even see. Diff the workspace-object
         * snapshot against the new indices and remap all three tables in place.
         */
        _onWorkspacesRenumbered() {
            let old = this._workspaceSnapshot;
            this._snapshotWorkspaces();

            /** @type {Map<number, number>} old index -> new index (-1 = workspace removed) */
            let moved = new Map();
            for (let i = 0; i < old.length; i++) {
                let next = old[i]?.index() ?? -1;
                if (next !== i) {
                    moved.set(i, next);
                }
            }
            if (moved.size === 0) {
                return;
            }

            let modes = new Map();
            for (let [index, on] of this._workspaceTiling) {
                let next = moved.has(index) ? moved.get(index) : index;
                if (next >= 0) {
                    modes.set(next, on);
                }
            }
            this._workspaceTiling = modes;
            this._persistWorkspaceModes();
            this._enabled = this._anyWorkspaceTiling();

            let engines = new Map();
            for (let [key, engine] of this._engines) {
                let [monitor, index] = key.split(':').map(Number);
                let next = moved.has(index) ? moved.get(index) : index;
                if (next >= 0) {
                    engines.set(this._keyFor(monitor, next), engine);
                }
                // A removed workspace's engine is dropped: GNOME only culls empty workspaces,
                // and windows evacuated beforehand re-routed via their own workspace-changed.
            }
            this._engines = engines;

            for (let [id, key] of [...this._windowLocation]) {
                let [monitor, index] = key.split(':').map(Number);
                let next = moved.has(index) ? moved.get(index) : index;
                if (next >= 0) {
                    this._windowLocation.set(id, this._keyFor(monitor, next));
                } else {
                    this._windowLocation.delete(id);
                }
            }

            // Safety net for anything the pure index remap couldn't place (e.g. a window that
            // genuinely changed workspace in the same shuffle): re-derive from the windows.
            for (let window of this._map.windows()) {
                this._routeWindow(window);
            }

            this._applyConflictsForCurrent();
            this._notifyStateChanged();
            this._scheduleApplyForActiveWorkspace();
        }

        /** The tiler-specific GNOME overrides are system-global, so track the visible
         *  workspace's mode. (The focus-key overrides are always on; see enableAlways.) */
        _applyConflictsForCurrent() {
            let shouldOverride = this._isCurrentTiling();
            if (shouldOverride === this._conflictsActive) {
                return;
            }
            this._conflictsActive = shouldOverride;
            if (shouldOverride) {
                this._conflicts.enableTiling();
            } else {
                this._conflicts.disableTiling();
            }
        }

        _onDefaultModeChanged() {
            this._enabled = this._anyWorkspaceTiling();
            let index = this._currentWorkspaceIndex();
            if (this._workspaceTiling.has(index)) {
                return; // current workspace has its own override; the default doesn't touch it
            }
            this._reconcileWorkspace(index);
            this._applyConflictsForCurrent();
            this._scheduleApplyForActiveWorkspace();
            this._notifyStateChanged();
        }

        /** Bring a workspace's windows in line with its mode. */
        _reconcileWorkspace(index) {
            if (this._isTilingWorkspaceIndex(index)) {
                this._adoptWorkspace(index);
            } else {
                this._restoreWorkspace(index);
            }
        }

        /** Tile every manageable, not-yet-tiled window on a workspace. */
        _adoptWorkspace(index) {
            let workspace = global.workspace_manager.get_workspace_by_index(index);
            if (!workspace) {
                return;
            }
            for (let window of workspace.list_windows()) {
                let id = idOf(window);
                if (this._windowLocation.has(id) || this._scratchpad.includes(id)) {
                    continue;
                }
                if (!this._manageable(window) || window.minimized || window.get_monitor() < 0) {
                    continue;
                }
                if (!this._state.has(id)) {
                    this._track(window, { unmapped: false });
                }
                this._unmaximize(window);
                let key = this._keyForWindow(window);
                this._engineFor(key).addWindow(id);
                this._windowLocation.set(id, key);
                this._scheduleApply(key);
            }
        }

        /** Untile every tiled window on a workspace, restoring each to its free geometry. */
        _restoreWorkspace(index) {
            for (let id of [...this._windowLocation.keys()]) {
                if (this._workspaceIndexOfKey(this._windowLocation.get(id)) !== index) {
                    continue;
                }
                this._untileAndRestore(id);
            }
        }

        /**
         * How a window leaves tiling, in one place: drop it from its engine, put its frame
         * back at the remembered free geometry, and stop tracking it.
         * @returns {string|undefined} the engine key it left, for the caller to _scheduleApply
         */
        _untileAndRestore(id) {
            let key = this._windowLocation.get(id);
            if (key) {
                this._engines.get(key)?.removeWindow(id);
            }
            let window = this._map.get(id);
            let orig = this._map.originalOf(id);
            if (orig && window) {
                window.move_resize_frame(true, orig.x, orig.y, orig.width, orig.height);
            }
            this._untrack(id);
            return key;
        }

        /** Register a callback fired when tiling mode/focus/split/scratchpad state changes
         *  (the tile-mode and scratchpad indicators). */
        onStateChanged(fn) {
            this._stateListeners.push(fn);
        }

        _notifyStateChanged() {
            for (let fn of this._stateListeners) {
                try {
                    fn();
                } catch {
                    // An indicator fault must not break command execution.
                }
            }
        }

        /**
         * Capture only plain data needed to survive GNOME disabling extensions while the
         * screen is locked. MetaWindow references and signal ids must never cross that cycle.
         */
        snapshotSessionState() {
            // A monitor transition may still be between the display-down and display-up
            // events when GNOME disables the extension for lock. Keep the last complete tree
            // captured before that transition rather than serializing temporary routing.
            if (this._screenChangeSessionState) {
                return this._screenChangeSessionState;
            }

            let originals = {};
            for (let id of this._map.ids()) {
                let rect = this._map.originalOf(id);
                if (rect) {
                    originals[id] = copyRect(rect);
                }
            }

            let engines = [];
            for (let [key, engine] of this._engines) {
                engines.push({ key, state: engine.snapshotState() });
            }

            return {
                version: SESSION_SNAPSHOT_VERSION,
                engines,
                originals,
                scratchpad: [...this._scratchpad],
                scratchpadVisibleId: this._scratchpadVisibleId,
                scratchpadRects: this._snapshotScratchpadRects(),
            };
        }

        /** Toggle tiling for the CURRENT workspace (per-workspace, sway-style). */
        setEnabled(enabled) {
            let index = this._currentWorkspaceIndex();
            if (this._isTilingWorkspaceIndex(index) === enabled) {
                return;
            }

            this._setWorkspaceMode(index, enabled);

            if (enabled) {
                // Windows are still at their free geometry right now: snapshot them to the
                // per-app store before tiling reshapes them.
                this._snapshotOpenWindows();
                this._adoptWorkspace(index);
                this._scheduleApplyForActiveWorkspace();
            } else {
                this._restoreWorkspace(index);
            }
            this._applyConflictsForCurrent();
            this._notifyStateChanged();
        }

        /** Re-read gaps/rules from settings and re-apply them to every live engine. */
        reloadFromSettings() {
            this._rules = this._loadRules();
            let options = this._layoutOptions();
            for (let engine of this._engines.values()) {
                engine.options = options;
            }
            this._scheduleApplyForActiveWorkspace();
        }

        // --- command execution --------------------------------------------------------------

        runCommand(command) {
            // The scratchpad is GLOBAL (i3-style): one stash shared by every workspace,
            // summonable anywhere — including free workspaces, which the tiling gate below
            // would block. Its commands are handled off the engine anyway (a shown
            // scratchpad window isn't in any tree), so intercept them first.
            let scratchpadWindow = this._activeScratchpadWindow();
            if (command.type === 'kill' && scratchpadWindow) {
                // The engine only knows tiled/floating windows; commands targeting "the
                // focused window" must be redirected to a shown scratchpad window while
                // it holds focus.
                scratchpadWindow.delete(global.get_current_time());
                return;
            }
            // This key toggles the focused window in/out of the scratchpad: if it's
            // already stashed, pull it back to the current workspace; otherwise stash it.
            if (command.type === 'moveScratchpad') {
                let focused = global.display.focus_window;
                let fid = focused ? idOf(focused) : null;
                if (!fid) {
                    return;
                }
                if (this._scratchpad.includes(fid)) {
                    this._bringFromScratchpad(fid);
                    return;
                }
                if (!this._map.has(fid)) {
                    // A window on a free workspace isn't tracked; adopt it so the
                    // scratchpad bookkeeping (map, original rect, signals) can work.
                    if (!this._manageable(focused)) {
                        return;
                    }
                    this._track(focused, { unmapped: false });
                }
                this._moveToScratchpad(fid);
                return;
            }
            if (command.type === 'scratchpadShow') {
                this._scratchpadShow();
                return;
            }
            if (command.type === 'scratchpadCycle') {
                this._scratchpadCycle();
                return;
            }

            if (!this._isCurrentTiling()) {
                return;
            }

            let key = this._currentKey();
            let engine = this._engineFor(key);

            let beforeFullscreenId = command.type === 'fullscreen' ? this._fullscreenWindowId(engine) : null;

            let intents = engine.apply(command);

            if (command.type === 'fullscreen') {
                this._syncFullscreen(engine, beforeFullscreenId);
            }

            // A fresh user command resets the adopt-clients'-size backoff: the user asked
            // for this layout, so we get a new budget of re-asserts against stubborn apps.
            this._resetReasserts(key);
            this._scheduleApply(key);
            this._syncFocusToShell(key);

            for (let intent of intents) {
                this._handleIntent(intent);
            }

            this._notifyStateChanged();
        }

        // --- keybinds -------------------------------------------------------------------------

        _buildKeybindActions() {
            return [
                [Settings.KEY_TILE_SPLIT_H, () => this.runCommand({ type: 'split', orientation: 'horizontal' })],
                [Settings.KEY_TILE_SPLIT_V, () => this.runCommand({ type: 'split', orientation: 'vertical' })],
                [Settings.KEY_TILE_LAYOUT_CYCLE, () => this._cycleLayout()],
                [Settings.KEY_TILE_MOVE_LEFT, () => this.runCommand({ type: 'move', dir: Direction.Left })],
                [Settings.KEY_TILE_MOVE_RIGHT, () => this.runCommand({ type: 'move', dir: Direction.Right })],
                [Settings.KEY_TILE_MOVE_UP, () => this.runCommand({ type: 'move', dir: Direction.Up })],
                [Settings.KEY_TILE_MOVE_DOWN, () => this.runCommand({ type: 'move', dir: Direction.Down })],
                [Settings.KEY_TILE_FOCUS_LEFT, () => this.runCommand({ type: 'focus', dir: Direction.Left })],
                [Settings.KEY_TILE_FOCUS_RIGHT, () => this.runCommand({ type: 'focus', dir: Direction.Right })],
                [Settings.KEY_TILE_FOCUS_UP, () => this.runCommand({ type: 'focus', dir: Direction.Up })],
                [Settings.KEY_TILE_FOCUS_DOWN, () => this.runCommand({ type: 'focus', dir: Direction.Down })],
                [Settings.KEY_TILE_FOCUS_PARENT, () => this.runCommand({ type: 'focusParent' })],
                [Settings.KEY_TILE_FOCUS_CHILD, () => this.runCommand({ type: 'focusChild' })],
                [Settings.KEY_TILE_TOGGLE_FLOATING, () => this.runCommand({ type: 'floatingToggle' })],
                [Settings.KEY_TILE_TOGGLE_FULLSCREEN, () => this.runCommand({ type: 'fullscreen' })],
                [Settings.KEY_TILE_MOVE_TO_WORKSPACE_NEXT, () => this._moveFocusedToRelativeWorkspace(1)],
                [Settings.KEY_TILE_MOVE_TO_WORKSPACE_PREV, () => this._moveFocusedToRelativeWorkspace(-1)],
                [Settings.KEY_TILE_GAP_INCREASE, () => this._adjustInnerGap(2)],
                [Settings.KEY_TILE_GAP_DECREASE, () => this._adjustInnerGap(-2)],
                [Settings.KEY_TILE_MOVE_TO_SCRATCHPAD, () => this.runCommand({ type: 'moveScratchpad' })],
                [Settings.KEY_TILE_TOGGLE_SCRATCHPAD, () => this.runCommand({ type: 'scratchpadShow' })],
                [Settings.KEY_TILE_CYCLE_SCRATCHPAD, () => this.runCommand({ type: 'scratchpadCycle' })],
            ];
        }

        _cycleLayout() {
            let key = this._currentKey();
            let engine = this._engineFor(key);
            let ws = engine.workspace;
            let container = ws.focus ? (isContainer(ws.focus) ? ws.focus : ws.focus.parent) : ws.root;
            if (!container) {
                return;
            }

            let next = LAYOUT_CYCLE_ORDER[(LAYOUT_CYCLE_ORDER.indexOf(container.layout) + 1) % LAYOUT_CYCLE_ORDER.length];
            engine.apply({ type: 'layout', layout: next });
            this._resetReasserts(key);
            this._scheduleApply(key);
            this._syncFocusToShell(key);
        }

        _moveFocusedToRelativeWorkspace(delta) {
            let activeIndex = global.workspace_manager.get_active_workspace_index();
            let target = activeIndex + delta;
            if (target < 0) {
                return;
            }

            this.runCommand({ type: 'moveToWorkspace', workspace: target + 1 });
        }

        _adjustInnerGap(delta) {
            let current = Settings.tryGetInteger(Settings.TILING_GAPS_INNER) ?? DEFAULT_LAYOUT_OPTIONS.innerGap;
            let next = Math.max(0, current + delta);
            Settings.setInteger(Settings.TILING_GAPS_INNER, next);

            for (let engine of this._engines.values()) {
                engine.options = { ...engine.options, innerGap: next };
            }

            this._scheduleApplyForActiveWorkspace();
        }

        // --- rules --------------------------------------------------------------------------

        _loadRules() {
            let parsed = Settings.tryGetJson(Settings.TILING_RULES_JSON);
            return Array.isArray(parsed) ? parsed : [];
        }

        _applyRules(window, key) {
            if (this._rules.length === 0) {
                return;
            }

            let props = this._propsOf(window);
            let engine = this._engineFor(key);

            for (let rule of this._rules) {
                if (rule.command.type === 'nop') {
                    continue;
                }
                if (!matchesCriteria(rule.criteria, props)) {
                    continue;
                }

                for (let intent of engine.apply(rule.command)) {
                    this._handleIntent(intent);
                }
            }
        }

        _propsOf(window) {
            let wmClass = window.get_wm_class() ?? '';
            return {
                appId: wmClass,
                windowClass: wmClass,
                instance: wmClass,
                title: window.get_title() ?? '',
                windowRole: window.get_role() ?? '',
            };
        }

        // --- window lifecycle -----------------------------------------------------------------

        _onCreated(window) {
            if (!this._basicManageable(window)) {
                return;
            }
            let actor = window.get_compositor_private();
            if (!actor) {
                return;
            }

            // Free workspace: the tiler doesn't lay this window out, but re-applies the app's
            // remembered pre-tiling size so a window closed while tiled doesn't reopen at its
            // small grid size (the app saved that small size itself).
            if (!this._isWindowWorkspaceTiling(window)) {
                this._maybeRestoreAppSize(window, actor);
                return;
            }

            // Wayland windows report unreliable wm_class/window_type (and often a bogus
            // monitor) until the client has attached its first buffer. Track the window but
            // defer classification, rule matching and tree insertion to the actor's
            // first-frame; keep it out of _apply until then via state.unmapped.

            this._track(window, { unmapped: true });

            let firstFrameId = actor.connect('first-frame', () => {
                actor.disconnect(firstFrameId);
                let state = this._state.get(idOf(window));
                if (!state) {
                    return;
                }
                state.unmapped = false;

                // The window now has its real natural size (it was tracked pre-first-frame,
                // when the frame rect is a tiny bogus value). Re-capture the restore rect so
                // untiling/turning tiling off returns it to this size. Must happen before
                // _insertMapped tiles it. (Per-app free geometry is captured separately, only
                // while the window is actually free — never from a window being tiled.)
                this._map.setOriginal(idOf(window), copyRect(window.get_frame_rect()));

                // Don't let the window flash at its spawn position before the layout
                // places it: keep the actor transparent until the tiled geometry lands
                // (revealed in _maybeSettle, with a timeout fallback for windows that
                // are already exactly where the tree wants them).
                if (animationsEnabled() && this._manageable(window)) {
                    actor.opacity = 0;
                    state.revealPending = true;
                    state.revealTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                        state.revealTimeout = null;
                        this._reveal(window, state);
                        return GLib.SOURCE_REMOVE;
                    });
                }

                this._insertMapped(window);
            });
        }

        _insertMapped(window) {
            if (!this._isWindowWorkspaceTiling(window) || !this._manageable(window) || window.get_monitor() < 0) {
                return;
            }

            // A window that requests fullscreen at launch keeps that compositor-level flag
            // regardless of geometry requests, so it would stay fullscreen forever instead
            // of taking its tiled slot.
            if (window.is_fullscreen()) {
                window.unmake_fullscreen();
            }
            this._unmaximize(window);

            let id = idOf(window);
            let key = this._keyForWindow(window);

            this._engineFor(key).addWindow(id);
            this._windowLocation.set(id, key);

            this._applyRules(window, key);
            this._scheduleApply(key);

            // Let Mutter finish its own bookkeeping for the map before we activate.
            this._laterIdle(() => {
                if (this._map.has(id)) {
                    Main.activateWindow(window);
                }
            });
        }

        _onRemoved(window) {
            let id = idOf(window);
            if (!this._map.has(id)) {
                return;
            }

            this._dropFromScratchpad(id);

            let key = this._windowLocation.get(id);
            this._untrack(id);

            if (key) {
                this._engines.get(key)?.removeWindow(id);
                this._scheduleApply(key);
            }
        }

        _onActivated(window) {
            this._notifyStateChanged();
            // NB: no pointer warp here. This fires for every focus change, including
            // click-to-focus — warping then would fight the mouse. The warp happens only in
            // _syncFocusToShell, which runs when a keybind command moves focus.

            if (!this._enabled || !window) {
                return;
            }

            let id = idOf(window);
            if (!this._map.has(id)) {
                return;
            }

            let key = this._windowLocation.get(id);
            if (key) {
                this._engines.get(key)?.notifyFocused(id);
            }
        }

        _onCurrentWorkspaceChanged() {
            // Bring the newly-visible workspace's windows in line with its mode (windows that
            // arrived while it was off-screen, or a mode/default change), flip the system-global
            // GNOME shortcut overrides to match it, and refresh the indicator.
            this._reconcileWorkspace(this._currentWorkspaceIndex());
            this._applyConflictsForCurrent();
            this._notifyStateChanged();
            this._scheduleApplyForActiveWorkspace();
        }

        _onPrepareForSleep(preparing) {
            if (!this._enabled) {
                return;
            }

            this._captureScreenChangeSessionState();
            if (!preparing) {
                // With screen locking disabled the extension stays active and receives the
                // resume half of PrepareForSleep. With locking enabled, disable()/enable()
                // carries this snapshot across the lock-screen session instead.
                this._onScreenChange();
            }
        }

        _captureScreenChangeSessionState() {
            if (this._screenChangeSessionState) {
                return;
            }

            if (this._scratchpadVisibleId) {
                this._rememberScratchpadRect(
                    this._scratchpadVisibleId,
                    this._map.get(this._scratchpadVisibleId),
                );
            }
            this._screenChangeSessionState = this.snapshotSessionState();
        }

        _onScreenChange() {
            if (!this._enabled) {
                return;
            }

            // Suspend/resume commonly emits monitors-changed while displays power-cycle.
            // Capture before per-window monitor signals can mutate the trees, then wait for
            // Mutter's monitor and workspace routing to settle before rehydrating.
            this._captureScreenChangeSessionState();
            if (this._screenChangeLaterId !== null) {
                laterRemove(this._screenChangeLaterId);
                this._screenChangeLaterId = null;
            }

            // Restart the deferred pass for every monitor/window routing event so the last
            // event in the burst determines the settled topology.
            this._screenChangeLaterId = laterAdd(LaterType.RESIZE, () => {
                this._screenChangeLaterId = null;
                if (!this._screenRoutingReady()) {
                    // Keep the pre-change snapshot. A display-up monitors-changed event will
                    // retry after resume instead of flattening the layout while outputs are
                    // absent or windows temporarily report monitor -1.
                    return GLib.SOURCE_REMOVE;
                }

                let sessionState = this._screenChangeSessionState;
                this._screenChangeSessionState = null;
                this._rebuild(sessionState);
                this._scheduleApplyForActiveWorkspace();
                return GLib.SOURCE_REMOVE;
            });
        }

        _screenRoutingReady() {
            if (Main.layoutManager.monitors.length === 0) {
                return false;
            }

            for (let [id] of this._windowLocation) {
                let window = this._map.get(id);
                if (!window || window.get_monitor() < 0 || !window.get_workspace()) {
                    return false;
                }
                if (!this._outputForKey(this._keyForWindow(window))) {
                    return false;
                }
            }

            return true;
        }

        _onMonitorWindowLocationChanged(window) {
            if (!this._enabled || !window || !this._map.has(idOf(window))) {
                return;
            }

            // Mutter emits per-window leave/enter signals before its public
            // monitors-changed signal. Capture on the first one so the source tree has not
            // already been incrementally rerouted and flattened.
            this._captureScreenChangeSessionState();
            this._onScreenChange();
        }

        _onWindowLocationMaybeChanged(window) {
            if (!this._enabled || !window || !this._map.has(idOf(window))) {
                return;
            }

            if (this._screenChangeSessionState) {
                // Keep the pre-change trees intact while Mutter routes every window. Each
                // location event retries the deferred rehydrate; the last settled event wins.
                this._onScreenChange();
                return;
            }

            this._routeWindow(window);
        }

        _routeWindow(window) {
            let id = idOf(window);
            let state = this._state.get(id);
            if (!state || state.unmapped) {
                return;
            }
            if (this._scratchpad.includes(id)) {
                // Scratchpad members (hidden or currently shown) never re-enter a tiling
                // tree via workspace/monitor changes — only explicit scratchpad actions
                // move them in or out.
                return;
            }

            if (window.get_monitor() < 0) {
                // Mutter reports an invalid (-1) monitor for a window mid-teardown (closing,
                // or briefly unmapped) — window-left-monitor/workspace-changed can fire in
                // that state. Building an engine keyed on -1 hits an assertion failure in
                // meta_workspace_get_work_area_for_monitor and destabilizes the compositor.
                // The window's own `unmanaged` signal will clean it up correctly via
                // _onRemoved using its last known-good key, so just ignore this one.
                return;
            }

            let newKey = this._keyForWindow(window);
            let oldKey = this._windowLocation.get(id);
            if (oldKey === newKey) {
                return;
            }

            // Moved onto a free workspace: untile it and restore its free geometry, so a
            // window's mode follows the workspace it lives on (sway-style).
            if (!this._isTilingKey(newKey)) {
                let vacatedKey = this._untileAndRestore(id);
                if (vacatedKey) {
                    this._scheduleApply(vacatedKey);
                }
                return;
            }

            if (oldKey) {
                this._engines.get(oldKey)?.removeWindow(id);
            }
            this._engineFor(newKey).addWindow(id);
            this._windowLocation.set(id, newKey);
            state.targetRect = null;
            state.reasserts = 0;

            if (oldKey) {
                this._scheduleApply(oldKey);
            }
            this._scheduleApply(newKey);
        }

        _track(window, { unmapped }) {
            this._map.add(window);
            let id = idOf(window);

            let state = {
                targetRect: null,
                reasserts: 0,
                posRetries: 0,
                /** Bounded re-request budget for filling an under-filled reachable slot. */
                refills: 0,
                /** The slot size `refills` is counting against; reset when it changes. */
                refillTarget: null,
                unmapped,
                signals: [],
                actor: null,
                actorSignals: [],
                /** Frame rect at the moment we issued the last request; drives slide-in. */
                animFrom: null,
                /** New window kept invisible until it sits in its slot. */
                revealPending: false,
                revealTimeout: null,
            };
            this._state.set(id, state);

            state.signals = [
                window.connect('size-changed', () => this._onSizeChanged(window)),
                window.connect('position-changed', () => this._onPositionChanged(window)),
                window.connect('workspace-changed', () => this._onWindowLocationMaybeChanged(window)),
                window.connect('notify::maximized-horizontally', () => this._onMaximized(window)),
                window.connect('notify::maximized-vertically', () => this._onMaximized(window)),
                window.connect('notify::minimized', () => this._onMinimizedChanged(window)),
                window.connect('unmanaged', () => this._onRemoved(window)),
            ];
        }

        _untrack(id) {
            let state = this._state.get(id);
            let window = this._map.get(id);
            if (state && window) {
                for (let signalId of state.signals) {
                    window.disconnect(signalId);
                }
                if (state.revealTimeout) {
                    GLib.source_remove(state.revealTimeout);
                    state.revealTimeout = null;
                }
                let actor = window.get_compositor_private();
                if (actor) {
                    resetActorEffects(actor);
                }
            }
            this._state.delete(id);
            this._windowLocation.delete(id);
            this._map.remove(id);
        }

        _restoreExisting(sessionState) {
            if (sessionState?.version !== SESSION_SNAPSHOT_VERSION || !Array.isArray(sessionState.engines)) {
                this._adoptExisting();
                return;
            }

            let liveWindows = new Map();
            for (let window of global.display.list_all_windows()) {
                if (this._manageable(window)) {
                    liveWindows.set(idOf(window), window);
                }
            }

            let originals = sessionState.originals ?? {};
            this._restoreScratchpad(sessionState, liveWindows, originals);
            let restoredFocus = new Map();
            for (let entry of sessionState.engines) {
                let key = this._restoreEngine(entry, liveWindows, originals);
                if (key) {
                    restoredFocus.set(key, entry.state);
                }
            }
            this._restoreUnplacedWindows(liveWindows, originals);

            // Windows created or moved while the lock screen was active were not in the
            // snapshot. Adopt them normally without disturbing the restored trees.
            this._adoptExisting(originals);
            this._restoreFocusAfterAdoption(restoredFocus);
        }

        _restoreScratchpad(sessionState, liveWindows, originals) {
            let ids = Array.isArray(sessionState.scratchpad) ? sessionState.scratchpad : [];
            let savedRects = sessionState.scratchpadRects ?? {};
            let seen = new Set();
            for (let rawId of ids) {
                let id = String(rawId);
                let window = liveWindows.get(id);
                if (!window || seen.has(id)) {
                    continue;
                }

                seen.add(id);
                this._scratchpad.push(id);
                this._track(window, { unmapped: false });
                this._restoreOriginalRect(id, originals[id]);
                if (this._isValidRect(savedRects[id])) {
                    this._scratchpadRects.set(id, copyRect(savedRects[id]));
                }
            }

            let visibleId = sessionState.scratchpadVisibleId;
            visibleId = visibleId == null ? null : String(visibleId);
            this._scratchpadVisibleId = visibleId && seen.has(visibleId) ? visibleId : null;
            for (let id of this._scratchpad) {
                let window = liveWindows.get(id);
                if (id === this._scratchpadVisibleId) {
                    if (window.minimized) {
                        window.unminimize();
                    }
                    if (this._scratchpadRects.has(id)) {
                        this._placeScratchpadWindow(id, window, this._resolvedScratchpadRect(id));
                    }
                } else if (!window.minimized) {
                    window.minimize();
                }
            }
            Settings.setBoolean(Settings.SCRATCHPAD_VISIBLE, this._scratchpadVisibleId !== null);
        }

        _restoreEngine(entry, liveWindows, originals) {
            if (!entry?.state || typeof entry.key !== 'string') {
                return;
            }

            let engine = Engine.fromStateSnapshot(
                { x: 0, y: 0, width: 1, height: 1 },
                entry.state,
                this._layoutOptions(),
            );
            let liveKeys = new Set();
            for (let id of engine.windowIds()) {
                let window = liveWindows.get(id);
                if (!window || window.minimized || this._scratchpad.includes(id) || window.get_monitor() < 0) {
                    continue;
                }
                let key = this._keyForWindow(window);
                if (this._isTilingKey(key)) {
                    liveKeys.add(key);
                }
            }
            if (liveKeys.size === 0) {
                return;
            }

            // Dynamic workspace or monitor indices may have changed while locked. If every
            // surviving member moved together, carry the whole tree to its new key.
            let key = liveKeys.size === 1 ? liveKeys.values().next().value : entry.key;
            if (!liveKeys.has(key) || this._engines.has(key)) {
                return;
            }

            let output = this._outputForKey(key);
            if (!output) {
                return;
            }
            engine.output = output;

            // Drop closed, minimized, scratchpad, and independently moved windows. The engine's
            // normal remove operation also prunes empty containers and repairs focus.
            for (let id of engine.windowIds()) {
                let window = liveWindows.get(id);
                let keep =
                    window &&
                    !window.minimized &&
                    !this._scratchpad.includes(id) &&
                    window.get_monitor() >= 0 &&
                    this._isTilingKey(this._keyForWindow(window)) &&
                    this._keyForWindow(window) === key;
                if (!keep) {
                    engine.removeWindow(id);
                }
            }
            if (engine.windowIds().length === 0) {
                return;
            }

            this._engines.set(key, engine);
            for (let id of engine.windowIds()) {
                let window = liveWindows.get(id);
                this._track(window, { unmapped: false });
                this._restoreOriginalRect(id, originals[id]);
                this._windowLocation.set(id, key);
            }
            return key;
        }

        _restoreFocusAfterAdoption(restoredFocus) {
            for (let [key, state] of restoredFocus) {
                this._engines.get(key)?.restoreFocusFromStateSnapshot(state);
            }

            // If Mutter already restored focus to a managed window, that live shell focus is
            // newer than the snapshot. Lock-screen actors are absent from _windowLocation, so
            // they do not erase the preserved tree focus.
            let focused = global.display.focus_window;
            let id = focused ? idOf(focused) : null;
            let key = id ? this._windowLocation.get(id) : null;
            if (key) {
                this._engines.get(key)?.notifyFocused(id);
            }
        }

        _restoreUnplacedWindows(liveWindows, originals) {
            for (let id of Object.keys(originals)) {
                let window = liveWindows.get(id);
                if (!window || this._map.has(id)) {
                    continue;
                }

                // A setting or workspace move can put a formerly-tiled window on a free
                // workspace while the extension is disabled. Return it to its saved free
                // geometry instead of leaving the last tiled frame behind.
                if (!this._isWindowWorkspaceTiling(window)) {
                    let rect = originals[id];
                    if (this._isValidRect(rect)) {
                        window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
                    }
                    continue;
                }

                // Minimized tiled windows intentionally have no tree slot. Keep them tracked
                // with their original free rect so unminimizing can insert them later without
                // losing the geometry that turning tiling off should restore.
                if (window.minimized) {
                    this._track(window, { unmapped: false });
                    this._restoreOriginalRect(id, originals[id]);
                }
            }
        }

        _isValidRect(rect) {
            return (
                rect &&
                Number.isFinite(rect.x) &&
                Number.isFinite(rect.y) &&
                Number.isFinite(rect.width) &&
                Number.isFinite(rect.height) &&
                rect.width > 0 &&
                rect.height > 0
            );
        }

        _restoreOriginalRect(id, rect) {
            if (this._isValidRect(rect)) {
                this._map.setOriginal(id, copyRect(rect));
            }
        }

        _adoptExisting(originals = null) {
            for (let window of global.display.list_all_windows()) {
                if (!this._manageable(window)) {
                    continue;
                }

                // Already-mapped windows have trustworthy properties; insert directly.
                let id = idOf(window);
                if (this._map.has(id)) {
                    continue;
                }
                let isScratchpadWindow = this._scratchpad.includes(id);
                if (!isScratchpadWindow && !this._isWindowWorkspaceTiling(window)) {
                    continue;
                }

                this._track(window, { unmapped: false });
                this._restoreOriginalRect(id, originals?.[id]);
                if (isScratchpadWindow) {
                    // The scratchpad is global, so members stay tracked even on free workspaces.
                    continue;
                }
                if (window.minimized) {
                    // A minimized window would occupy a tree slot while showing nothing.
                    continue;
                }
                if (window.get_monitor() < 0) {
                    continue;
                }

                this._unmaximize(window);
                let key = this._keyForWindow(window);
                this._engineFor(key).addWindow(id);
                this._windowLocation.set(id, key);
            }
        }

        _rebuild(sessionState = null) {
            if (!sessionState) {
                if (this._scratchpadVisibleId) {
                    this._rememberScratchpadRect(
                        this._scratchpadVisibleId,
                        this._map.get(this._scratchpadVisibleId),
                    );
                }
                sessionState = this.snapshotSessionState();
            }
            for (let id of this._map.ids()) {
                this._untrack(id);
            }
            this._map.clear();
            this._engines.clear();
            this._windowLocation.clear();
            this._scratchpad = [];
            this._scratchpadVisibleId = null;
            this._scratchpadRects.clear();

            // Rehydrate against current MetaWindow objects and monitor/workspace indices.
            // _restoreExisting() preserves each engine when its surviving windows still share
            // a destination key, then adopts genuinely new or independently moved windows.
            this._restoreExisting(sessionState);
        }

        /** Type/flag checks that are valid even before first-frame. */
        _basicManageable(window) {
            if (window.is_override_redirect() || window.is_skip_taskbar()) {
                return false;
            }
            // is_override_redirect() is unreliable for Wayland popups; reject the popup
            // window types explicitly.
            let type = window.get_window_type();
            if (
                type === Meta.WindowType.DROPDOWN_MENU ||
                type === Meta.WindowType.POPUP_MENU ||
                type === Meta.WindowType.TOOLTIP ||
                type === Meta.WindowType.NOTIFICATION ||
                type === Meta.WindowType.OVERRIDE_OTHER
            ) {
                return false;
            }
            return true;
        }

        _manageable(window) {
            if (!this._basicManageable(window)) {
                return false;
            }
            if (window.get_window_type() !== Meta.WindowType.NORMAL) {
                return false;
            }
            if (window.is_attached_dialog?.() || window.get_transient_for()) {
                return false;
            }
            return true;
        }

        // --- arrival animation ------------------------------------------------------------------

        /**
         * Called from the ack branches of the geometry handlers. Once the frame fully
         * matches the target, slide the actor in from where the window was when we issued
         * the request, and reveal it if this was its first placement. Purely visual:
         * frame geometry is already committed, so this cannot feed back into layout.
         */
        _maybeSettle(window, state) {
            let target = state.targetRect;
            if (!target) {
                return;
            }
            let f = window.get_frame_rect();
            if (f.x !== target.x || f.y !== target.y || f.width !== target.width || f.height !== target.height) {
                return;
            }

            let actor = window.get_compositor_private();
            if (!actor) {
                state.animFrom = null;
                return;
            }

            if (state.animFrom) {
                let dx = state.animFrom.x - target.x;
                let dy = state.animFrom.y - target.y;
                state.animFrom = null;
                if (!state.revealPending) {
                    slideActorFrom(actor, dx, dy);
                }
            }
            this._reveal(window, state);
        }

        _reveal(window, state) {
            if (!state.revealPending) {
                return;
            }
            state.revealPending = false;
            if (state.revealTimeout) {
                GLib.source_remove(state.revealTimeout);
                state.revealTimeout = null;
            }
            let actor = window.get_compositor_private();
            if (actor) {
                fadeActorIn(actor);
            }
        }

        // --- geometry event classification ------------------------------------------------------

        _onSizeChanged(window) {
            if (!this._enabled) {
                return;
            }
            // Never react inline: Wayland geometry signals arrive during Mutter's own
            // processing; queue on the RESIZE later phase.
            laterAdd(LaterType.RESIZE, () => {
                this._classifyGeometryEvent(window);
                return GLib.SOURCE_REMOVE;
            });
        }

        _onPositionChanged(window) {
            if (!this._enabled) {
                return;
            }
            laterAdd(LaterType.RESIZE, () => {
                let id = idOf(window);
                let state = this._state.get(id);
                let target = state?.targetRect;
                if (!state || !target || state.unmapped) {
                    return GLib.SOURCE_REMOVE;
                }
                if (this._grab && this._grab.id === id) {
                    return GLib.SOURCE_REMOVE;
                }
                if (!this._map.has(id) || !this.isWindowTiled(window)) {
                    return GLib.SOURCE_REMOVE;
                }

                let f = window.get_frame_rect();
                if (f.x === target.x && f.y === target.y) {
                    state.posRetries = 0;
                    this._maybeSettle(window, state);
                    return GLib.SOURCE_REMOVE;
                }
                // Mutter sometimes bounces a frame move back to its old position; re-assert
                // with a bounded retry so a stubborn client can't trap us in a loop.
                if (state.posRetries >= MAX_REASSERTS) {
                    return GLib.SOURCE_REMOVE;
                }
                state.posRetries += 1;
                window.move_frame(true, target.x, target.y);
                return GLib.SOURCE_REMOVE;
            });
        }

        _classifyGeometryEvent(window) {
            let id = idOf(window);
            let state = this._state.get(id);
            if (!state || state.unmapped || !this._map.has(id)) {
                return GLib.SOURCE_REMOVE;
            }
            if (this._grab && this._grab.id === id) {
                // The user owns this window's geometry for the duration of the grab.
                return GLib.SOURCE_REMOVE;
            }

            let target = state.targetRect;
            if (!target || !this.isWindowTiled(window)) {
                return GLib.SOURCE_REMOVE;
            }

            let f = window.get_frame_rect();
            if (f.width === target.width && f.height === target.height) {
                // Our own resize round-trip completing (position handled separately).
                state.reasserts = 0;
                this._maybeSettle(window, state);
                return GLib.SOURCE_REMOVE;
            }

            // Foreign resize: the app (or something else) changed size on its own. Re-assert
            // the layout a bounded number of times, then adopt the client's size rather than
            // fighting a client that clamps to min/max sizes or size increments.
            if (state.reasserts >= MAX_REASSERTS) {
                return GLib.SOURCE_REMOVE;
            }
            state.reasserts += 1;
            state.targetRect = null; // force hasNewTarget on the next apply
            let key = this._windowLocation.get(id);
            if (key) {
                this._scheduleApply(key);
            }
            return GLib.SOURCE_REMOVE;
        }

        _onMaximized(window) {
            if (!this._enabled || !this.isWindowTiled(window)) {
                return;
            }
            // Tiled windows don't get to be maximized (the compositor-level state overrides
            // frame geometry): unmaximize and re-assert the slot, like PaperWM does on insert.
            if (this._isMaximized(window)) {
                laterAdd(LaterType.RESIZE, () => {
                    this._unmaximize(window);
                    let key = this._windowLocation.get(idOf(window));
                    if (key) {
                        this._resetReasserts(key);
                        this._scheduleApply(key);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        }

        _onMinimizedChanged(window) {
            if (!this._enabled) {
                return;
            }
            let id = idOf(window);
            if (this._scratchpad.includes(id)) {
                // Scratchpad visibility is driven exclusively by the scratchpad commands.
                return;
            }
            if (window.minimized && this._windowLocation.has(id)) {
                // A minimized window would show an empty hole in the layout; pull it out
                // of the tree and give the space to its siblings until it comes back.
                let key = this._windowLocation.get(id);
                this._engines.get(key)?.removeWindow(id);
                this._windowLocation.delete(id);
                let state = this._state.get(id);
                if (state) {
                    state.targetRect = null;
                }
                this._scheduleApply(key);
            } else if (!window.minimized && !this._windowLocation.has(id) && this._state.has(id)) {
                // Coming back from minimization (or skipped at adoption because it was
                // minimized) — give it a tree slot now.
                this._insertMapped(window);
            }
        }

        // --- grabs ------------------------------------------------------------------------------

        _onGrabBegin(window, op) {
            if (!this._enabled || !window || !this.isWindowTiled(window)) {
                return;
            }
            this._grab = { id: idOf(window), op };
        }

        _onGrabEnd(window, op) {
            // A free (non-tiled) window the user just moved/resized: remember where they put
            // it, per app. This is the deliberate "user set this geometry" signal — unlike
            // raw size-changed, it doesn't fire for a window merely opening at its default.
            if (window && !this.isWindowTiled(window)) {
                this._recordFreeGeometry(window);
            }

            let grab = this._grab;
            this._grab = null;
            if (!grab || !window || idOf(window) !== grab.id || !this._enabled) {
                return;
            }
            if (!this.isWindowTiled(window)) {
                return;
            }

            let id = grab.id;
            let key = this._windowLocation.get(id);
            if (!key) {
                return;
            }
            let engine = this._engines.get(key);
            let state = this._state.get(id);
            if (!engine || !state) {
                return;
            }

            if (this._isResizeOp(op)) {
                // The user resized a tiled window: fold the delta into the tree's split
                // ratios (the grabbed frame is the source of truth), then re-flow siblings.
                let f = window.get_frame_rect();
                let target = state.targetRect;
                if (target) {
                    engine.notifyFocused(id);
                    let dw = f.width - target.width;
                    let dh = f.height - target.height;
                    if (dw !== 0) {
                        engine.apply({
                            type: 'resize',
                            mode: dw > 0 ? 'grow' : 'shrink',
                            axis: 'width',
                            amount: Math.abs(dw),
                            unit: 'px',
                        });
                    }
                    if (dh !== 0) {
                        engine.apply({
                            type: 'resize',
                            mode: dh > 0 ? 'grow' : 'shrink',
                            axis: 'height',
                            amount: Math.abs(dh),
                            unit: 'px',
                        });
                    }
                }
            }

            // For moves (v1): the tree still owns placement — snapping back re-asserts it.
            state.targetRect = null;
            this._resetReasserts(key);
            this._scheduleApply(key);
        }

        _isResizeOp(op) {
            // Meta.GrabOp resize values cover the 8 edges/corners plus keyboard resizing;
            // treat everything that isn't a MOVING variant as resize.
            return (
                op !== Meta.GrabOp.MOVING &&
                op !== Meta.GrabOp.KEYBOARD_MOVING &&
                op !== (Meta.GrabOp.MOVING_UNCONSTRAINED ?? -1)
            );
        }

        // --- layout / focus / fullscreen -------------------------------------------------------

        // Optional: move the pointer to the focused tiled window's centre so the mouse
        // follows keyboard focus. Off by default; warping to the same window the pointer
        // already sits in is harmless and can't loop with click-to-focus.
        _warpPointerToFocus(window) {
            if (!this._enabled || !window) {
                return;
            }
            if (!(Settings.tryGetBoolean(Settings.TILING_WARP_POINTER) ?? false)) {
                return;
            }
            if (!this.isWindowTiled(window)) {
                return;
            }
            let r = window.get_frame_rect();
            let seat = Clutter.get_default_backend().get_default_seat();
            seat?.warp_pointer(r.x + Math.floor(r.width / 2), r.y + Math.floor(r.height / 2));
        }

        // --- tiling-restore-app-size: per-app free-mode geometry ------------------------------
        //
        // The store (GeomStore, persisted to ~/.config/gi3/free-geometry.json) holds each app's
        // last FREE-mode geometry, keyed by wm_class. We update it only while a window is
        // genuinely free (never from a tiled window), and re-apply it when the app reopens in
        // free mode — so a tiling session that made the app remember a small tiled size no
        // longer reopens it small.

        _restoreAppSizeEnabled() {
            return Settings.tryGetBoolean(Settings.TILING_RESTORE_APP_SIZE) ?? false;
        }

        /** Record a currently-free window's geometry into the per-app store. */
        _recordFreeGeometry(window) {
            if (!this._restoreAppSizeEnabled() || !this._manageable(window)) {
                return;
            }
            // Skip anything that is (or is becoming) tiled — we only want free geometry.
            if (this._windowLocation.has(idOf(window))) {
                return;
            }
            let cls = window.get_wm_class();
            let f = window.get_frame_rect();
            if (cls && f.width > 1 && f.height > 1) {
                this._geomStore.set(cls, f);
            }
        }

        /** Snapshot every open manageable window's (free) geometry — used just before tiling
         *  reshapes them, so the store reflects the layout the user last had in free mode. */
        _snapshotOpenWindows() {
            if (!this._restoreAppSizeEnabled()) {
                return;
            }
            for (let window of global.display.list_all_windows()) {
                if (this._manageable(window)) {
                    this._recordFreeGeometry(window);
                }
            }
        }

        // Free mode only: reopen a window at its app's stored free-mode geometry. wm_class is
        // only reliable at first-frame, so wait for it.
        _maybeRestoreAppSize(window, actor) {
            if (!this._restoreAppSizeEnabled()) {
                return;
            }
            let firstFrameId = actor.connect('first-frame', () => {
                actor.disconnect(firstFrameId);
                let remembered = this._geomStore.get(window.get_wm_class());
                if (remembered && this._basicManageable(window)) {
                    window.move_resize_frame(true, remembered.x, remembered.y, remembered.width, remembered.height);
                }
            });
        }

        _resetReasserts(key) {
            for (let [id, location] of this._windowLocation) {
                if (location === key) {
                    let state = this._state.get(id);
                    if (state) {
                        state.reasserts = 0;
                        state.posRetries = 0;
                    }
                }
            }
        }

        /** Queue a coalesced apply for one engine key on the RESIZE later phase. */
        _scheduleApply(key) {
            if (!this._isTilingKey(key)) {
                return;
            }
            this._pendingKeys.add(key);
            if (this._applyLaterId !== null) {
                return;
            }
            this._applyLaterId = laterAdd(LaterType.RESIZE, () => {
                this._applyLaterId = null;
                let keys = [...this._pendingKeys];
                this._pendingKeys.clear();
                for (let pendingKey of keys) {
                    this._apply(pendingKey);
                }
                return GLib.SOURCE_REMOVE;
            });
        }

        _scheduleApplyForActiveWorkspace() {
            if (!this._isCurrentTiling()) {
                return;
            }
            let workspaceIndex = global.workspace_manager.get_active_workspace_index();
            let monitorCount = Main.layoutManager.monitors.length;

            for (let monitorIndex = 0; monitorIndex < monitorCount; monitorIndex++) {
                let key = this._keyFor(monitorIndex, workspaceIndex);
                if (this._engines.has(key)) {
                    this._scheduleApply(key);
                }
            }
        }

        /**
         * The single geometry writer. Renders the engine's tree and reconciles every
         * window's frame toward its slot — recording intent (targetRect) BEFORE issuing
         * requests, never repeating an identical request, and never touching windows
         * that are unmapped, grabbed, or fullscreen.
         */
        _apply(key) {
            if (!this._isTilingKey(key)) {
                return;
            }

            let engine = this._engines.get(key);
            if (!engine) {
                return;
            }

            let render = engine.render();
            for (let [id, rect] of render.geometries) {
                let window = this._map.get(id);
                let state = this._state.get(id);
                if (!window || !state || state.unmapped) {
                    continue;
                }
                if (this._grab && this._grab.id === id) {
                    continue;
                }
                if (window.is_fullscreen()) {
                    // Fullscreen is compositor-owned; adopt, don't fight. The tree keeps
                    // its slot for when the window leaves fullscreen.
                    continue;
                }
                if (this._isMaximized(window)) {
                    this._unmaximize(window);
                }

                let f = window.get_frame_rect();
                let reached =
                    f.x === rect.x && f.y === rect.y && f.width === rect.width && f.height === rect.height;
                let hadTarget = state.targetRect;
                let hasNewTarget =
                    !hadTarget ||
                    hadTarget.x !== rect.x ||
                    hadTarget.y !== rect.y ||
                    hadTarget.width !== rect.width ||
                    hadTarget.height !== rect.height;

                // Intent before action: the async ack must find the target already set.
                state.targetRect = copyRect(rect);

                if (reached) {
                    state.posRetries = 0;
                    state.animFrom = null;
                    // Already in place (e.g. a re-adopted window): nothing will ack,
                    // so reveal here if this was a first placement.
                    this._reveal(window, this._state.get(id));
                    continue;
                }

                // Remember where the window is now so the ack can slide it in visually.
                state.animFrom = animationsEnabled() ? copyRect(f) : null;

                // Reset the re-fill budget whenever the slot size changes (independent of
                // position, which targetRect/hasNewTarget also tracks).
                let slotSizeChanged =
                    !state.refillTarget ||
                    state.refillTarget.width !== rect.width ||
                    state.refillTarget.height !== rect.height;
                if (slotSizeChanged) {
                    state.refills = 0;
                    state.refillTarget = { width: rect.width, height: rect.height };
                }

                let sizeDiffers = f.width !== rect.width || f.height !== rect.height;
                if (sizeDiffers) {
                    // The window is smaller than its slot along an axis by more than the
                    // terminal cell-snap: it can grow to fill, so it's worth re-requesting
                    // even if we already asked (rescues windows clamped to their min during a
                    // transient overcrowd, then never regrown once slots widened). Bounded by
                    // MAX_REFILLS so a window that truly can't grow is adopted, not fought.
                    let underfillsReachableSlot =
                        rect.width - f.width > SIZE_FILL_TOLERANCE ||
                        rect.height - f.height > SIZE_FILL_TOLERANCE;
                    if (hasNewTarget) {
                        window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
                    } else if (underfillsReachableSlot && state.refills < MAX_REFILLS) {
                        state.refills += 1;
                        window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
                    }
                    // Otherwise: we already asked for exactly this and the client declined at a
                    // size it won't grow past — do not repeat the identical configure (no ping-pong).
                } else {
                    window.move_frame(true, rect.x, rect.y);
                }
            }
        }

        _syncFocusToShell(key) {
            let engine = this._engines.get(key);
            let id = engine?.focusedWindowId();
            if (!id) {
                return;
            }

            let window = this._map.get(id);
            let active = global.display.focus_window;
            if (!window || (active && idOf(active) === id)) {
                return;
            }

            // Activation goes through the IDLE later phase so Mutter's own focus
            // bookkeeping for the triggering event completes first. This path only runs when a
            // keybind command moved the tree's focus, so warping the pointer here (and not in
            // _onActivated) makes the mouse follow keyboard focus changes but never click-focus.
            this._laterIdle(() => {
                if (this._map.has(id)) {
                    Main.activateWindow(window);
                    this._warpPointerToFocus(window);
                }
            });
        }

        _laterIdle(callback) {
            let laterId = laterAdd(LaterType.IDLE, () => {
                this._idleLaterIds.delete(laterId);
                callback();
                return GLib.SOURCE_REMOVE;
            });
            this._idleLaterIds.add(laterId);
        }

        _isMaximized(window) {
            return window.maximized_horizontally || window.maximized_vertically;
        }

        _unmaximize(window) {
            if (!this._isMaximized(window)) {
                return;
            }
            unmaximizeWindow(window);
        }

        _fullscreenWindowId(engine) {
            return engine.workspace.fullscreen ? engine.workspace.fullscreen.windowId : null;
        }

        _syncFullscreen(engine, beforeId) {
            let afterId = this._fullscreenWindowId(engine);
            if (beforeId === afterId) {
                return;
            }

            if (beforeId) {
                this._map.get(beforeId)?.unmake_fullscreen();
            }
            if (afterId) {
                this._map.get(afterId)?.make_fullscreen();
            }
        }

        _handleIntent(intent) {
            switch (intent.type) {
                case 'kill':
                    this._map.get(intent.windowId)?.delete(global.get_current_time());
                    return;
                case 'switchWorkspace': {
                    let workspace = this._workspaceFor(intent.workspace);
                    if (workspace) {
                        let active = global.workspace_manager.get_active_workspace();
                        if (workspace.index() !== active.index()) {
                            workspace.activate(global.get_current_time());
                        }
                    }
                    return;
                }
                case 'moveToWorkspace': {
                    let workspace = this._workspaceFor(intent.workspace);
                    let window = this._map.get(intent.windowId);
                    if (workspace && window) {
                        window.change_workspace(workspace);
                        this._routeWindow(window);
                    }
                    return;
                }
                case 'reload':
                    this.reloadFromSettings();
                    return;
                case 'scratchpadShow':
                    this._scratchpadShow();
                    return;
                case 'moveScratchpad':
                    this._moveToScratchpad(intent.windowId);
                    return;
            }
        }

        // --- scratchpad -----------------------------------------------------------------------

        _snapshotScratchpadRects() {
            let snapshot = {};
            for (let id of this._scratchpad) {
                if (id === this._scratchpadVisibleId) {
                    this._rememberScratchpadRect(id, this._map.get(id));
                }
                let rect = this._scratchpadRects.get(id);
                if (rect) {
                    snapshot[id] = copyRect(rect);
                }
            }
            return snapshot;
        }

        _rememberScratchpadRect(id, window) {
            if (!window) {
                return;
            }
            let rect = window.get_frame_rect();
            if (this._isValidRect(rect)) {
                this._scratchpadRects.set(id, copyRect(rect));
            }
        }

        _resolvedScratchpadRect(id) {
            return resolveFloatingRect(this._scratchpadRects.get(id), this._currentOutputRect());
        }

        _placeScratchpadWindow(id, window, rect) {
            let state = this._state.get(id);
            if (state) {
                state.targetRect = copyRect(rect);
            }
            window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
        }

        /** Number of windows currently stashed in the scratchpad (shown one included). */
        scratchpadCount() {
            return this._scratchpad.length;
        }

        /** Live scratchpad windows in their current show/cycle order. */
        scratchpadWindows() {
            return this._scratchpad.map((id) => this._map.get(id)).filter(Boolean);
        }

        /** Whether a scratchpad window is currently shown. */
        isScratchpadVisible() {
            return this._scratchpadVisibleId !== null;
        }

        /** The visible scratchpad window, when it is also the compositor-focused window. */
        _activeScratchpadWindow() {
            if (!this._scratchpadVisibleId) {
                return null;
            }
            let active = global.display.focus_window;
            if (!active || idOf(active) !== this._scratchpadVisibleId) {
                return null;
            }
            return this._map.get(this._scratchpadVisibleId) ?? null;
        }

        /** `move scratchpad`: pull the window out of its tree and hide it. Any number of
         *  windows can be stashed (i3-style); `scratchpad show` cycles through them. */
        _moveToScratchpad(windowId) {
            let window = this._map.get(windowId);
            if (!window || this._scratchpad.includes(windowId)) {
                return;
            }

            let key = this._windowLocation.get(windowId);
            if (key) {
                this._engines.get(key)?.removeWindow(windowId);
                this._windowLocation.delete(windowId);
            }
            let state = this._state.get(windowId);
            if (state) {
                state.targetRect = null;
            }

            // Moving a window to the scratchpad is also a hide operation. Capture its
            // current frame now so the very first summon restores it instead of falling
            // back to the centered default.
            this._rememberScratchpadRect(windowId, window);
            this._scratchpad.push(windowId);
            window.minimize();

            if (key) {
                this._scheduleApply(key);
            }
            this._notifyStateChanged();
        }

        /** Pull a window out of the scratchpad and back onto the current workspace. */
        _bringFromScratchpad(id) {
            let window = this._map.get(id);
            this._dropFromScratchpad(id);
            if (!window) {
                return;
            }
            window.change_workspace(global.workspace_manager.get_active_workspace());
            if (window.minimized) {
                // On a tiling workspace, unminimizing re-inserts it into the tree via
                // _onMinimizedChanged (it's no longer a scratchpad member); on a free one
                // it just comes back at its frame rect.
                window.unminimize();
            } else if (this._isCurrentTiling()) {
                // A currently-shown scratchpad window is floating outside every tree; tile it.
                this._insertMapped(window);
            }
            if (!this._isCurrentTiling()) {
                // Free workspace: it returns as a normal floating window the tiler doesn't
                // manage — stop tracking it (adoption re-tracks it if it later lands on a
                // tiling workspace).
                this._untrack(id);
            }
            this._laterIdle(() => {
                // The window may have just been untracked, so gauge liveness by its actor,
                // not map membership.
                if (window.get_compositor_private()) {
                    Main.activateWindow(window);
                }
            });
            this._notifyStateChanged();
        }

        /** `scratchpad show`: toggle the front scratchpad window in and out of view;
         *  hiding rotates it to the back, so repeated toggles cycle through all members. */
        _scratchpadShow() {
            if (this._scratchpadVisibleId) {
                this._hideScratchpad();
                return;
            }

            // Drop entries whose window disappeared without an unmanaged signal.
            while (this._scratchpad.length > 0 && !this._map.has(this._scratchpad[0])) {
                let staleId = this._scratchpad.shift();
                this._scratchpadRects.delete(staleId);
            }

            let id = this._scratchpad[0];
            let window = id !== undefined ? this._map.get(id) : undefined;
            if (id === undefined || !window) {
                return;
            }

            let rect = this._resolvedScratchpadRect(id);
            window.change_workspace(global.workspace_manager.get_active_workspace());
            window.unminimize();
            this._placeScratchpadWindow(id, window, rect);
            this._laterIdle(() => {
                if (this._map.has(id)) {
                    Main.activateWindow(window);
                }
            });

            this._scratchpadVisibleId = id;
            Settings.setBoolean(Settings.SCRATCHPAD_VISIBLE, true);
            this._notifyStateChanged();
        }

        /** Cycle directly to the next scratchpad window: swap the shown one for the next
         *  member in a single press (unlike `scratchpad show`, whose toggle needs a hide
         *  beat in between). With nothing shown it acts like show. */
        _scratchpadCycle() {
            if (!this._scratchpadVisibleId) {
                this._scratchpadShow();
                return;
            }
            if (this._scratchpad.length <= 1) {
                return; // sole member already shown: nothing to cycle to
            }
            this._hideScratchpad(); // rotates the hidden window to the back
            this._scratchpadShow();
        }

        _hideScratchpad() {
            let id = this._scratchpadVisibleId;
            this._scratchpadVisibleId = null;
            Settings.setBoolean(Settings.SCRATCHPAD_VISIBLE, false);

            if (!id) {
                return;
            }

            let window = this._map.get(id);
            if (window) {
                this._rememberScratchpadRect(id, window);
                window.minimize();
            }

            // Rotate the hidden window to the back so the next show cycles to another member.
            let index = this._scratchpad.indexOf(id);
            if (index >= 0) {
                this._scratchpad.splice(index, 1);
                this._scratchpad.push(id);
            }
            this._notifyStateChanged();
        }

        _dropFromScratchpad(id) {
            let index = this._scratchpad.indexOf(id);
            if (index >= 0) {
                this._scratchpad.splice(index, 1);
            }
            this._scratchpadRects.delete(id);
            if (this._scratchpadVisibleId === id) {
                this._scratchpadVisibleId = null;
                Settings.setBoolean(Settings.SCRATCHPAD_VISIBLE, false);
            }
            this._notifyStateChanged();
        }

        _currentOutputRect() {
            let workspace = global.workspace_manager.get_active_workspace();
            let monitorIndex = global.display.get_current_monitor();
            return screenHelper.getMonitorWorkArea(workspace, monitorIndex);
        }

        // --- engines / keys -------------------------------------------------------------------

        _currentKey() {
            let focused = global.display.focus_window;
            if (focused) {
                let key = this._windowLocation.get(idOf(focused));
                if (key) {
                    return key;
                }
            }

            let monitorIndex = global.display.get_current_monitor();
            let workspaceIndex = global.workspace_manager.get_active_workspace_index();
            return this._keyFor(monitorIndex, workspaceIndex);
        }

        _keyFor(monitorIndex, workspaceIndex) {
            return `${monitorIndex}:${workspaceIndex}`;
        }

        _keyForWindow(window) {
            let monitorIndex = window.get_monitor();
            let workspaceIndex = window.get_workspace()?.index() ?? global.workspace_manager.get_active_workspace_index();
            return this._keyFor(monitorIndex, workspaceIndex);
        }

        _outputForKey(key) {
            let [monitorIndex, workspaceIndex] = key.split(':').map(Number);
            let workspace = global.workspace_manager.get_workspace_by_index(workspaceIndex);
            let monitorCount = Main.layoutManager.monitors.length;
            if (
                !Number.isInteger(monitorIndex) ||
                !Number.isInteger(workspaceIndex) ||
                monitorIndex < 0 ||
                monitorIndex >= monitorCount ||
                !workspace
            ) {
                return null;
            }
            return screenHelper.getMonitorWorkArea(workspace, monitorIndex);
        }

        _engineFor(key) {
            let engine = this._engines.get(key);
            if (!engine) {
                let [monitorIndex, workspaceIndex] = key.split(':').map(Number);
                let workspace = global.workspace_manager.get_workspace_by_index(workspaceIndex);
                let output = screenHelper.getMonitorWorkArea(workspace, monitorIndex);

                engine = new Engine(output, this._layoutOptions());
                this._engines.set(key, engine);
            }
            // A reused engine (emptied by a prior untile) keeps its old root layout, so a
            // since-changed default orientation would be ignored — the classic "toggled to
            // vertical but it still tiles horizontally". Re-seeding every time the root is
            // empty makes the invariant hold for ALL insertion paths (adopt, map, minimize
            // return, cross-workspace move, scratchpad), not just the ones that remember to.
            if (engine.workspace.root.children.length === 0) {
                this._applyDefaultLayout(engine);
            }
            return engine;
        }

        _applyDefaultLayout(engine) {
            let layout = Settings.tryGetString(Settings.TILING_DEFAULT_LAYOUT);
            if (layout && LAYOUT_CYCLE_ORDER.includes(layout)) {
                engine.workspace.root.layout = layout;
            }
        }

        _layoutOptions() {
            return {
                innerGap: Settings.tryGetInteger(Settings.TILING_GAPS_INNER) ?? DEFAULT_LAYOUT_OPTIONS.innerGap,
                outerGap: Settings.tryGetInteger(Settings.TILING_GAPS_OUTER) ?? DEFAULT_LAYOUT_OPTIONS.outerGap,
            };
        }

        _workspaceFor(workspaceRef) {
            let n = typeof workspaceRef === 'number' ? workspaceRef : parseInt(workspaceRef, 10);
            if (!Number.isFinite(n) || n < 1) {
                return null;
            }

            while (global.workspace_manager.get_n_workspaces() < n) {
                global.workspace_manager.append_new_workspace(false, global.get_current_time());
            }
            return global.workspace_manager.get_workspace_by_index(n - 1);
        }

        destroy() {
            if (this._applyLaterId !== null) {
                laterRemove(this._applyLaterId);
                this._applyLaterId = null;
            }
            if (this._screenChangeLaterId !== null) {
                laterRemove(this._screenChangeLaterId);
                this._screenChangeLaterId = null;
            }
            for (let laterId of this._idleLaterIds) {
                laterRemove(laterId);
            }
            this._idleLaterIds.clear();

            for (let [key] of this._keybindActions) {
                this._keybinds.removeKeybinding(key);
            }

            for (let signalId of this._displaySignals) {
                global.display.disconnect(signalId);
            }
            global.workspace_manager.disconnect(this._workspaceChangedSignal);
            for (let signalId of this._workspaceLayoutSignals) {
                global.workspace_manager.disconnect(signalId);
            }
            this._workspaceLayoutSignals = [];
            global.backend.get_monitor_manager().disconnect(this._monitorsChangedSignal);
            this._loginManager?.disconnect(this._prepareForSleepSignal);
            this._loginManager = null;
            Settings.reference?.disconnect(this._modeSettingSignal);

            for (let id of this._map.ids()) {
                this._untrack(id);
            }
            this._map.clear();
            this._engines.clear();
            this._windowLocation.clear();
            this._scratchpadRects.clear();

            this._conflicts.destroy();
            this._conflicts = null;
            this._geomStore?.destroy();
            this._geomStore = null;
            this._stateListeners = [];

            this._screenChangeSessionState = null;
            this._keybinds = null;
        }
    }
);
