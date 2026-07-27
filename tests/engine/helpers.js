// Test helpers: a compact S-expression rendering of the tree so structural assertions read
// like i3's own layout representation. H=splith, V=splitv; leaves are their window id.
// e.g. `H[a V[b c]]`.

import { Engine } from '../../src/tiling/engine/engine.js';
import { isLeaf } from '../../src/tiling/engine/tree.js';

const TAG = { splith: 'H', splitv: 'V' };

export function repr(node) {
    if (isLeaf(node)) return node.windowId;
    return `${TAG[node.layout]}[${node.children.map(repr).join(' ')}]`;
}

/** Structure of the workspace tiling tree. */
export function tree(engine) {
    const root = engine.workspace.root;
    return root.children.length === 0 ? '(empty)' : repr(root);
}

/** Ids currently in the floating layer, in order. */
export function floating(engine) {
    return engine.workspace.floating.map((f) => f.windowId);
}

/** Build an engine with a 1000x1000 output (overridable) and a sequence of windows added. */
export function makeEngine(...windows) {
    const engine = new Engine({ x: 0, y: 0, width: 1000, height: 1000 });
    for (const w of windows) engine.addWindow(w);
    return engine;
}
