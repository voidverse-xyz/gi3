import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { matchesCriteria } from '../../src/tiling/config/criteriaMatch.js';
import { parseCriteria } from '../../src/tiling/config/criteria.js';

const props = (over = {}) => ({
    appId: 'Alacritty',
    windowClass: 'Alacritty',
    instance: 'alacritty',
    title: 'nvim — file.ts',
    windowRole: '',
    ...over,
});

const match = (span, p) => matchesCriteria(parseCriteria(span).criteria, p);

describe('criteria matching', () => {
    it('matches app_id exactly and via regex', () => {
        assert.equal(match(`[app_id="Alacritty"]`, props()), true);
        assert.equal(match(`[app_id="^Alac"]`, props()), true);
        assert.equal(match(`[app_id="Firefox"]`, props()), false);
    });

    it('matches title as a regex (substring)', () => {
        assert.equal(match(`[title="nvim"]`, props()), true);
        assert.equal(match(`[title="emacs"]`, props()), false);
    });

    it('requires all conditions (AND)', () => {
        assert.equal(match(`[app_id="Alacritty" title="nvim"]`, props()), true);
        assert.equal(match(`[app_id="Alacritty" title="emacs"]`, props()), false);
    });

    it('does not let unsupported fields fail a match', () => {
        // `floating` can't be evaluated here, so it must not veto an otherwise-matching rule
        assert.equal(match(`[app_id="Alacritty" floating]`, props()), true);
    });
});
