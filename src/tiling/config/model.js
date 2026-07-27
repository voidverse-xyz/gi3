// The resolved result of parsing a Sway/i3 config. Everything the parser supports is captured
// in a shape the runtime can consume directly; everything the desktop shell owns (exec/input/output/bar/
// colours) is recorded in `ignored` so we can report "honoured vs ignored" without erroring.

/** A window-matching criteria clause, e.g. `[app_id="Alacritty" title="^foo"]`.
 * @typedef {object} Criteria
 * @property {CriteriaCondition[]} conditions
 */

/**
 * @typedef {object} CriteriaCondition
 * @property {CriteriaField} field
 * @property {string|null} value Match value. `null` means a bare field (presence test), e.g. `[floating]`.
 */

/** @typedef {"app_id"|"class"|"instance"|"title"|"con_mark"|"con_id"|"window_role"|"window_type"|"floating"|"tiling"|"urgent"|"workspace"|"shell"|"pid"|"machine"} CriteriaField */

/**
 * A key binding: a resolved key combo plus the command it runs.
 * @typedef {object} BindingSpec
 * @property {string} combo Sway key combo with variables resolved, e.g. `Mod4+shift+h`.
 * @property {string[]} flags bindsym flags such as `--locked`, `--release`, `--to-code`.
 * @property {boolean} byCode True for `bindcode` (raw keycodes) rather than `bindsym` (keysyms).
 * @property {import('../engine/engine.js').Command} command
 */

/**
 * A `for_window` / `assign` rule: when a window matches, run a command.
 * @typedef {object} RuleSpec
 * @property {"for_window"|"assign"} kind
 * @property {Criteria} criteria
 * @property {import('../engine/engine.js').Command} command
 */

/**
 * Settings that affect layout and behavior.
 * @typedef {object} Settings
 * @property {string|null} mod Resolved `$mod` value, e.g. `Mod4`.
 * @property {string|null} floatingModifier
 * @property {number|null} gapsInner
 * @property {number|null} gapsOuter
 * @property {BorderSetting|null} defaultBorder
 */

/**
 * @typedef {object} BorderSetting
 * @property {"none"|"normal"|"pixel"} style
 * @property {number} px
 */

/**
 * One config directive we recognise but intentionally don't act on.
 * @typedef {object} IgnoredDirective
 * @property {string} keyword
 * @property {number} line
 * @property {"system"|"decoration"|"unsupported"} reason
 */

/**
 * @typedef {object} Config
 * @property {Map<string,string>} variables
 * @property {Settings} settings
 * @property {BindingSpec[]} bindings
 * @property {Record<string, BindingSpec[]>} modes Binding sets for each named `mode { ... }` (excluding the default mode).
 * @property {RuleSpec[]} rules
 * @property {IgnoredDirective[]} ignored
 * @property {ParseWarning[]} warnings Non-fatal problems encountered while parsing (Sway skips bad lines and continues).
 */

/**
 * @typedef {object} ParseWarning
 * @property {number} line
 * @property {string} message
 */

/** @returns {Settings} */
export function emptySettings() {
    return {
        mod: null,
        floatingModifier: null,
        gapsInner: null,
        gapsOuter: null,
        defaultBorder: null,
    };
}
