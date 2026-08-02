// Pure helpers for the Mutter adapter's per-window geometry intent state.

/**
 * Publish a layout target before issuing the corresponding frame request. A changed target
 * starts a fresh bounded position-repair budget; retries spent on an older slot must not block
 * a window from reaching its new slot.
 *
 * @param {{targetRect: import('./engine/computeLayout.js').Rect|null, posRetries: number}} state
 * @param {import('./engine/computeLayout.js').Rect} rect
 * @returns {boolean} whether the target changed
 */
export function setTargetRect(state, rect) {
    let previous = state.targetRect;
    let changed =
        !previous ||
        previous.x !== rect.x ||
        previous.y !== rect.y ||
        previous.width !== rect.width ||
        previous.height !== rect.height;

    if (changed) {
        state.posRetries = 0;
    }
    state.targetRect = { ...rect };

    return changed;
}
