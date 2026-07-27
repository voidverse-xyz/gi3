// Matches a parsed criteria against a window's properties. Pure and testable: the Mutter
// adapter extracts a plain WindowProps from a real window, and this decides whether a
// for_window/assign rule applies. Sway criteria values are regexes (PCRE); we use JS RegExp,
// which covers the common patterns, and fall back to literal comparison on a bad pattern.

/**
 * The window attributes we can match on. Unknown/extra fields are simply not constrained.
 * @typedef {object} WindowProps
 * @property {string} appId Wayland app_id or shell-provided app/window class
 * @property {string} windowClass X11 WM_CLASS class
 * @property {string} instance X11 WM_CLASS instance
 * @property {string} title
 * @property {string} windowRole
 */

/**
 * @param {import('./model.js').Criteria} criteria
 * @param {WindowProps} props
 */
export function matchesCriteria(criteria, props) {
    // All conditions must hold (logical AND), like Sway.
    return criteria.conditions.every((cond) => matchCondition(cond, props));
}

function matchCondition(cond, props) {
    switch (cond.field) {
        case 'app_id':
            return matchValue(cond.value, props.appId);
        case 'class':
            return matchValue(cond.value, props.windowClass);
        case 'instance':
            return matchValue(cond.value, props.instance);
        case 'title':
            return matchValue(cond.value, props.title);
        case 'window_role':
            return matchValue(cond.value, props.windowRole);
        default:
            // State/identity fields we can't evaluate here (floating, con_mark, pid, …) don't
            // constrain the match rather than silently failing the whole rule.
            return true;
    }
}

function matchValue(value, prop) {
    if (value === null) return prop.length > 0; // bare field → presence test
    try {
        return new RegExp(value).test(prop);
    } catch (_e) {
        return value === prop;
    }
}
