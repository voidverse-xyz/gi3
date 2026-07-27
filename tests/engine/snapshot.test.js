import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Engine } from '../../src/tiling/engine/engine.js';
import { tree } from './helpers.js';

const OUTPUT = { x: 0, y: 0, width: 1000, height: 800 };
const OPTIONS = { innerGap: 8, outerGap: 12 };

describe('engine state snapshots', () => {
    it('round-trips nested splits, fractions, focus, fullscreen, and floating windows', () => {
        const engine = new Engine(OUTPUT, OPTIONS);
        engine.addWindow('a');
        engine.addWindow('b');
        engine.apply({ type: 'split', orientation: 'vertical' });
        engine.addWindow('c');
        engine.addWindow('d');
        engine.apply({ type: 'floatingToggle' });
        engine.notifyFocused('c');
        engine.apply({ type: 'resize', mode: 'grow', axis: 'height', amount: 0.1, unit: 'ppt' });
        engine.notifyFocused('b');
        engine.apply({ type: 'fullscreen' });
        engine.apply({ type: 'focusParent' });

        const snapshot = JSON.parse(JSON.stringify(engine.snapshotState()));
        const restored = Engine.fromStateSnapshot(OUTPUT, snapshot, OPTIONS);

        assert.equal(tree(restored), 'H[a V[b c]]');
        assert.deepEqual(new Set(restored.windowIds()), new Set(['a', 'b', 'c', 'd']));
        assert.equal(restored.workspace.focus.kind, 'container');
        assert.equal(restored.workspace.fullscreen.windowId, 'b');
        assert.deepEqual(restored.workspace.floating.map((leaf) => leaf.windowId), ['d']);
        assert.deepEqual(restored.snapshotState(), snapshot);
        assert.notEqual(restored.workspace.root, engine.workspace.root);
    });

    it('keeps a restored tree valid when windows disappear before re-adoption', () => {
        const engine = new Engine(OUTPUT, OPTIONS);
        engine.addWindow('a');
        engine.addWindow('b');
        engine.apply({ type: 'split', orientation: 'vertical' });
        engine.addWindow('c');

        const restored = Engine.fromStateSnapshot(OUTPUT, engine.snapshotState(), OPTIONS);
        restored.removeWindow('b');

        assert.equal(tree(restored), 'H[a V[c]]');
        assert.equal(restored.focusedWindowId(), 'c');
        assert.deepEqual(new Set(restored.windowIds()), new Set(['a', 'c']));
    });

    it('preserves container focus history when an earlier stale sibling is pruned', () => {
        const engine = new Engine(OUTPUT, OPTIONS);
        engine.addWindow('a');
        engine.addWindow('b');
        engine.addWindow('c');
        engine.notifyFocused('b');
        engine.apply({ type: 'focusParent' });

        const restored = Engine.fromStateSnapshot(OUTPUT, engine.snapshotState(), OPTIONS);
        restored.removeWindow('a');

        assert.equal(restored.workspace.focus.kind, 'container');
        assert.equal(restored.focusedWindowId(), 'b');
        assert.equal(tree(restored), 'H[b c]');
    });

    it('restores snapshot focus after a newly adopted window changes it', () => {
        const engine = new Engine(OUTPUT, OPTIONS);
        engine.addWindow('a');
        engine.addWindow('b');
        engine.apply({ type: 'split', orientation: 'vertical' });
        engine.addWindow('c');
        engine.apply({ type: 'focusParent' });

        const snapshot = engine.snapshotState();
        const restored = Engine.fromStateSnapshot(OUTPUT, snapshot, OPTIONS);
        restored.addWindow('new');
        restored.restoreFocusFromStateSnapshot(snapshot);

        assert.equal(tree(restored), 'H[a V[b c new]]');
        assert.equal(restored.workspace.focus.kind, 'container');
        assert.equal(restored.focusedWindowId(), 'c');
    });
});
