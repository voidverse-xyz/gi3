// The i3/Sway container tree.
//
// PURE: no compositor API, no I/O. A workspace owns an implicit root split container; containers
// hold either child containers or window leaves. Each child carries a `fraction` of its
// parent's primary axis, and each container remembers which child was focused last
// (per-container focus history, exactly as i3 does).

/** @typedef {string} NodeId */

/** @typedef {"splith"|"splitv"} Layout Container layout: splith tiles side by side, splitv stacks top to bottom. */

/** @typedef {"horizontal"|"vertical"} Orientation */

/** @typedef {Container|WindowLeaf} Node */

/** @param {Layout} layout */
export function orientationOf(layout) {
    return layout === 'splitv' ? 'vertical' : 'horizontal';
}

export class WindowLeaf {
    kind = 'leaf';
    /** @type {Container|null} */
    parent = null;
    /** Share of the parent container's primary axis (siblings sum to 1). */
    fraction = 1;
    /** @type {string[]} */
    marks = [];
    /** Geometry to use while floating (null until first floated). @type {{x:number,y:number,width:number,height:number}|null} */
    floatRect = null;

    /** @param {string} windowId */
    constructor(windowId) {
        this.windowId = windowId;
    }
}

export class Container {
    kind = 'container';
    /** @type {Container|null} */
    parent = null;
    fraction = 1;
    /** @type {Node[]} */
    children = [];
    /** Index of the most-recently-focused child (i3 per-container focus history). */
    focusedChildIndex = 0;

    /**
     * @param {NodeId} id
     * @param {Layout} layout
     */
    constructor(id, layout) {
        this.id = id;
        this.layout = layout;
    }
}

/** @param {Node} n @returns {n is Container} */
export function isContainer(n) {
    return n.kind === 'container';
}

/** @param {Node} n @returns {n is WindowLeaf} */
export function isLeaf(n) {
    return n.kind === 'leaf';
}

/** A workspace: one tiling tree plus a flat floating layer (the i3 model). */
export class Workspace {
    /** @type {WindowLeaf[]} */
    floating = [];
    /** Window shown fullscreen over the whole output, if any. @type {WindowLeaf|null} */
    fullscreen = null;
    /**
     * The focused node. i3 lets focus rest on a *container* (after `focus parent`), not only
     * a leaf, which changes what subsequent layout/split/move commands target. Layout
     * computation still derives the visible leaf from per-container focusedChildIndex.
     * @type {Node|null}
     */
    focus = null;

    /**
     * @param {string} name
     * @param {Container} root
     */
    constructor(name, root) {
        this.name = name;
        this.root = root;
    }
}

// ---------------------------------------------------------------------------------------
// Low-level tree mutations. These keep parent pointers and fraction sums consistent.
// ---------------------------------------------------------------------------------------

/** Below this, a remaining-share denominator is treated as zero (fall back to equal shares). */
const FRACTION_EPSILON = 1e-9;

/** Insert `child` into `parent` at `index`, scaling siblings so fractions still sum to 1. */
export function insertChild(parent, child, index) {
    const n = parent.children.length;
    child.parent = parent;
    if (n === 0) {
        child.fraction = 1;
        parent.children.push(child);
        return;
    }
    // New child takes an equal 1/(n+1) share; existing children keep their relative ratios.
    const share = 1 / (n + 1);
    const scale = n / (n + 1);
    for (const c of parent.children) c.fraction *= scale;
    child.fraction = share;
    parent.children.splice(Math.max(0, Math.min(index, n)), 0, child);
}

/** Append `child` to `parent`. */
export function appendChild(parent, child) {
    insertChild(parent, child, parent.children.length);
}

/** Remove `node` from its parent, redistributing its fraction to the remaining siblings. */
export function detach(node) {
    const parent = node.parent;
    if (!parent) return;
    const idx = parent.children.indexOf(node);
    if (idx < 0) return;
    const focusedChild = parent.children[parent.focusedChildIndex] ?? null;
    parent.children.splice(idx, 1);
    node.parent = null;

    const remaining = parent.children;
    if (remaining.length > 0) {
        const freed = node.fraction;
        const denom = 1 - freed;
        // Preserve relative ratios; if numerically degenerate, fall back to equal shares.
        if (denom > FRACTION_EPSILON) {
            for (const c of remaining) c.fraction /= denom;
        } else {
            for (const c of remaining) c.fraction = 1 / remaining.length;
        }
    }

    // Preserve focus on the same surviving child when an earlier sibling leaves. If the
    // focused child itself left, prefer the child that took its slot, then the previous one.
    if (focusedChild && focusedChild !== node) {
        parent.focusedChildIndex = remaining.indexOf(focusedChild);
    } else {
        parent.focusedChildIndex = Math.max(0, Math.min(idx, remaining.length - 1));
    }
}

/** Replace `oldNode` with `newNode` in place, inheriting its fraction and slot. */
export function replaceNode(oldNode, newNode) {
    const parent = oldNode.parent;
    if (!parent) return;
    const idx = parent.children.indexOf(oldNode);
    if (idx < 0) return;
    newNode.parent = parent;
    newNode.fraction = oldNode.fraction;
    parent.children[idx] = newNode;
    oldNode.parent = null;
}

export function indexOf(node) {
    return node.parent ? node.parent.children.indexOf(node) : -1;
}

/**
 * Clean up the ancestry of a detach site by pruning empty non-root containers. Containers
 * with one child deliberately remain: their orientation records where the next window should
 * open, and keeping a sole root child prevents the root from unexpectedly adopting its layout.
 */
export function cleanupAfterDetach(start) {
    let container = start;
    while (container) {
        const parent = container.parent;
        if (container.children.length === 0 && parent) {
            detach(container);
        }
        container = parent;
    }
}

// ---------------------------------------------------------------------------------------
// Focus helpers (per-container focus history).
// ---------------------------------------------------------------------------------------

/** Point the focus-history chain from `root` down to `node` (updating focusedChildIndex). */
export function setFocus(node) {
    let cur = node;
    while (cur.parent) {
        const parent = cur.parent;
        parent.focusedChildIndex = parent.children.indexOf(cur);
        cur = parent;
    }
}

/** Descend from `node` following focusedChildIndex to a leaf (returns node itself if leaf). */
export function descendFocus(node) {
    let cur = node;
    while (isContainer(cur)) {
        const idx = Math.min(cur.focusedChildIndex, cur.children.length - 1);
        cur = cur.children[idx];
    }
    return cur;
}

/** Set the workspace's focused node and align the focus-history path to it. */
export function setWorkspaceFocus(ws, node) {
    ws.focus = node;
    if (node) setFocus(node);
}

/** Find the leaf wrapping `windowId` anywhere in the tiling tree, or null. */
export function findLeaf(root, windowId) {
    const stack = [root];
    while (stack.length) {
        const n = stack.pop();
        if (isLeaf(n)) {
            if (n.windowId === windowId) return n;
        } else {
            for (const c of n.children) stack.push(c);
        }
    }
    return null;
}
