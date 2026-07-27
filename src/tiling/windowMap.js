// Window-id bookkeeping shared by the tiling adapter. No policy, just lookup tables.

/** @param {Meta.Rectangle} g @returns {import('./engine/computeLayout.js').Rect} */
export function copyRect(g) {
    return { x: g.x, y: g.y, width: g.width, height: g.height };
}

/** @param {Meta.Window} w */
export function idOf(w) {
    return String(w.get_id());
}

export class WindowMap {
    /** @type {Map<string, Meta.Window>} */
    _byId = new Map();
    /** @type {Map<string, import('./engine/computeLayout.js').Rect>} */
    _original = new Map();

    add(w) {
        const id = idOf(w);
        this._byId.set(id, w);
        if (!this._original.has(id)) this._original.set(id, copyRect(w.get_frame_rect()));
    }

    /**
     * Overwrite the remembered "original" rect. Windows tracked before their first frame
     * report a tiny bogus frame rect (~313x110), so the adapter re-captures the real natural
     * size at first-frame; otherwise untiling/turning tiling off shrinks them to that bogus
     * size.
     */
    setOriginal(id, rect) {
        if (this._byId.has(id)) this._original.set(id, rect);
    }

    remove(id) {
        this._byId.delete(id);
        this._original.delete(id);
    }

    get(id) {
        return this._byId.get(id);
    }

    has(id) {
        return this._byId.has(id);
    }

    ids() {
        return Array.from(this._byId.keys());
    }

    windows() {
        return Array.from(this._byId.values());
    }

    originalOf(id) {
        return this._original.get(id);
    }

    clear() {
        this._byId.clear();
        this._original.clear();
    }
}
