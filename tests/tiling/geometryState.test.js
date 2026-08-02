import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setTargetRect } from '../../src/tiling/geometryState.js';

const OLD_TARGET = { x: 500, y: 0, width: 500, height: 500 };

describe('window geometry target state', () => {
    it('resets an exhausted position-repair budget for a changed slot', () => {
        const state = { targetRect: OLD_TARGET, posRetries: 2 };
        const nextTarget = { x: 500, y: 250, width: 500, height: 250 };

        const changed = setTargetRect(state, nextTarget);

        assert.equal(changed, true);
        assert.equal(state.posRetries, 0);
        assert.deepEqual(state.targetRect, nextTarget);
        assert.notEqual(state.targetRect, nextTarget);
    });

    it('preserves the bounded retry count when the target is unchanged', () => {
        const state = { targetRect: OLD_TARGET, posRetries: 2 };

        const changed = setTargetRect(state, { ...OLD_TARGET });

        assert.equal(changed, false);
        assert.equal(state.posRetries, 2);
    });

    it('starts a fresh position-repair budget when only the slot size changes', () => {
        const state = { targetRect: OLD_TARGET, posRetries: 2 };

        const changed = setTargetRect(state, { ...OLD_TARGET, height: 250 });

        assert.equal(changed, true);
        assert.equal(state.posRetries, 0);
    });
});
