// i3/Sway-faithful tree operations. Pure: each mutates the workspace tree in place and
// (where relevant) updates focus. No compositor API, no geometry - geometry is derived afterwards by
// computeLayout. Operation semantics are modelled on i3's tree.c / move.c behaviours.

import {
    appendChild,
    cleanupAfterDetach,
    Container,
    descendFocus,
    detach,
    findLeaf,
    indexOf,
    insertChild,
    isContainer,
    orientationOf,
    replaceNode,
    setWorkspaceFocus,
    WindowLeaf,
} from './tree.js';

/** @typedef {"left"|"right"|"up"|"down"} Direction */
/** @typedef {"width"|"height"} ResizeAxis */

/** A pane is never resized below this fraction (5%) of its container along the split axis. */
const MIN_PANE_FRACTION = 0.05;

/**
 * Supplies fresh container ids so operations stay pure (no global counters).
 * @typedef {object} OpContext
 * @property {() => import('./tree.js').NodeId} newContainerId
 */

/** @param {Direction} dir */
function orientationOfDirection(dir) {
    return dir === 'left' || dir === 'right' ? 'horizontal' : 'vertical';
}

/** The index step toward `dir` within a matching container: +1 for right/down, -1 for left/up. */
function directionStep(dir) {
    return dir === 'right' || dir === 'down' ? 1 : -1;
}

/** The focused node, or (focus unset) the root's focused leaf. Null when the tree is empty. */
function focusNodeOrNull(ws) {
    return ws.focus ?? (ws.root.children.length ? descendFocus(ws.root) : null);
}

/** The container a command targets: the focused container, or a focused leaf's parent. */
function targetContainer(ws) {
    const f = ws.focus;
    if (!f) return ws.root;
    return isContainer(f) ? f : f.parent;
}

// ---------------------------------------------------------------------------------------
// Insertion / removal
// ---------------------------------------------------------------------------------------

/** Open a new window: it becomes a sibling immediately after the focused leaf and is focused. */
export function insertWindow(ws, windowId) {
    const leaf = new WindowLeaf(windowId);
    const focused = tiledFocusLeafOrNull(ws);

    if (!focused) {
        // Empty (or container-focused with no leaves) → attach to the focused container or root.
        const parent = ws.focus && isContainer(ws.focus) ? ws.focus : ws.root;
        appendChild(parent, leaf);
    } else {
        const parent = focused.parent;
        insertChild(parent, leaf, indexOf(focused) + 1);
    }
    setWorkspaceFocus(ws, leaf);
    return leaf;
}

/**
 * The focused leaf *within the tiling tree*. A focused floating leaf has no tree position
 * (its parent is null), so it falls back to the tree's focus path — new windows still tile,
 * as in i3. A focused empty container yields null (insertWindow attaches into it directly).
 */
function tiledFocusLeafOrNull(ws) {
    const f = ws.focus;
    if (f && isContainer(f)) return f.children.length ? descendFocus(f) : null;
    if (f && f.parent) return f; // a tiled leaf
    // No focus, or a floating leaf → follow the tree's focus history.
    return ws.root.children.length ? descendFocus(ws.root) : null;
}

function descendFocusOrNull(ws) {
    if (ws.focus) return descendFocus(ws.focus);
    return ws.root.children.length ? descendFocus(ws.root) : null;
}

/** Close a window: detach its leaf, prune empty containers, and refocus a neighbour. */
export function removeWindow(ws, windowId) {
    // Floating?
    const fi = ws.floating.findIndex((f) => f.windowId === windowId);
    if (fi >= 0) {
        ws.floating.splice(fi, 1);
        if (ws.fullscreen?.windowId === windowId) ws.fullscreen = null;
        if (ws.focus && !isContainer(ws.focus) && ws.focus.windowId === windowId) {
            refocusAfterRemoval(ws);
        }
        return;
    }

    const leaf = findLeaf(ws.root, windowId);
    if (!leaf) return;
    if (ws.fullscreen === leaf) ws.fullscreen = null;

    const parent = leaf.parent;
    const wasFocused =
        ws.focus === leaf || (ws.focus != null && !isContainer(ws.focus) && ws.focus.windowId === windowId);
    detach(leaf);
    cleanupAfterDetach(parent);

    // Refocus along the tree's focus path when the focused leaf was removed, the focused
    // container was pruned, or the focused root became empty.
    const focusDetached = !isAttached(ws, ws.focus);
    const focusContainerEmpty = ws.focus && isContainer(ws.focus) && ws.focus.children.length === 0;
    if (wasFocused || focusDetached || focusContainerEmpty) {
        refocusAfterRemoval(ws);
    }
}

