// The engine facade. Holds a single workspace's tree and an output rect, applies Commands by
// delegating to the pure ops, and renders the current geometry via computeLayout. The Mutter
// adapter (tricks/tiler.js) is the only caller that turns the rendered geometry into actual
// window placement.

import {
    centered,
    computeLayout,
    DEFAULT_FLOAT_RATIO,
    DEFAULT_LAYOUT_OPTIONS,
} from './computeLayout.js';
import {
    focusChild,
    focusDirection,
    focusParent,
    insertWindow,
    moveDirection,
    removeWindow,
    resize,
    setFloating,
    setLayout,
    splitContainer,
    toggleFloating,
    toggleFullscreen,
    toggleSplitLayout,
} from './ops.js';
import {
    Container,
    descendFocus,
    findLeaf,
    isContainer,
    orientationOf,
    setWorkspaceFocus,
    WindowLeaf,
    Workspace,
} from './tree.js';

// The i3/Sway command vocabulary, as a discriminated union. This is the single command model
// used both by imported config keybindings and by live execution. Commands that the layout
// engine can't fulfil on its own (kill, workspace switching) surface as Intents.
//
// @typedef {
//   {type: "focus", dir: import('./ops.js').Direction} |
//   {type: "focusParent"} |
//   {type: "focusChild"} |
//   {type: "focusModeToggle"} |
//   {type: "move", dir: import('./ops.js').Direction} |
//   {type: "moveToWorkspace", workspace: string|number} |
//   {type: "resize", mode: "grow"|"shrink", axis: import('./ops.js').ResizeAxis, amount: number, unit: "ppt"|"px"} |
//   {type: "split", orientation: "horizontal"|"vertical"} |
//   {type: "layout", layout: import('./tree.js').Layout} |
//   {type: "layoutToggleSplit"} |
//   {type: "floatingToggle"} |
//   {type: "setFloating", floating: boolean} |
//   {type: "fullscreen"} |
//   {type: "kill"} |
//   {type: "workspace", workspace: string|number} |
//   {type: "scratchpadShow"} |
//   {type: "moveScratchpad"} |
//   {type: "reload"} |
//   {type: "nop"}
// } Command
//
// @typedef {
//   {type: "kill", windowId: string} |
//   {type: "switchWorkspace", workspace: string|number} |
//   {type: "moveToWorkspace", windowId: string, workspace: string|number} |
//   {type: "scratchpadShow"} |
//   {type: "moveScratchpad", windowId: string} |
//   {type: "reload"}
// } Intent

/** Fallback resize step (5%) used when a px resize can't be converted (window size unknown). */
const FALLBACK_RESIZE_PPT = 0.05;

const SNAPSHOT_VERSION = 1;

/** Convert a tree node into plain data with no compositor or runtime references. */
function snapshotNode(node) {
    if (!isContainer(node)) {
        return {
            kind: 'leaf',
            windowId: node.windowId,
            fraction: node.fraction,
            marks: [...node.marks],
            floatRect: node.floatRect ? { ...node.floatRect } : null,
        };
    }

    return {
        kind: 'container',
        id: node.id,
        layout: node.layout,
        fraction: node.fraction,
        focusedChildIndex: node.focusedChildIndex,
        children: node.children.map(snapshotNode),
    };
}

/** Rebuild parent pointers while turning a plain snapshot back into a tree node. */
function restoreNode(state, parent = null) {
    if (state.kind === 'leaf') {
        const leaf = new WindowLeaf(state.windowId);
        leaf.parent = parent;
        leaf.fraction = state.fraction;
        leaf.marks = Array.isArray(state.marks) ? [...state.marks] : [];
        leaf.floatRect = state.floatRect ? { ...state.floatRect } : null;
        return leaf;
    }

    const container = new Container(state.id, state.layout);
    container.parent = parent;
    container.fraction = state.fraction;
    container.children = state.children.map((child) => restoreNode(child, container));
    container.focusedChildIndex = Math.max(0, Math.min(state.focusedChildIndex, container.children.length - 1));
    return container;
}

function nodeReference(node) {
    if (!node) return null;
    return isContainer(node)
        ? { kind: 'container', id: node.id }
        : { kind: 'leaf', windowId: node.windowId };
}

function findReferencedNode(workspace, reference) {
    if (!reference) return null;
    if (reference.kind === 'leaf') {
        return (
            findLeaf(workspace.root, reference.windowId) ??
            workspace.floating.find((leaf) => leaf.windowId === reference.windowId) ??
            null
        );
    }

    const stack = [workspace.root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (isContainer(node) && node.id === reference.id) return node;
        if (isContainer(node)) stack.push(...node.children);
    }
    return null;
}

