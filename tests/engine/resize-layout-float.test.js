import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, floating, tree } from './helpers.js';

function assertCloseTo(actual, expected, epsilon = 1e-5) {
    assert.ok(
        Math.abs(actual - expected) < epsilon,
        `expected ${actual} to be close to ${expected}`
    );
}

describe('resize', () => {
    it('grows the focused pane and shrinks its neighbour (ppt)', () => {
        const e = makeEngine('a', 'b'); // 0.5 / 0.5
        e.notifyFocused('a');
        e.apply({ type: 'resize', mode: 'grow', axis: 'width', amount: 0.1, unit: 'ppt' });
        const [a, b] = e.workspace.root.children;
        assertCloseTo(a.fraction, 0.6);
        assertCloseTo(b.fraction, 0.4);
    });

    it('converts px to ppt using the last-rendered size', () => {
        const e = makeEngine('a', 'b'); // each 500px wide on a 1000px output
        e.render(); // populate last-rendered geometry
        e.notifyFocused('a');
        e.apply({ type: 'resize', mode: 'grow', axis: 'width', amount: 50, unit: 'px' });
        const [a] = e.workspace.root.children;
        // 50px of a 500px pane = +0.1
        assertCloseTo(a.fraction, 0.6);
    });
});

describe('layout toggle', () => {
    it('toggles the focused container between splith and splitv', () => {
        const e = makeEngine('a', 'b');
        assert.equal(e.workspace.root.layout, 'splith');
        e.apply({ type: 'layoutToggleSplit' });
        assert.equal(e.workspace.root.layout, 'splitv');
        assert.equal(tree(e), 'V[a b]');
    });
});

describe('floating', () => {
    it('removes from the tiling tree and reflows, then re-tiles on toggle back', () => {
        const e = makeEngine('a', 'b', 'c');
        e.notifyFocused('b');
        e.apply({ type: 'floatingToggle' });
        assert.equal(tree(e), 'H[a c]');
        assert.deepEqual(floating(e), ['b']);
        assert.equal(e.focusedWindowId(), 'b');

        e.apply({ type: 'floatingToggle' }); // back to tiling at the root tail
        assert.equal(tree(e), 'H[a c b]');
        assert.deepEqual(floating(e), []);
    });
});

describe('floating focus interactions', () => {
    it('tiles a new window into the tree while a floating window is focused', () => {
        const e = makeEngine('a', 'b');
        e.notifyFocused('b');
        e.apply({ type: 'floatingToggle' }); // b floats and keeps focus
        assert.deepEqual(floating(e), ['b']);

        e.addWindow('c'); // must join the tiling tree, not crash on the floating leaf
        assert.equal(tree(e), 'H[a c]');
        assert.equal(e.focusedWindowId(), 'c');
    });

    it('refocuses a remaining floating window when the focused floating window closes', () => {
        const e = makeEngine('a');
        e.apply({ type: 'floatingToggle' }); // a floats; tree is empty
        e.addWindow('b');
        e.apply({ type: 'floatingToggle' }); // b floats too
        e.removeWindow('b');
        assert.equal(e.focusedWindowId(), 'a');
    });

    it('refocuses a floating window when the last tiled window closes', () => {
        const e = makeEngine('a', 'b');
        e.notifyFocused('a');
        e.apply({ type: 'floatingToggle' }); // a floats
        e.removeWindow('b'); // tree is now empty; focus falls back to the floating layer
        assert.equal(tree(e), '(empty)');
        assert.equal(e.focusedWindowId(), 'a');
    });
});