/** After a removal: focus the tree's focus-path leaf, else the most recent floating window. */
function refocusAfterRemoval(ws) {
    const next = ws.root.children.length
        ? descendFocus(ws.root)
        : (ws.floating[ws.floating.length - 1] ?? null);
    setWorkspaceFocus(ws, next);
}

/** Whether `node` still belongs to the workspace: under its root, or in the floating layer. */
function isAttached(ws, node) {
    if (!node) return false;
    let cur = node;
    while (cur.parent) cur = cur.parent;
    return cur === ws.root || (!isContainer(node) && ws.floating.includes(node));
}

// ---------------------------------------------------------------------------------------
// Split / layout
// ---------------------------------------------------------------------------------------

/**
 * `split h|v` (Sway `splith`/`splitv`). i3's tree_split: if the focused node is the only
 * child of its parent split container, just retarget the parent's orientation; otherwise
 * wrap the focused node in a fresh split container.
 *
 * @param {OpContext} ctx
 * @param {import('./tree.js').Workspace} ws
 * @param {"horizontal"|"vertical"} orientation
 */
export function splitContainer(ctx, ws, orientation) {
    const node = focusNodeOrNull(ws);
    if (!node || !node.parent) return;
    const parent = node.parent;
    const targetLayout = orientation === 'horizontal' ? 'splith' : 'splitv';

    if (parent.children.length === 1) {
        parent.layout = targetLayout;
        return;
    }

    const wrapper = new Container(ctx.newContainerId(), targetLayout);
    replaceNode(node, wrapper);
    appendChild(wrapper, node);
    setWorkspaceFocus(ws, node);
}

/** `layout <x>`: set the focused container's layout (parent of a focused leaf). */
export function setLayout(ws, layout) {
    const c = targetContainer(ws);
    if (c) c.layout = layout;
}

/** `layout toggle split`: flip the focused container between splith and splitv. */
export function toggleSplitLayout(ws) {
    const c = targetContainer(ws);
    if (!c) return;
    c.layout = c.layout === 'splith' ? 'splitv' : 'splith';
}

// ---------------------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------------------

/** Focus (and return) the focused leaf beneath `node`, updating the focus-history path. */
function focusLeafUnder(ws, node) {
    const leaf = descendFocus(node);
    setWorkspaceFocus(ws, leaf);
    return leaf;
}

/** `focus <dir>`: i3 escalate-then-descend, with focus_wrapping=yes (default) wrapping. */
export function focusDirection(ws, dir) {
    const start = focusNodeOrNull(ws);
    if (!start) return null;

    const orient = orientationOfDirection(dir);
    const step = directionStep(dir);

    let node = start;
    let innermostMatch = null;
    while (node.parent) {
        const parent = node.parent;
        if (orientationOf(parent.layout) === orient) {
            if (!innermostMatch) innermostMatch = parent;
            const neighbourIdx = parent.children.indexOf(node) + step;
            if (neighbourIdx >= 0 && neighbourIdx < parent.children.length) {
                return focusLeafUnder(ws, parent.children[neighbourIdx]);
            }
        }
        node = parent;
    }

    // Nothing in that direction at any level → wrap within the innermost matching container.
    if (innermostMatch && innermostMatch.children.length > 1) {
        const wrapIdx = step > 0 ? 0 : innermostMatch.children.length - 1;
        return focusLeafUnder(ws, innermostMatch.children[wrapIdx]);
    }
    return descendFocus(start);
}

