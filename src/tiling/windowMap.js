// Window-id bookkeeping shared by the tiling adapter. No policy, just lookup tables.

/** @param {Meta.Rectangle} geometry @returns {import('./engine/computeLayout.js').Rect} */
export function copyRect(geometry) {
    return {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
    };
}

/** @param {Meta.Window} window */
export function idOf(window) {
    return String(window.get_id());
}

export class WindowMap {
    /** @type {Map<string, Meta.Window>} */
    _byId = new Map();
    /** @type {Map<string, import('./engine/computeLayout.js').Rect>} */
    _original = new Map();

    add(window) {
        const windowId = idOf(window);
        this._byId.set(windowId, window);
        if (!this._original.has(windowId)) {
            this._original.set(windowId, copyRect(window.get_frame_rect()));
        }
    }

    /**
     * Overwrite the remembered "original" rect. Windows tracked before their first frame
     * report a tiny bogus frame rect (~313x110), so the adapter re-captures the real natural
     * size at first-frame; otherwise untiling/turning tiling off shrinks them to that bogus
     * size.
     */
    setOriginal(windowId, rect) {
        if (this._byId.has(windowId)) {
            this._original.set(windowId, rect);
        }
    }

    remove(windowId) {
        this._byId.delete(windowId);
        this._original.delete(windowId);
    }

    get(windowId) {
        return this._byId.get(windowId);
    }

    has(windowId) {
        return this._byId.has(windowId);
    }

    ids() {
        return Array.from(this._byId.keys());
    }

    windows() {
        return Array.from(this._byId.values());
    }

    originalOf(windowId) {
        return this._original.get(windowId);
    }

    clear() {
        this._byId.clear();
        this._original.clear();
    }
}
