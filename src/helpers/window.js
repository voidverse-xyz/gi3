import Meta from 'gi://Meta';
import Direction from '../enums/direction.js';
import { rankDirectionCandidates } from './geometry.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function getFocusedWindow() {
    let window = global.display.get_focus_window();

    return initalizeWindow(window);
}

export function initalizeWindow(window) {
    let size = window.get_frame_rect();
    let actor = window.get_compositor_private();
    let workspace = window.get_workspace();
    let monitor = window.get_monitor();

    return {
        ref: window,
        size: size,
        actor: actor,
        workspace: workspace,
        monitor: monitor,
    };
}

/**
 * Windows the directional tricks (focus/snap/switch/center) should consider: normal,
 * visible windows. Minimized or hidden windows used to leak in here, which made focus
 * jump to invisible windows and snapping stop against ghosts.
 */
function _isCandidateWindow(metaWindow) {
    return (
        metaWindow.get_window_type() === Meta.WindowType.NORMAL &&
        !metaWindow.minimized &&
        metaWindow.showing_on_its_workspace()
    );
}

export function getWindowsInWorkspace(workspace, monitorIndex = null) {
    let windowObjects = workspace.list_windows();

    let windows = [];
    for (let window of windowObjects) {
        if (monitorIndex !== null && window.get_monitor() !== monitorIndex) {
            continue;
        }
        if (!_isCandidateWindow(window)) {
            continue;
        }

        windows.push({
            ref: window,
            size: window.get_frame_rect(),
        });
    }

    return windows;
}

// GNOME Shell 49 dropped the Meta.MaximizeFlags argument from unmaximize();
// try the current no-arg signature first and fall back for 46-48.
function unmaximize(metaWindow) {
    try {
        metaWindow.unmaximize();
    } catch (e) {
        metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
    }
}

export function resizeWindow(window, size) {
    unmaximize(window.ref);
    window.ref.move_frame(false, size.x, size.y);
    window.ref.move_resize_frame(false, size.x, size.y, size.width, size.height);
}

export function focusWindow(window) {
    Main.activateWindow(window.ref);
}

export function getNearbyWindows(window, direction, options = {}) {
    let windows = _getWindowsOnMonitor(window, window.monitor, direction);
    if (windows.length > 0 || !options.crossMonitor) {
        return windows;
    }

    let adjacentMonitor = _findAdjacentMonitor(direction, window.monitor);
    if (adjacentMonitor === null) {
        return [];
    }

    let monitorWindows = getWindowsInWorkspace(window.workspace, adjacentMonitor);
    return _rankWindows(direction, window, monitorWindows);
}

function _getWindowsOnMonitor(window, monitorIndex, direction) {
    let windows = getWindowsInWorkspace(window.workspace, monitorIndex)
        .filter((other) => other.ref !== window.ref);

    return _rankWindows(direction, window, windows);
}

/** Directional candidate ranking (see geometry.js for the rules and their rationale). */
function _rankWindows(direction, window, windows) {
    return rankDirectionCandidates(
        direction,
        window.size,
        windows.map((w) => ({ ...w, rect: w.size })),
    );
}

function _findAdjacentMonitor(direction, monitorIndex) {
    let monitors = Main.layoutManager.monitors;
    let current = monitors[monitorIndex];

    let candidates = monitors
        .map((monitor, index) => ({ monitor, index }))
        .filter(({ monitor, index }) => index !== monitorIndex && _isBeyond(direction, current, monitor));

    if (candidates.length === 0) {
        return null;
    }

    let overlapping = candidates.filter(({ monitor }) => _perpendicularOverlap(direction, current, monitor));
    let pool = overlapping.length > 0 ? overlapping : candidates;

    return pool.reduce((closest, candidate) =>
        _monitorGap(direction, current, candidate.monitor) < _monitorGap(direction, current, closest.monitor)
            ? candidate
            : closest
    ).index;
}

function _isBeyond(direction, current, other) {
    switch (direction) {
        case Direction.Right:
            return other.x >= current.x + current.width;
        case Direction.Left:
            return other.x + other.width <= current.x;
        case Direction.Down:
            return other.y >= current.y + current.height;
        case Direction.Up:
            return other.y + other.height <= current.y;
    }
    return false;
}

function _perpendicularOverlap(direction, current, other) {
    if (Direction.isVertical(direction)) {
        return other.x < current.x + current.width && other.x + other.width > current.x;
    }
    return other.y < current.y + current.height && other.y + other.height > current.y;
}

function _monitorGap(direction, current, other) {
    switch (direction) {
        case Direction.Right:
            return other.x - (current.x + current.width);
        case Direction.Left:
            return current.x - (other.x + other.width);
        case Direction.Down:
            return other.y - (current.y + current.height);
        case Direction.Up:
            return current.y - (other.y + other.height);
    }
    return 0;
}
