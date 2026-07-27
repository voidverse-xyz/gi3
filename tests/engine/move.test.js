import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, tree } from './helpers.js';
import { Engine } from '../../src/tiling/engine/engine.js';

describe('move (swap / into / pop-out)', () => {
    it('swaps with a leaf sibling', () => {
        const e = makeEngine('a', 'b', 'c');
        e.notifyFocused('b');
        e.apply({ type: 'move', dir: 'right' });
        assert.equal(tree(e), 'H[a c b]');
        assert.equal(e.focusedWindowId(), 'b');
        e.apply({ type: 'move', dir: 'left' });
        assert.equal(tree(e), 'H[a b c]');
    });

    it('moves into an adjacent container without changing the root orientation', () => {
        const e = makeEngine('a', 'b');
        e.apply({ type: 'split', orientation: 'vertical' });
        e.addWindow('c');
        e.notifyFocused('a');
        e.apply({ type: 'move', dir: 'right' });
        assert.equal(tree(e), 'H[V[a b c]]');
        assert.equal(e.focusedWindowId(), 'a');

        e.notifyFocused('c');
        e.apply({ type: 'move', dir: 'right' });
        assert.equal(tree(e), 'H[V[a b] c]');
        assert.equal(e.focusedWindowId(), 'c');
    });

    it('moves across a perpendicular root edge in every direction', () => {
        const cases = [
            { root: 'vertical', dir: 'right', expected: 'H[V[a b] c]' },
            { root: 'vertical', dir: 'left', expected: 'H[c V[a b]]' },
            { root: 'horizontal', dir: 'down', expected: 'V[H[a b] c]' },
            { root: 'horizontal', dir: 'up', expected: 'V[c H[a b]]' },
        ];

        for (const { root, dir, expected } of cases) {
            const e = makeEngine('a');
            if (root === 'vertical') {
                e.apply({ type: 'split', orientation: 'vertical' });
            }
            e.addWindow('b');
            e.addWindow('c');
            e.apply({ type: 'move', dir });
            assert.equal(tree(e), expected, `move ${dir} from a ${root} root`);
            assert.equal(e.focusedWindowId(), 'c');
        }
    });

    it('pops a window out while preserving the vacated split', () => {
        const e = makeEngine('a', 'b');
        e.apply({ type: 'split', orientation: 'vertical' });
        e.addWindow('c');
        e.notifyFocused('b');
        e.apply({ type: 'move', dir: 'right' });
        assert.equal(tree(e), 'H[a V[c] b]');
        assert.equal(e.focusedWindowId(), 'b');
    });

    it('a window popped out of a nested split takes an equal share, not its old fraction', () => {
        // Regression: b sat in a 2-pane vertical split (fraction 0.5). Moving it out to the
        // root row used to carry that 0.5 over, so b rendered ~2x its new siblings.
        const e = new Engine({ x: 0, y: 0, width: 900, height: 900 }, { innerGap: 0, outerGap: 0 });
        e.addWindow('a');
        e.addWindow('b');
        e.apply({ type: 'split', orientation: 'vertical' }); // H[a V[b]]
        e.addWindow('c');                                    // H[a V[b c]]
        e.notifyFocused('b');
        e.apply({ type: 'move', dir: 'right' });             // H[a V[c] b]
        assert.equal(tree(e), 'H[a V[c] b]');
        const g = e.render().geometries;
        assert.equal(g.get('a').width, 300);
        assert.equal(g.get('b').width, 300);
        assert.equal(g.get('c').width, 300);
    });
});
