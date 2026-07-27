import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../../src/tiling/config/commandParser.js';
import { parseCriteria } from '../../src/tiling/config/criteria.js';

const cmd = (s) => parseCommand(s.split(/\s+/));

describe('command parser', () => {
    it('parses focus/move directions and parent/child', () => {
        assert.deepEqual(cmd('focus left'), { type: 'focus', dir: 'left' });
        assert.deepEqual(cmd('move down'), { type: 'move', dir: 'down' });
        assert.deepEqual(cmd('focus parent'), { type: 'focusParent' });
        assert.deepEqual(cmd('focus mode_toggle'), { type: 'focusModeToggle' });
    });

    it('parses split / layout commands', () => {
        assert.deepEqual(cmd('splith'), { type: 'split', orientation: 'horizontal' });
        assert.deepEqual(cmd('split v'), { type: 'split', orientation: 'vertical' });
        assert.deepEqual(cmd('layout splitv'), { type: 'layout', layout: 'splitv' });
        assert.deepEqual(cmd('layout toggle split'), { type: 'layoutToggleSplit' });
    });

    it('maps unsupported layout targets (tabbed/stacking) to nop', () => {
        assert.deepEqual(cmd('layout tabbed'), { type: 'nop' });
        assert.deepEqual(cmd('layout stacking'), { type: 'nop' });
    });

    it('parses resize with px and ppt units', () => {
        assert.deepEqual(cmd('resize shrink width 350px'), {
            type: 'resize',
            mode: 'shrink',
            axis: 'width',
            amount: 350,
            unit: 'px',
        });
        assert.deepEqual(cmd('resize grow height 10 ppt'), {
            type: 'resize',
            mode: 'grow',
            axis: 'height',
            amount: 0.1,
            unit: 'ppt',
        });
    });

    it('parses workspace and move-to-workspace targets', () => {
        assert.deepEqual(cmd('workspace number 3'), { type: 'workspace', workspace: 3 });
        assert.deepEqual(cmd('move container to workspace number 5'), {
            type: 'moveToWorkspace',
            workspace: 5,
        });
    });

    it('maps out-of-scope commands to nop', () => {
        assert.deepEqual(cmd('exec systemd-run --user firefox'), { type: 'nop' });
        assert.deepEqual(cmd('opacity 0.9'), { type: 'nop' });
        assert.deepEqual(cmd('kill'), { type: 'kill' });
    });
});

describe('criteria parser', () => {
    it('parses field=value and bare-field conditions', () => {
        const { criteria } = parseCriteria(`[app_id="Alacritty" floating]`);
        assert.deepEqual(criteria.conditions, [
            { field: 'app_id', value: 'Alacritty' },
            { field: 'floating', value: null },
        ]);
    });

    it('reports unknown fields without erroring', () => {
        const { criteria, unknown } = parseCriteria(`[bogus="x" title="t"]`);
        assert.deepEqual(unknown, ['bogus']);
        assert.deepEqual(criteria.conditions, [{ field: 'title', value: 't' }]);
    });
});
