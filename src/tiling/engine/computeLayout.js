// The pure, total, deterministic core: a workspace tree + an output rect -> the geometry
// every window should occupy. No compositor API, no side effects.

import { isLeaf } from './tree.js';

/** @typedef {{x:number,y:number,width:number,height:number}} Rect */

/**
 * @typedef {object} LayoutOptions
 * @property {number} innerGap Space between adjacent windows, px (Sway `gaps inner`).
 * @property {number} outerGap Extra space at the screen edge, px (Sway `gaps outer`).
 */

/** @type {LayoutOptions} */
export const DEFAULT_LAYOUT_OPTIONS = {
    innerGap: 0,
    outerGap: 0,
};

/** A floating window with no saved geometry defaults to half the output size, centered. */
export const DEFAULT_FLOAT_RATIO = 0.5;

/**
 * @typedef {object} LayoutResult
 * @property {Map<string, Rect>} geometries windowId -> geometry to apply.
 */

/**
 * Gap model (documented + tested):
 *   - the workspace is inset by `outerGap` on all sides;
 *   - within a split, adjacent children are separated by exactly `innerGap`;
 *   - so between-window spacing is `innerGap` and screen-edge spacing is `outerGap`.
 * (The i3-gaps "outer adds to inner" quirk is intentionally not modelled yet.)
 *
 * @param {import('./tree.js').Workspace} ws
 * @param {Rect} outputRect
 * @param {LayoutOptions} [options]
 * @returns {LayoutResult}
 */
export function computeLayout(ws, outputRect, options = DEFAULT_LAYOUT_OPTIONS) {
    const sink = { geometries: new Map(), opt: options };

    // Fullscreen wins over everything and covers the whole output.
    if (ws.fullscreen) {
        sink.geometries.set(ws.fullscreen.windowId, { ...outputRect });
        return { geometries: sink.geometries };
    }

    const area = inset(outputRect, options.outerGap);
    if (ws.root.children.length > 0) {
        layoutNode(ws.root, area, sink);
    }

    // Floating layer: each floats at its own rect (or centered default), clamped to output.
    for (const f of ws.floating) {
        sink.geometries.set(f.windowId, resolveFloatingRect(f.floatRect, outputRect));
    }

    return { geometries: sink.geometries };
}

function layoutNode(node, rect, sink) {
    if (isLeaf(node)) {
        sink.geometries.set(node.windowId, rect);
        return;
    }
    const c = node;
    if (c.children.length === 0) return;

    switch (c.layout) {
        case 'splith':
            layoutSplit(c, rect, 'horizontal', sink);
            break;
        case 'splitv':
            layoutSplit(c, rect, 'vertical', sink);
            break;
    }
}

function layoutSplit(c, rect, orientation, sink) {
    const n = c.children.length;
    const gap = sink.opt.innerGap;
    const horizontal = orientation === 'horizontal';
    const total = (horizontal ? rect.width : rect.height) - gap * (n - 1);
    const sumFrac = c.children.reduce((s, ch) => s + ch.fraction, 0) || 1;

    let cursor = horizontal ? rect.x : rect.y;
    c.children.forEach((child, i) => {
        const isLast = i === n - 1;
        // Avoid cumulative rounding drift: the last child takes whatever remains.
        const extent = isLast
            ? (horizontal ? rect.x + rect.width : rect.y + rect.height) - cursor
            : Math.round((child.fraction / sumFrac) * total);
        const childRect = horizontal
            ? { x: cursor, y: rect.y, width: extent, height: rect.height }
            : { x: rect.x, y: cursor, width: rect.width, height: extent };
        layoutNode(child, childRect, sink);
        cursor += extent + gap;
    });
}

function inset(r, m) {
    return {
        x: r.x + m,
        y: r.y + m,
        width: Math.max(0, r.width - m * 2),
        height: Math.max(0, r.height - m * 2),
    };
}

/** A rect `ratio` the size of `output`, centered within it (the default floating geometry). */
export function centered(output, ratio) {
    const width = Math.round(output.width * ratio);
    const height = Math.round(output.height * ratio);
    return {
        x: output.x + Math.round((output.width - width) / 2),
        y: output.y + Math.round((output.height - height) / 2),
        width,
        height,
    };
}

/** Restore saved floating geometry safely, falling back to the centered default. */
export function resolveFloatingRect(savedRect, output) {
    return clampToOutput(savedRect ?? centered(output, DEFAULT_FLOAT_RATIO), output);
}

function clampToOutput(r, output) {
    const width = Math.min(r.width, output.width);
    const height = Math.min(r.height, output.height);
    return {
        x: Math.max(output.x, Math.min(r.x, output.x + output.width - width)),
        y: Math.max(output.y, Math.min(r.y, output.y + output.height - height)),
        width,
        height,
    };
}
