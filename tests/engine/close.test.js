import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, tree } from './helpers.js';

describe('close / remove (preserve split intent)', () => {
    it('keeps a one-window split so the next window reuses its orientation', () => {
        const e = makeEngine('a', 'b');
        e.apply({ type: 'split', orientation: 'vertical' });
        e.addWindow('c');
        assert.equal(tree(e), 'H[a V[b c]]');

        e.removeWindow('c');
        assert.equal(tree(e), 'H[a V[b]]');
        assert.equal(e.focusedWindowId(), 'b');

        e.addWindow('d');
        assert.equal(tree(e), 'H[a V[b d]]');
    });

    it('removes the now-empty container chain when the last inner window closes', () => {
        // H[a V[b]] (split then nothing else), close b → empty V pruned → H[a]
        const e = makeEngine('a', 'b');
        e.apply({ type: 'split', orientation: 'vertical' }); // wraps b → H[a V[b]]
        e.removeWindow('b');
        assert.equal(tree(e), 'H[a]');
        assert.equal(e.focusedWindowId(), 'a');
    });

    it('closing the last window empties the workspace', () => {
        const e = makeEngine('a');
        e.removeWindow('a');
        assert.equal(tree(e), '(empty)');
        assert.equal(e.focusedWindowId(), null);
    });

    it('re-tiles siblings after a middle window closes', () => {
        const e = makeEngine('a', 'b', 'c');
        e.removeWindow('b');
        assert.equal(tree(e), 'H[a c]');
    });
});

describe('close with container focus', () => {
    it('keeps focus on a surviving one-window split', () => {
        const e = makeEngine('a', 'b');
        e.apply({ type: 'split', orientation: 'vertical' });
        e.addWindow('c'); // H[a V[b c]], c focused
        e.apply({ type: 'focusParent' }); // focus V
        e.removeWindow('c');

        assert.equal(tree(e), 'H[a V[b]]');
        assert.equal(e.workspace.focus.kind, 'container');
        assert.equal(e.focusedWindowId(), 'b');

        e.apply({ type: 'focus', dir: 'left' });
        assert.equal(e.focusedWindowId(), 'a');
    });

    it('clears root-container focus when its last window closes', () => {
        const e = makeEngine('a');
        e.apply({ type: 'focusParent' });
        e.removeWindow('a');

        assert.equal(tree(e), '(empty)');
        assert.equal(e.focusedWindowId(), null);
    });
});