function tiledWindowIds(root) {
    const ids = [];
    const stack = [root];
    while (stack.length > 0) {
        const node = stack.pop();
        if (isContainer(node)) {
            stack.push(...node.children);
        } else {
            ids.push(node.windowId);
        }
    }
    return ids;
}

function snapshotContainers(rootState) {
    const containers = new Map();
    const stack = [rootState];
    while (stack.length > 0) {
        const node = stack.pop();
        if (node?.kind !== 'container') continue;
        containers.set(node.id, node);
        stack.push(...node.children);
    }
    return containers;
}

function focusedWindowIdFromSnapshot(containerState) {
    let node = containerState;
    while (node?.kind === 'container' && node.children.length > 0) {
        let index = Math.max(0, Math.min(node.focusedChildIndex, node.children.length - 1));
        node = node.children[index];
    }
    return node?.kind === 'leaf' ? node.windowId : null;
}

function childContainingWindow(container, windowId) {
    return container.children.findIndex((child) =>
        isContainer(child) ? findLeaf(child, windowId) !== null : child.windowId === windowId
    );
}

export class Engine {
    conCounter = 0;
    /** @type {import('./ops.js').OpContext} */
    ctx = { newContainerId: () => `con-${++this.conCounter}` };
    /** @type {import('./computeLayout.js').LayoutResult|null} */
    lastRender = null;

    /**
     * @param {import('./computeLayout.js').Rect} output
     * @param {import('./computeLayout.js').LayoutOptions} [options]
     */
    constructor(output, options = { ...DEFAULT_LAYOUT_OPTIONS }) {
        this.output = output;
        this.options = options;

        const root = new Container('root', 'splith');
        this.workspace = new Workspace('1', root);
    }

    // --- window lifecycle (driven by shell signals) ------------------------------------

    addWindow(windowId) {
        return insertWindow(this.workspace, windowId);
    }

    removeWindow(windowId) {
        removeWindow(this.workspace, windowId);
    }

    /** Every window represented by this engine, including its floating layer. */
    windowIds() {
        return [...tiledWindowIds(this.workspace.root), ...this.workspace.floating.map((leaf) => leaf.windowId)];
    }

    /**
     * Capture the pure layout state across a GNOME lock/unlock disable cycle. The snapshot is
     * deliberately JSON-compatible so it cannot retain MetaWindow or shell-object references.
     */
    snapshotState() {
        const workspace = this.workspace;
        return {
            version: SNAPSHOT_VERSION,
            conCounter: this.conCounter,
            workspace: {
                name: workspace.name,
                root: snapshotNode(workspace.root),
                floating: workspace.floating.map(snapshotNode),
                focus: nodeReference(workspace.focus),
                fullscreen: nodeReference(workspace.fullscreen),
            },
        };
    }

    /** Recreate an engine from snapshotState() using the output's current work area. */
    static fromStateSnapshot(output, state, options = { ...DEFAULT_LAYOUT_OPTIONS }) {
        if (state?.version !== SNAPSHOT_VERSION || state.workspace?.root?.kind !== 'container') {
            return new Engine(output, options);
        }

        const engine = new Engine(output, options);
        const root = restoreNode(state.workspace.root);
        const workspace = new Workspace(state.workspace.name, root);
        workspace.floating = Array.isArray(state.workspace.floating)
            ? state.workspace.floating
                .filter((node) => node?.kind === 'leaf')
                .map((node) => restoreNode(node))
            : [];
        workspace.focus = findReferencedNode(workspace, state.workspace.focus);
        workspace.fullscreen = findReferencedNode(workspace, state.workspace.fullscreen);

        engine.conCounter = Number.isInteger(state.conCounter) ? state.conCounter : 0;
        engine.workspace = workspace;
        return engine;
    }

    /**
     * Restore snapshot focus after reconciliation added or removed windows. Each surviving
     * container follows the same focused descendant as before, even if a branch was pruned.
     */
    restoreFocusFromStateSnapshot(state) {
        if (state?.version !== SNAPSHOT_VERSION || state.workspace?.root?.kind !== 'container') {
            return;
        }

        const savedContainers = snapshotContainers(state.workspace.root);
        const stack = [this.workspace.root];
        while (stack.length > 0) {
            const container = stack.pop();
            const saved = savedContainers.get(container.id);
            const focusedWindowId = saved ? focusedWindowIdFromSnapshot(saved) : null;
            if (focusedWindowId) {
                const index = childContainingWindow(container, focusedWindowId);
                if (index >= 0) container.focusedChildIndex = index;
            }
            for (const child of container.children) {
                if (isContainer(child)) stack.push(child);
            }
        }

        const focus = findReferencedNode(this.workspace, state.workspace.focus);
        if (focus) setWorkspaceFocus(this.workspace, focus);
    }

