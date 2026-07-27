import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lex } from '../../src/tiling/config/lexer.js';

const tokensOf = (src) => lex(src).map((l) => l.tokens);

describe('lexer', () => {
    it('skips blank lines and full-line comments but keeps #rrggbb args', () => {
        assert.deepEqual(
            tokensOf('# a comment\n\n  # indented comment\nclient.focused #b1b1b1 #000000'),
            [['client.focused', '#b1b1b1', '#000000']]
        );
    });

    it('joins backslash line continuations', () => {
        assert.deepEqual(tokensOf('exec foo \\\n  bar \\\n  baz'), [['exec', 'foo', 'bar', 'baz']]);
    });

    it('strips quotes and groups quoted spans into one token', () => {
        assert.deepEqual(tokensOf(`input type:keyboard xkb_layout "us"`), [
            ['input', 'type:keyboard', 'xkb_layout', 'us'],
        ]);
        assert.deepEqual(tokensOf(`set $menu wmenu-run -f 'Mono 12'`), [
            ['set', '$menu', 'wmenu-run', '-f', 'Mono 12'],
        ]);
    });

    it('emits braces as their own tokens', () => {
        assert.deepEqual(tokensOf('input type:touchpad {'), [['input', 'type:touchpad', '{']]);
        assert.deepEqual(tokensOf('}'), [['}']]);
    });

    it('captures a [criteria] span as a single token', () => {
        assert.deepEqual(tokensOf(`for_window [app_id="Alacritty" title="x"] opacity 0.9`), [
            ['for_window', `[app_id="Alacritty" title="x"]`, 'opacity', '0.9'],
        ]);
    });
});
