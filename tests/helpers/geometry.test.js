import { test } from 'node:test';
import assert from 'node:assert/strict';
import Direction from '../../src/enums/direction.js';
import { rankDirectionCandidates, snapStop, perpendicularOverlap, isBeyond } from '../../src/helpers/geometry.js';

const r = (x, y, width, height) => ({ x, y, width, height });
const entries = (...rects) => rects.map((rect, i) => ({ id: i, rect }));
const ids = (ranked) => ranked.map((e) => e.id);

// ---------------------------------------------------------------------------------------
// rankDirectionCandidates
// ---------------------------------------------------------------------------------------

test('focus: stacked windows at the same x are reachable down, not right', () => {
    const from = r(0, 0, 600, 500);
    const below = entries(r(0, 600, 600, 400));
    assert.deepEqual(ids(rankDirectionCandidates(Direction.Down, from, below)), [0]);
    assert.deepEqual(ids(rankDirectionCandidates(Direction.Right, from, below)), []);
});

test('focus: prefers the nearer facing edge, not the nearer far edge (narrow-window bias)', () => {
    const from = r(0, 0, 600, 500);
    // Wide window directly right (near edge 620, far edge 1520); narrow window whose FAR
    // edge is closer (near 700, far 800). The old metric picked the narrow one.
    const wideDirect = r(620, 0, 900, 400);
    const narrowBelow = r(700, 300, 100, 300);
    const ranked = ids(rankDirectionCandidates(Direction.Right, from, entries(wideDirect, narrowBelow)));
    assert.equal(ranked[0], 0);
});

test('focus: perpendicular overlap beats a nearer diagonal window', () => {
    const from = r(0, 0, 600, 500);
    const diagonalNear = r(620, 520, 300, 300); // no vertical overlap with `from`
    const alignedFar = r(1200, 100, 300, 300); // overlaps `from` vertically
    const ranked = ids(rankDirectionCandidates(Direction.Right, from, entries(diagonalNear, alignedFar)));
    assert.deepEqual(ranked, [1, 0]);
});

test('focus down: substantial overlap beats a sliver with a marginally closer edge (video bug)', () => {
    // The exact crowd from the demo video: from C, "focus down" went to E (50px band
    // sliver, top edge 20px closer) instead of F (460px overlap, directly below).
    const c = r(1250, 60, 560, 420);
    const e = r(760, 500, 540, 460);
    const f = r(1350, 540, 480, 420);
    const ranked = ids(rankDirectionCandidates(Direction.Down, c, entries(e, f)));
    assert.equal(ranked[0], 1, 'F (directly below) must win');
});

test('focus: two substantial-overlap candidates still resolve by nearest facing edge', () => {
    const from = r(0, 0, 600, 500);
    const near = r(620, 50, 300, 400);
    const far = r(1000, 50, 300, 400);
    assert.deepEqual(ids(rankDirectionCandidates(Direction.Right, from, entries(far, near))), [1, 0]);
});

test('focus: a window mostly below (outside the direction cone) is not "right" at all', () => {
    const from = r(0, 0, 400, 400);
    const wayDown = r(500, 800, 400, 400); // 100px right, 800px down: perp 800 > 1.5 * axial 500
    const nearlyLevel = r(700, 450, 400, 400); // 300px right, 50px below
    assert.deepEqual(ids(rankDirectionCandidates(Direction.Right, from, entries(wayDown, nearlyLevel))), [1]);
});

test('focus down: a nearer window far off to the side falls outside the cone', () => {
    const from = r(800, 0, 300, 300);
    const farLeft = r(100, 350, 300, 300); // 50px below, 700px left: not "down"
    const alignedRight = r(1150, 600, 300, 300); // 300px below, 350px right
    assert.deepEqual(ids(rankDirectionCandidates(Direction.Down, from, entries(farLeft, alignedRight))), [1]);
});

test('focus up from a top-edge window: an essentially-level window far sideways is a no-op', () => {
    // From the 8-window video crowd: pressing up from W1 used to fly to W3, whose center
    // is 30px higher but 820px to the right.
    const w1 = r(40, 60, 460, 380);
    const w3 = r(860, 60, 500, 320);
    assert.deepEqual(ids(rankDirectionCandidates(Direction.Up, w1, entries(w3))), []);
});

test('focus: a 10px sliver with a closer edge loses to a meaty near-substantial sliver', () => {
    const from = r(0, 0, 600, 500);
    const tiny = r(620, 490, 600, 400); // 10px overlap, 20px away
    const meaty = r(700, 270, 300, 470); // 230px overlap, 100px away
    assert.deepEqual(ids(rankDirectionCandidates(Direction.Right, from, entries(tiny, meaty))), [1, 0]);
});

test('focus: a window centered inside a bigger one reaches the container in all four directions', () => {
    const big = r(200, 100, 1200, 800);
    const small = r(650, 400, 300, 200); // dead-centered inside big
    for (const dir of [Direction.Up, Direction.Down, Direction.Left, Direction.Right]) {
        assert.deepEqual(ids(rankDirectionCandidates(dir, small, entries(big))), [0], `direction ${dir}`);
    }
});