    /** An external focus change (the shell activated a window) - sync the tree's focus to it. */
    notifyFocused(windowId) {
        const leaf =
            findLeaf(this.workspace.root, windowId) ??
            this.workspace.floating.find((f) => f.windowId === windowId) ??
            null;
        if (leaf) setWorkspaceFocus(this.workspace, leaf);
    }

    focusedWindowId() {
        const ws = this.workspace;
        const leaf = ws.focus ? descendFocus(ws.focus) : ws.root.children.length ? descendFocus(ws.root) : null;
        return leaf ? leaf.windowId : null;
    }

    // --- command execution --------------------------------------------------------------

    /**
     * Apply a command, returning any Intents the adapter must carry out.
     * @param {Command} command
     * @returns {Intent[]}
     */
    apply(command) {
        const ws = this.workspace;
        switch (command.type) {
            case 'focus':
                focusDirection(ws, command.dir);
                return [];
            case 'focusParent':
                focusParent(ws);
                return [];
            case 'focusChild':
                focusChild(ws);
                return [];
            case 'focusModeToggle':
                this._focusModeToggle();
                return [];
            case 'move':
                moveDirection(this.ctx, ws, command.dir);
                return [];
            case 'split':
                splitContainer(this.ctx, ws, command.orientation);
                return [];
            case 'layout':
                setLayout(ws, command.layout);
                return [];
            case 'layoutToggleSplit':
                toggleSplitLayout(ws);
                return [];
            case 'resize':
                resize(ws, command.axis, this._resizePpt(command));
                return [];
            case 'floatingToggle':
                toggleFloating(ws, this._defaultFloatRect());
                return [];
            case 'setFloating':
                setFloating(ws, this._defaultFloatRect(), command.floating);
                return [];
            case 'fullscreen':
                toggleFullscreen(ws);
                return [];
            case 'kill': {
                const id = this.focusedWindowId();
                return id ? [{ type: 'kill', windowId: id }] : [];
            }
            case 'moveToWorkspace': {
                const id = this.focusedWindowId();
                return id ? [{ type: 'moveToWorkspace', windowId: id, workspace: command.workspace }] : [];
            }
            case 'workspace':
                return [{ type: 'switchWorkspace', workspace: command.workspace }];
            case 'scratchpadShow':
                return [{ type: 'scratchpadShow' }];
            case 'moveScratchpad': {
                const id = this.focusedWindowId();
                return id ? [{ type: 'moveScratchpad', windowId: id }] : [];
            }
            case 'reload':
                return [{ type: 'reload' }];
            case 'nop':
                return [];
            default:
                return [];
        }
    }

    // --- rendering ----------------------------------------------------------------------

    render() {
        const result = computeLayout(this.workspace, this.output, this.options);
        this.lastRender = result;
        return { ...result, focusWindowId: this.focusedWindowId() };
    }

    /**
     * Orientation of the container that a new split/window would land in (the focused
     * container, or the focused leaf's parent) — drives the top-bar split-direction icon.
     * @returns {'horizontal'|'vertical'|null}
     */
    focusedOrientation() {
        const node = this.workspace.focus;
        const container = node ? (isContainer(node) ? node : node.parent) : null;
        return container ? orientationOf(container.layout) : null;
    }

    // --- helpers ------------------------------------------------------------------------

    _resizePpt(cmd) {
        const sign = cmd.mode === 'grow' ? 1 : -1;
        if (cmd.unit === 'ppt') return sign * cmd.amount;
        // Convert px → ppt using the focused window's last-rendered size along the axis.
        const id = this.focusedWindowId();
        const geo = id ? this.lastRender?.geometries.get(id) : undefined;
        const span = geo ? (cmd.axis === 'width' ? geo.width : geo.height) : 0;
        const ppt = span > 0 ? cmd.amount / span : FALLBACK_RESIZE_PPT;
        return sign * ppt;
    }

    _focusModeToggle() {
        const ws = this.workspace;
        const focusedLeaf = ws.focus && !isContainer(ws.focus) ? ws.focus : null;
        const isFloating = focusedLeaf ? ws.floating.includes(focusedLeaf) : false;
        if (isFloating) {
            // Focus the tiling tree.
            if (ws.root.children.length) setWorkspaceFocus(ws, descendFocus(ws.root));
        } else if (ws.floating.length) {
            setWorkspaceFocus(ws, ws.floating[ws.floating.length - 1]);
        }
    }

    _defaultFloatRect() {
        return centered(this.output, DEFAULT_FLOAT_RATIO);
    }
}
