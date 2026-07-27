// Pure rect geometry for directional focus/switch selection and edge snapping.
// No compositor imports - everything works on plain {x, y, width, height} rects,
// so the edge cases live under tests/helpers/geometry.test.js.

import Direction from '../enums/direction.js';

/** Re-snapping tolerance: a stop closer than this to the current position is "already there". */
const EPSILON = 1;

function centerOf(rect) {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Pixels of overlap between the two rects on the axis PERPENDICULAR to `direction`. */
export function perpendicularOverlap(direction, a, b) {
    if (Direction.isVertical(direction)) {
        return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    }
    return Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
}

/** Direction cone slack: a candidate may be off-axis by at most 1.5x its axial distance. */
const CONE_SLACK = 1.5;

/**
 * Whether `candidate`'s center lies beyond `from`'s center toward `direction`, within a
 * generous cone. Without the cone, pressing "up" from a top-edge window could fly to a
 * window whose center is 30px higher but 800px sideways — visually not "up" at all;
 * no-op is the honest answer there.
 */
export function isBeyond(direction, from, candidate) {
    const fc = centerOf(from);
    // A candidate that surrounds our center (we sit inside/on top of it) is visually
    // present in every direction its area extends past ours. Center comparison alone
    // would make a window floating over a bigger one unable to reach it at all.
    if (fc.x >= candidate.x && fc.x <= candidate.x + candidate.width &&
        fc.y >= candidate.y && fc.y <= candidate.y + candidate.height) {
        switch (direction) {
            case Direction.Up: return candidate.y < from.y;
            case Direction.Down: return candidate.y + candidate.height > from.y + from.height;
            case Direction.Left: return candidate.x < from.x;
            case Direction.Right: return candidate.x + candidate.width > from.x + from.width;
        }
    }
    const cc = centerOf(candidate);
    const dx = cc.x - fc.x;
    const dy = cc.y - fc.y;
    const axial = Direction.isVertical(direction) ? dy : dx;
    const perp = Direction.isVertical(direction) ? Math.abs(dx) : Math.abs(dy);
    const forward = direction === Direction.Down || direction === Direction.Right ? axial : -axial;
    return forward > 0 && perp <= forward * CONE_SLACK;
}

/** Gap from `from`'s leading edge to `candidate`'s facing edge (clamped at 0 when they interleave). */
function axialGap(direction, from, candidate) {
    switch (direction) {
        case Direction.Up: return Math.max(0, from.y - (candidate.y + candidate.height));
        case Direction.Down: return Math.max(0, candidate.y - (from.y + from.height));
        case Direction.Left: return Math.max(0, from.x - (candidate.x + candidate.width));
        case Direction.Right: return Math.max(0, candidate.x - (from.x + from.width));
    }
    return 0;
}

function perpendicularCenterDistance(direction, a, b) {
    const ca = centerOf(a);
    const cb = centerOf(b);
    return Direction.isVertical(direction) ? Math.abs(cb.x - ca.x) : Math.abs(cb.y - ca.y);
}

/**
 * Order candidate entries for a directional focus/switch from `fromRect`.
 *
 * Ranking (the fix for "focus jumps to a diagonal window"):
 *   1. perpendicular-overlap tier: SUBSTANTIAL overlap (at least half the smaller of the
 *      two spans) beats sliver overlap beats none. Binary overlap wasn't enough: a window
 *      50px into the band with a marginally closer edge used to beat one sitting directly
 *      in the path;
 *   2. within the substantial tier the candidates are squarely in the path, so the nearer
 *      facing edge wins (NOT the candidate's far edge, which biased selection toward
 *      narrow windows) and alignment only breaks ties;
 *   3. within the sliver/no-overlap tiers nothing is really "in the path", so rank by
 *      combined distance (edge gap + perpendicular center offset): a window 100px away
 *      but 800px off-axis must not beat one 300px away and nearly level.
 *
 * @param {string} direction
 * @param {{x,y,width,height}} fromRect
 * @param {Array<{rect: {x,y,width,height}}>} entries anything carrying a `rect`
 * @returns {Array} the entries whose rect center lies toward `direction`, best first
 */
export function rankDirectionCandidates(direction, fromRect, entries) {
    return entries
        .filter((e) => isBeyond(direction, fromRect, e.rect))
        .map((e) => ({
            entry: e,
            overlaps: overlapTier(direction, fromRect, e.rect),
            axial: axialGap(direction, fromRect, e.rect),
            perp: perpendicularCenterDistance(direction, fromRect, e.rect),
        }))
        .sort((a, b) => {
            if (a.overlaps !== b.overlaps) return a.overlaps - b.overlaps;
            if (a.overlaps === 0) return a.axial - b.axial || a.perp - b.perp;
            return a.axial + a.perp - (b.axial + b.perp) || a.axial - b.axial;
        })
        .map((s) => s.entry);
}

/** 0 = substantial overlap, 1 = sliver, 2 = none (perpendicular to `direction`). */
function overlapTier(direction, from, candidate) {
    const overlap = perpendicularOverlap(direction, from, candidate);
    if (overlap <= 0) return 2;
    const span = (r) => (Direction.isVertical(direction) ? r.width : r.height);
    return overlap >= Math.min(span(from), span(candidate)) / 2 ? 0 : 1;
}

function intersects(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * Where a window snapped toward `direction` should land.
 *
 * The window slides toward `direction` and stops at the nearest "stop": the work-area edge,
 * touching the facing side of an obstacle in its path, or (when already touching one)
 * hopping to the obstacle's other side. Placements that would overlap some other window are
 * skipped when an overlap-free stop exists, so repeated presses walk the window across the
 * screen obstacle by obstacle without ever burying it. All coordinates are work-area
 * absolute (a top bar or a second monitor's origin offset never breaks the math).
 *
 * @param {string} direction
 * @param {{x,y,width,height}} rect the window being snapped
 * @param {{x,y,width,height}} workArea
 * @param {Array<{x,y,width,height}>} obstacles other windows on the same monitor
 * @returns {{x: number, y: number}|null} new position, or null if there is nowhere to go
 */
export function snapStop(direction, rect, workArea, obstacles) {
    const vertical = Direction.isVertical(direction);
    const forward = direction === Direction.Right || direction === Direction.Down;
    const pos = vertical ? rect.y : rect.x;
    const span = vertical ? rect.height : rect.width;
    const areaPos = vertical ? workArea.y : workArea.x;
    const areaSpan = vertical ? workArea.height : workArea.width;

    const inPath = obstacles.filter((o) => perpendicularOverlap(direction, rect, o) > 0);

    const stops = [forward ? areaPos + areaSpan - span : areaPos];
    for (const o of inPath) {
        const oPos = vertical ? o.y : o.x;
        const oSpan = vertical ? o.height : o.width;
        stops.push(forward ? oPos - span : oPos + oSpan); // approach: touch its facing side
        stops.push(forward ? oPos + oSpan : oPos - span); // leapfrog: land on its far side
    }

    const candidates = stops.filter(
        (s) =>
            (forward ? s > pos + EPSILON : s < pos - EPSILON) &&
            s >= areaPos &&
            s <= areaPos + areaSpan - span,
    );
    if (candidates.length === 0) return null;

    // Nearest first; prefer stops whose placement does not bury another window.
    candidates.sort((a, b) => (forward ? a - b : b - a));
    const placementAt = (s) => (vertical ? { ...rect, y: s } : { ...rect, x: s });
    const free = candidates.find((s) => !inPath.some((o) => intersects(placementAt(s), o)));
    const target = free ?? candidates[0];

    return vertical ? { x: rect.x, y: target } : { x: target, y: rect.y };
}
