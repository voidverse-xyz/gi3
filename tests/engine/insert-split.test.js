import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, tree } from './helpers.js';

describe('insertion & split (i3 tree_open / tree_split)', () => {
    it('opens windows as siblings in the default horizontal root', () => {
        const e = makeEngine();
        assert.equal(tree(e), '(empty)');
        e.addWindow('a');
        assert.equal(tree(e), 'H[a]');
        e.addWindow('b');
        assert.equal(tree(e), 'H[a b]');
        assert.equal(e.focusedWindowId(), 'b');
    });

    it('inserts a new window immediately after the focused one', () => {
        const e = makeEngine('a', 'b', 'c'); // focus c
        e.notifyFocused('a'); // focus a
        e.addWindow('x');
        assert.equal(tree(e), 'H[a x b c]');
        assert.equal(e.focusedWindowId(), 'x');
    });

    it('canonical: [a b], split v on b, open c → H[a V[b c]]', () => {
        const e = makeEngine('a', 'b'); // focus b
        e.apply({ type: 'split', orientation: 'vertical' });
        e.addWindow('c');
        assert.equal(tree(e), 'H[a V[b c]]');
        assert.equal(e.focusedWindowId(), 'c');
    });

    it("split on the only child retargets the parent's orientation (no new nesting)", () => {
        const e = makeEngine('a'); // a is the sole child of root
        e.apply({ type: 'split', orientation: 'vertical' });
        assert.equal(tree(e), 'V[a]');
        e.addWindow('b');
        assert.equal(tree(e), 'V[a b]');
    });

    it('nested split: [a b], split v on b, open c, split h on c, open d', () => {
        const e = makeEngine('a', 'b');
        e.apply({ type: 'split', orientation: 'vertical' });
        e.addWindow('c'); // H[a V[b c]]
        e.apply({ type: 'split', orientation: 'horizontal' });
        e.addWindow('d');
        assert.equal(tree(e), 'H[a V[b H[c d]]]');
    });
});