/** `focus parent`: move focus to the parent container of the focused node. */
export function focusParent(ws) {
    const f = focusNodeOrNull(ws);
    if (f && f.parent) ws.focus = f.parent;
}

/** `focus child`: descend focus into the focused container's focused child. */
export function focusChild(ws) {
    const f = ws.focus;
    if (f && isContainer(f) && f.children.length > 0) {
        ws.focus = f.children[Math.min(f.focusedChildIndex, f.children.length - 1)];
    }
}

// ---------------------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------------------

/**
 * `move <dir>`: relocate the focused node, modelled on i3's tree_move. Walk up from the node:
 *   - at the node's OWN matching container with a sibling in `dir`: swap with a leaf sibling,
 *     or move INTO a container sibling at its entry edge;
 *   - once bubbled up to an OUTER matching container: pop the node out next to its former
 *     branch (this is what lets a window leave an inner split).
 * Orientation-mismatched ancestors are bubbled through. At a perpendicular root edge, the
 * remaining root siblings retain their old orientation while the moved node starts a new row
 * or column, making root-edge moves reversible.
 *
 * @param {OpContext} ctx
 * @param {import('./tree.js').Workspace} ws
 * @param {Direction} dir
 */
export function moveDirection(ctx, ws, dir) {
    const node = focusNodeOrNull(ws);
    if (!node || !node.parent) return;

    const orient = orientationOfDirection(dir);
    const step = directionStep(dir);
    if (moveAcrossPerpendicularRoot(ctx, ws, node, orient, step)) {
        return;
    }

    let branch = node;
    while (branch.parent) {
        const parent = branch.parent;
        if (orientationOf(parent.layout) === orient) {
            const branchIdx = parent.children.indexOf(branch);

            if (branch !== node) {
                // Bubbled up to an outer matching container: pop `node` out beside its former branch.
                const insertAt = step > 0 ? branchIdx + 1 : branchIdx;
                relocateNode(ws, node, parent, insertAt, node.parent);
                return;
            }

            const neighbourIdx = branchIdx + step;
            if (neighbourIdx >= 0 && neighbourIdx < parent.children.length) {
                const neighbour = parent.children[neighbourIdx];
                if (isContainer(neighbour)) {
                    // Move INTO the container neighbour at its entry edge.
                    relocateNode(ws, node, neighbour, step > 0 ? 0 : neighbour.children.length, parent);
                } else {
                    swapSiblings(parent, branchIdx, neighbourIdx);
                    setWorkspaceFocus(ws, node);
                }
                return;
            }
            // At the edge of the node's own container → bubble up to pop out.
        }
        branch = parent;
    }
    // Reached the root edge with nowhere to go: no-op (cross-output move is a later refinement).
}

/**
 * Turn a flat perpendicular root into two branches while preserving its old orientation.
 * Example: moving c right from V[a b c] produces H[V[a b] c].
 */
function moveAcrossPerpendicularRoot(ctx, ws, node, orientation, step) {
    const root = ws.root;
    if (node.parent !== root || root.children.length < 2 || orientationOf(root.layout) === orientation) {
        return false;
    }

    const remaining = new Container(ctx.newContainerId(), root.layout);
    detach(node);

    remaining.children = root.children;
    remaining.focusedChildIndex = root.focusedChildIndex;
    for (const child of remaining.children) {
        child.parent = remaining;
    }

    root.children = [];
    root.focusedChildIndex = 0;
    root.layout = orientation === 'horizontal' ? 'splith' : 'splitv';

    if (step > 0) {
        appendChild(root, remaining);
        appendChild(root, node);
    } else {
        appendChild(root, node);
        appendChild(root, remaining);
    }

    setWorkspaceFocus(ws, node);
    return true;
}

/**
 * Detach `node` and re-insert it into `newParent` at `index`, then tidy the branch it left
 * (`formerParent`) and restore focus to it.
 *
 * The node takes an equal share of its new parent (insertChild rescales the siblings to keep
 * the sum at 1). We deliberately do NOT carry over the old fraction: it was relative to a
 * different container — often on the other axis and with a different child count — so pasting
 * it in leaves the fractions summing to >1 and renders the moved window oversized (a window
 * leaving a 2-pane split arrived at ~2x its new siblings). Equal share matches i3/sway.
 */