test('focus: the container prefers its own contained window over external ones only when nearer', () => {
    const big = r(200, 100, 1200, 800);
    const small = r(650, 400, 300, 200);
    const external = r(1450, 350, 300, 300); // fully right of big
    // From the contained window, right goes to the container (it is the nearest thing
    // to the right), not the external window beyond it.
    assert.deepEqual(ids(rankDirectionCandidates(Direction.Right, small, entries(big, external))), [0, 1]);
});

test('focus: from the big window, a dead-centered inner window stays unreachable (no direction)', () => {
    const big = r(200, 100, 1200, 800);
    const small = r(650, 400, 300, 200);
    for (const dir of [Direction.Up, Direction.Down, Direction.Left, Direction.Right]) {
        assert.deepEqual(ids(rankDirectionCandidates(dir, big, entries(small))), [], `direction ${dir}`);
    }
});

test('focus: identical rect (same center) is not a candidate in any direction', () => {
    const from = r(100, 100, 400, 400);
    for (const dir of [Direction.Up, Direction.Down, Direction.Left, Direction.Right]) {
        assert.deepEqual(ids(rankDirectionCandidates(dir, from, entries(r(100, 100, 400, 400)))), []);
    }
});

test('focus: candidate overlapping axially still ranks (gap clamps to zero)', () => {
    const from = r(0, 0, 600, 500);
    const overlapping = r(500, 50, 400, 400); // interleaved with `from`, center to the right
    assert.deepEqual(ids(rankDirectionCandidates(Direction.Right, from, entries(overlapping))), [0]);
});

// ---------------------------------------------------------------------------------------
// snapStop
// ---------------------------------------------------------------------------------------

const AREA = r(0, 32, 1920, 1048); // typical single monitor with a top bar

test('snap: empty path lands on the work-area edge, honoring the top-bar offset', () => {
    const w = r(100, 200, 600, 400);
    assert.deepEqual(snapStop(Direction.Up, w, AREA, []), { x: 100, y: 32 });
    assert.deepEqual(snapStop(Direction.Down, w, AREA, []), { x: 100, y: 32 + 1048 - 400 });
    assert.deepEqual(snapStop(Direction.Left, w, AREA, []), { x: 0, y: 200 });
    assert.deepEqual(snapStop(Direction.Right, w, AREA, []), { x: 1920 - 600, y: 200 });
});

test('snap: work areas with a non-zero origin (second monitor) are respected', () => {
    const area = r(1920, 0, 1920, 1080);
    const w = r(2500, 100, 600, 400);
    assert.deepEqual(snapStop(Direction.Left, w, area, []), { x: 1920, y: 100 });
    assert.deepEqual(snapStop(Direction.Right, w, area, []), { x: 1920 + 1920 - 600, y: 100 });
});

test('snap: stops against the facing edge of the first obstacle in the path', () => {
    const w = r(0, 32, 600, 500);
    const obstacle = r(700, 100, 300, 300);
    assert.deepEqual(snapStop(Direction.Right, w, AREA, [obstacle]), { x: 100, y: 32 });
});

test('snap: obstacles outside the perpendicular band are ignored', () => {
    const w = r(0, 32, 600, 400);
    const below = r(700, 600, 300, 300); // no vertical overlap with w
    assert.deepEqual(snapStop(Direction.Right, w, AREA, [below]), { x: 1920 - 600, y: 32 });
});

test('snap: pressing again when touching hops to the far side without burying the obstacle', () => {
    const w = r(0, 32, 600, 500);
    const touching = r(600, 32, 300, 300);
    assert.deepEqual(snapStop(Direction.Right, w, AREA, [touching]), { x: 900, y: 32 });
});

test('snap: hops over a gap too small to fit instead of overlapping windows', () => {
    // w is 600 wide at x=100 touching B; B..C gap is 50px, far too narrow.
    const w = r(100, 32, 600, 400);
    const b = r(700, 32, 100, 400);
    const c = r(850, 32, 200, 400);
    assert.deepEqual(snapStop(Direction.Right, w, AREA, [b, c]), { x: 1050, y: 32 });
});

test('snap: already flush against the work-area edge is a no-op', () => {
    const w = r(0, 32, 600, 400);
    assert.equal(snapStop(Direction.Left, w, AREA, []), null);
    assert.equal(snapStop(Direction.Up, w, AREA, []), null);
});

test('snap: window wider than the work area cannot snap horizontally', () => {
    const w = r(0, 32, 2500, 400);
    assert.equal(snapStop(Direction.Right, w, AREA, []), null);
});

// ---------------------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------------------

test('perpendicularOverlap measures the cross-axis overlap', () => {
    const a = r(0, 0, 600, 500);
    assert.equal(perpendicularOverlap(Direction.Right, a, r(700, 250, 300, 500)), 250);
    assert.equal(perpendicularOverlap(Direction.Right, a, r(700, 600, 300, 300)) > 0, false);
    assert.equal(perpendicularOverlap(Direction.Down, a, r(300, 600, 600, 300)), 300);
});

test('isBeyond compares centers, not corners', () => {
    const from = r(0, 0, 600, 500);
    // Same x, slightly wider: corner test would say "not right", center test agrees.
    assert.equal(isBeyond(Direction.Right, from, r(0, 0, 700, 500)), true);
    assert.equal(isBeyond(Direction.Right, from, r(0, 0, 600, 500)), false);
});
