import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../src/tiling/engine/engine.js';
import { resolveFloatingRect } from '../../src/tiling/engine/computeLayout.js';

const OUTPUT = { x: 0, y: 0, width: 1000, height: 1000 };

function engineWith(opts) {
    return new Engine(OUTPUT, { innerGap: 0, outerGap: 0, ...opts });
}

describe('computeLayout geometry', () => {
    it('splits horizontally into equal columns with no gaps', () => {
        const e = engineWith({});
        e.addWindow('a');
        e.addWindow('b');
        const g = e.render().geometries;
        assert.deepEqual(g.get('a'), { x: 0, y: 0, width: 500, height: 1000 });
        assert.deepEqual(g.get('b'), { x: 500, y: 0, width: 500, height: 1000 });
    });

    it('applies inner gaps between windows', () => {
        const e = engineWith({ innerGap: 10 });
        e.addWindow('a');
        e.addWindow('b');
        const g = e.render().geometries;
        assert.deepEqual(g.get('a'), { x: 0, y: 0, width: 495, height: 1000 });
        assert.deepEqual(g.get('b'), { x: 505, y: 0, width: 495, height: 1000 });
    });

    it('applies outer gaps at the screen edge', () => {
        const e = engineWith({ outerGap: 20 });
        e.addWindow('a');
        e.addWindow('b');
        const g = e.render().geometries;
        assert.deepEqual(g.get('a'), { x: 20, y: 20, width: 480, height: 960 });
        assert.deepEqual(g.get('b'), { x: 500, y: 20, width: 480, height: 960 });
    });

    it('lays a vertical split top-to-bottom', () => {
        const e = engineWith({});
        e.addWindow('a');
        e.apply({ type: 'layoutToggleSplit' }); // splith → splitv
        e.addWindow('b');
        const g = e.render().geometries;
        assert.deepEqual(g.get('a'), { x: 0, y: 0, width: 1000, height: 500 });
        assert.deepEqual(g.get('b'), { x: 0, y: 500, width: 1000, height: 500 });
    });

    it('fullscreen covers the whole output and nothing else is placed', () => {
        const e = engineWith({});
        e.addWindow('a');
        e.addWindow('b');
        e.notifyFocused('a');
        e.apply({ type: 'fullscreen' });
        const g = e.render().geometries;
        assert.deepEqual(g.get('a'), { x: 0, y: 0, width: 1000, height: 1000 });
        assert.equal(g.has('b'), false);
    });

    it('nested H[a V[b c]] geometry', () => {
        const e = engineWith({});
        e.addWindow('a');
        e.addWindow('b');
        e.apply({ type: 'split', orientation: 'vertical' });
        e.addWindow('c');
        const g = e.render().geometries;
        // a fills the left half; b/c stack in the right half
        assert.deepEqual(g.get('a'), { x: 0, y: 0, width: 500, height: 1000 });
        assert.deepEqual(g.get('b'), { x: 500, y: 0, width: 500, height: 500 });
        assert.deepEqual(g.get('c'), { x: 500, y: 500, width: 500, height: 500 });
    });

    it('keeps four panes in a nested vertical split from overlapping', () => {
        const e = engineWith({ innerGap: 10 });
        e.addWindow('a');
        e.addWindow('b');
        e.apply({ type: 'split', orientation: 'vertical' });
        e.addWindow('c');
        e.addWindow('d');
        e.addWindow('e');
        const g = e.render().geometries;

        assert.deepEqual(g.get('a'), { x: 0, y: 0, width: 495, height: 1000 });
        assert.deepEqual(g.get('b'), { x: 505, y: 0, width: 495, height: 243 });
        assert.deepEqual(g.get('c'), { x: 505, y: 253, width: 495, height: 243 });
        assert.deepEqual(g.get('d'), { x: 505, y: 506, width: 495, height: 243 });
        assert.deepEqual(g.get('e'), { x: 505, y: 759, width: 495, height: 241 });
    });
});

describe('floating geometry restoration', () => {
    it('uses the centered half-output default when no geometry was saved', () => {
        assert.deepEqual(resolveFloatingRect(null, OUTPUT), { x: 250, y: 250, width: 500, height: 500 });
    });

    it('preserves saved geometry that fits within the output', () => {
        const saved = { x: 120, y: 180, width: 640, height: 480 };
        assert.deepEqual(resolveFloatingRect(saved, OUTPUT), saved);
    });

    it('clamps saved geometry into a different output', () => {
        const output = { x: 1920, y: 40, width: 1280, height: 720 };
        const saved = { x: 3000, y: 700, width: 400, height: 300 };
        assert.deepEqual(resolveFloatingRect(saved, output), { x: 2800, y: 460, width: 400, height: 300 });
    });

    it('shrinks saved geometry that is larger than the output', () => {
        const output = { x: 1920, y: 40, width: 1280, height: 720 };
        const saved = { x: 100, y: 100, width: 1600, height: 900 };
        assert.deepEqual(resolveFloatingRect(saved, output), output);
    });
});