function relocateNode(ws, node, newParent, index, formerParent) {
    detach(node);
    insertChild(newParent, node, index);
    cleanupAfterDetach(formerParent);
    setWorkspaceFocus(ws, node);
}

function swapSiblings(parent, i, j) {
    const tmp = parent.children[i];
    parent.children[i] = parent.children[j];
    parent.children[j] = tmp;
    // Keep focus on the moved node by tracking its new index.
    parent.focusedChildIndex = j;
}

// ---------------------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------------------

/**
 * `resize grow|shrink width|height <ppt>`: adjust the focused branch's fraction along the
 * matching axis, borrowing from the adjacent sibling. `ppt` is a fraction of the parent
 * (0..1). Finds the nearest ancestor whose orientation matches the axis.
 *
 * @param {import('./tree.js').Workspace} ws
 * @param {ResizeAxis} axis
 * @param {number} deltaPpt
 */
export function resize(ws, axis, deltaPpt) {
    const node = focusNodeOrNull(ws);
    if (!node) return;
    const wantOrient = axis === 'width' ? 'horizontal' : 'vertical';

    let cur = node;
    while (cur.parent) {
        const parent = cur.parent;
        if (orientationOf(parent.layout) === wantOrient && parent.children.length > 1) {
            const idx = parent.children.indexOf(cur);
            // Borrow from the next sibling if present, else the previous one.
            const neighbourIdx = idx + 1 < parent.children.length ? idx + 1 : idx - 1;
            const a = parent.children[idx];
            const b = parent.children[neighbourIdx];
            const delta = clampDelta(deltaPpt, a.fraction, b.fraction);
            a.fraction += delta;
            b.fraction -= delta;
            return;
        }
        cur = parent;
    }
}

function clampDelta(delta, aFrac, bFrac) {
    if (delta > 0) return Math.min(delta, bFrac - MIN_PANE_FRACTION);
    return Math.max(delta, -(aFrac - MIN_PANE_FRACTION));
}

// ---------------------------------------------------------------------------------------
// Floating / fullscreen
// ---------------------------------------------------------------------------------------

/** The focused leaf, whether it currently lives in the tiling tree or the floating layer. */
function focusedLeafOrNull(ws) {
    if (ws.focus && !isContainer(ws.focus)) return ws.focus;
    return ws.root.children.length ? descendFocus(ws.root) : null;
}

/** `floating toggle`: flip the focused window between tiling and floating. */
export function toggleFloating(ws, defaultRect) {
    const leaf = focusedLeafOrNull(ws);
    if (leaf) setFloating(ws, defaultRect, !ws.floating.includes(leaf));
}

/** `floating enable|disable`: set the focused window's floating state absolutely. */
export function setFloating(ws, defaultRect, floating) {
    const leaf = focusedLeafOrNull(ws);
    if (!leaf) return;
    const currentlyFloating = ws.floating.includes(leaf);
    if (floating && !currentlyFloating) floatLeaf(ws, leaf, defaultRect);
    else if (!floating && currentlyFloating) unfloatLeaf(ws, leaf);
}

function floatLeaf(ws, leaf, defaultRect) {
    const parent = leaf.parent;
    if (parent) {
        detach(leaf);
        cleanupAfterDetach(parent);
    }
    if (!leaf.floatRect && defaultRect) leaf.floatRect = { ...defaultRect };
    ws.floating.push(leaf);
    setWorkspaceFocus(ws, leaf);
}

function unfloatLeaf(ws, leaf) {
    ws.floating.splice(ws.floating.indexOf(leaf), 1);
    appendChild(ws.root, leaf);
    setWorkspaceFocus(ws, leaf);
}

/** `fullscreen`: toggle the focused window as the workspace's fullscreen window. */
export function toggleFullscreen(ws) {
    const leaf = ws.focus && !isContainer(ws.focus) ? ws.focus : descendFocusOrNull(ws);
    if (!leaf) return;
    ws.fullscreen = ws.fullscreen === leaf ? null : leaf;
}
