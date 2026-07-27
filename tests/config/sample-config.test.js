import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseConfig } from "../../src/tiling/config/parser.js";

const SRC = readFileSync(new URL("./fixtures/sample.sway.config", import.meta.url), "utf8");

function bindingFor(config, combo) {
    return config.bindings.find((binding) => binding.combo === combo);
}

describe("sample i3/Sway config acceptance", () => {
    const config = parseConfig(SRC);

    it("parses without warnings or malformed bindings", () => {
        assert.deepEqual(config.warnings, []);
        assert.equal(config.bindings.every((binding) => binding.combo.length > 0), true);
    });

    it("resolves variables and settings", () => {
        assert.equal(config.variables.get("mod"), "Mod4");
        assert.equal(config.variables.get("left"), "h");
        assert.equal(config.variables.get("term_app_id"), "ExampleTerminal");
        assert.equal(config.settings.mod, "Mod4");
        assert.equal(config.settings.gapsInner, 30);
        assert.equal(config.settings.gapsOuter, 0);
        assert.deepEqual(config.settings.defaultBorder, { style: "pixel", px: 3 });
        assert.equal(config.settings.floatingModifier, "Mod4");
    });

    it("resolves layout-driving keybindings to engine commands", () => {
        assert.deepEqual(bindingFor(config, "Mod4+h")?.command, { type: "focus", dir: "left" });
        assert.deepEqual(bindingFor(config, "Mod4+shift+h")?.command, { type: "move", dir: "left" });
        assert.deepEqual(bindingFor(config, "Mod4+b")?.command, {
            type: "split",
            orientation: "horizontal",
        });
        assert.deepEqual(bindingFor(config, "Mod4+e")?.command, { type: "nop" });
        assert.deepEqual(bindingFor(config, "Mod4+r")?.command, { type: "nop" });
        assert.deepEqual(bindingFor(config, "Mod4+w")?.command, { type: "layoutToggleSplit" });
        assert.deepEqual(bindingFor(config, "Mod4+f")?.command, { type: "fullscreen" });
        assert.deepEqual(bindingFor(config, "Mod4+a")?.command, { type: "focusParent" });
        assert.deepEqual(bindingFor(config, "Mod4+ctrl+space")?.command, { type: "floatingToggle" });
    });

    it("resolves workspace and resize bindings", () => {
        assert.deepEqual(bindingFor(config, "Mod4+1")?.command, { type: "workspace", workspace: 1 });
        assert.deepEqual(bindingFor(config, "Mod4+shift+1")?.command, {
            type: "moveToWorkspace",
            workspace: 1,
        });
        assert.deepEqual(bindingFor(config, "Mod4+Alt+h")?.command, {
            type: "resize",
            mode: "shrink",
            axis: "width",
            amount: 350,
            unit: "px",
        });
    });

    it("keeps exec bindings as recognized no-ops", () => {
        assert.deepEqual(bindingFor(config, "Mod4+return")?.command, { type: "nop" });
        assert.deepEqual(bindingFor(config, "Mod4+q")?.command, { type: "nop" });
    });

    it("captures for_window rules with resolved criteria", () => {
        const rule = config.rules.find((entry) => entry.kind === "for_window");

        assert.deepEqual(rule?.criteria.conditions, [{ field: "app_id", value: "ExampleTerminal" }]);
    });

    it("ignores shell-owned blocks and decoration directives", () => {
        const ignoredKeywords = new Set(config.ignored.map((directive) => directive.keyword));

        assert.equal(ignoredKeywords.has("output"), true);
        assert.equal(ignoredKeywords.has("input"), true);
        assert.equal(ignoredKeywords.has("bar"), true);
        assert.equal(ignoredKeywords.has("client.focused"), true);
        assert.equal(bindingFor(config, "bottom"), undefined);
        assert.equal(
            config.rules.every((rule) => rule.kind === "for_window" || rule.kind === "assign"),
            true,
        );
    });
});
