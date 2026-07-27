import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine } from './helpers.js';

describe('directional focus (escalate / descend / wrap)', () => {
    it('moves between siblings and wraps at the edge (focus_wrapping yes)', () => {
        const e = makeEngine('a', 'b');
        e.notifyFocused('a');
        e.apply({ type: 'focus', dir: 'right' });
        assert.equal(e.focusedWindowId(), 'b');
        e.apply({ type: 'focus', dir: 'left' });
        assert.equal(e.focusedWindowId(), 'a');
        // wrap: left from the leftmost wraps to the rightmost
        e.apply({ type: 'focus', dir: 'left' });
        assert.equal(e.focusedWindowId(), 'b');
        // wrap: right from the rightmost wraps to the leftmost
        e.apply({ type: 'focus', dir: 'right' });
        assert.equal(e.focusedWindowId(), 'a');
    });

    it("escalates out of a nested split then descends into the neighbour's focused leaf", () => {
        // H[a V[b c]] with c focused last (so V's focused child is c)
        const e = makeEngine('a', 'b');
        e.apply({ type: 'split', orientation: 'vertical' });
        e.addWindow('c');

        // vertical navigation inside the inner container
        e.notifyFocused('b');
        e.apply({ type: 'focus', dir: 'down' });
        assert.equal(e.focusedWindowId(), 'c');
        e.apply({ type: 'focus', dir: 'up' });
        assert.equal(e.focusedWindowId(), 'b');

        // horizontal navigation escalates to the root: from b, left lands on a
        e.notifyFocused('b');
        e.apply({ type: 'focus', dir: 'left' });
        assert.equal(e.focusedWindowId(), 'a');

        // from a, right descends into V following ITS focused child: set that to c, then assert
        e.notifyFocused('c'); // V's focused child is now c
        e.notifyFocused('a'); // but the active branch at the root is a
        e.apply({ type: 'focus', dir: 'right' });
        assert.equal(e.focusedWindowId(), 'c');
    });

    it('focus parent then child round-trips, and layout retargets the parent', () => {
        const e = makeEngine('a', 'b'); // H[a b], focus b
        e.apply({ type: 'focusParent' }); // focus the root container
        e.apply({ type: 'layout', layout: 'splitv' }); // retargets the focused container (root)
        assert.equal(e.workspace.root.layout, 'splitv');
        e.apply({ type: 'focusChild' });
        assert.equal(e.focusedWindowId(), 'b');
    });
});
