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

    it('preserves topology and split ratios when the monitor work area changes', () => {
        const options = { innerGap: 0, outerGap: 0 };
        const engine = new Engine(OUTPUT, options);
        engine.addWindow('a');
        engine.addWindow('b');
        engine.apply({ type: 'split', orientation: 'vertical' });
        engine.addWindow('c');

        engine.notifyFocused('b');
        engine.apply({ type: 'resize', mode: 'grow', axis: 'height', amount: 0.15, unit: 'ppt' });
        engine.notifyFocused('a');
        engine.apply({ type: 'resize', mode: 'grow', axis: 'width', amount: 0.1, unit: 'ppt' });

        const snapshot = JSON.parse(JSON.stringify(engine.snapshotState()));
        const resumedOutput = { x: 100, y: 50, width: 1600, height: 900 };
        const restored = Engine.fromStateSnapshot(resumedOutput, snapshot, options);
        const geometries = restored.render().geometries;

        assert.equal(tree(restored), 'H[a V[b c]]');
        assert.deepEqual(restored.snapshotState(), snapshot);
        assert.ok(geometries.get('a').width > geometries.get('b').width);
        assert.ok(geometries.get('b').height > geometries.get('c').height);
        for (const rect of geometries.values()) {
            assert.ok(rect.x >= resumedOutput.x);
            assert.ok(rect.y >= resumedOutput.y);
            assert.ok(rect.x + rect.width <= resumedOutput.x + resumedOutput.width);
            assert.ok(rect.y + rect.height <= resumedOutput.y + resumedOutput.height);
        }
    });
});
