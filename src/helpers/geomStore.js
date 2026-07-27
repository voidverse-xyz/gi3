// Persistent per-app window geometry, keyed by wm_class, saved to
// $XDG_CONFIG_HOME/gi3/free-geometry.json (falls back to ~/.config/gi3/).
//
// Why a file: an app tiled small saves that small size itself, so when it is later
// reopened in free mode it comes back small. We record each app's *free-mode* geometry
// while we can observe it (the tiling adapter feeds us on size/position change and when
// entering tiling) and re-apply it on the next free-mode open — surviving extension
// reloads and the app clobbering its own remembered size during a tiling session.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const FLUSH_DELAY_MS = 1000;

function storePath() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'gi3', 'free-geometry.json']);
}

function sameRect(a, b) {
    return a && b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export class GeomStore {
    constructor() {
        this._path = storePath();
        this._data = {};
        this._flushId = null;
        this._load();
    }

    // Async so constructing the store during enable() never blocks the compositor on disk.
    // The first consumer is a window's first-frame, comfortably after the read completes; a
    // get() racing the load just misses (harmless — same as an unknown app), and a set()
    // racing it wins over the loaded value for its key.
    _load() {
        Gio.File.new_for_path(this._path).load_contents_async(null, (file, res) => {
            try {
                let [ok, contents] = file.load_contents_finish(res);
                if (!ok) {
                    return;
                }
                let obj = JSON.parse(new TextDecoder().decode(contents));
                if (obj && typeof obj === 'object') {
                    this._data = { ...obj, ...this._data };
                }
            } catch {
                // Missing/corrupt file: keep whatever has been set() so far.
            }
        });
    }

    /** @returns {{x:number,y:number,width:number,height:number}|null} */
    get(wmClass) {
        let r = wmClass ? this._data[wmClass] : null;
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    }

    set(wmClass, rect) {
        if (!wmClass || !rect) {
            return;
        }
        if (sameRect(this._data[wmClass], rect)) {
            return;
        }
        this._data[wmClass] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        this._scheduleFlush();
    }

    _scheduleFlush() {
        if (this._flushId) {
            return;
        }
        this._flushId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FLUSH_DELAY_MS, () => {
            this._flushId = null;
            this._flush();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Best effort: a failed write just means we re-learn geometry next session. */
    _flush({ sync = false } = {}) {
        try {
            let file = Gio.File.new_for_path(this._path);
            let parent = file.get_parent();
            if (parent && !parent.query_exists(null)) {
                parent.make_directory_with_parents(null);
            }
            let bytes = new TextEncoder().encode(JSON.stringify(this._data, null, 2));
            if (sync) {
                // Only on destroy: an async write wouldn't survive the extension unloading.
                file.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
                return;
            }
            file.replace_contents_bytes_async(
                new GLib.Bytes(bytes), null, false, Gio.FileCreateFlags.NONE, null,
                (f, res) => {
                    try {
                        f.replace_contents_finish(res);
                    } catch {
                        // Same best-effort contract as the sync path.
                    }
                }
            );
        } catch {
            // Ignored (see above).
        }
    }

    destroy() {
        if (this._flushId) {
            GLib.source_remove(this._flushId);
            this._flushId = null;
            this._flush({ sync: true });
        }
    }
}
