# Scratchpad geometry memory

## Behavior

- Moving a window into the scratchpad records its current position and size before minimizing it.
- Hiding a visible scratchpad window refreshes that saved rectangle before minimizing it.
- The first summon after stashing, and every later summon or cycle, restores the window's saved rectangle.
- A scratchpad member without saved geometry falls back to half the active monitor's work area, centered.
- Restored rectangles are clamped to the active monitor so display changes cannot leave a window off-screen.

## Lifecycle

Scratchpad rectangles are keyed by window ID and included in the in-memory session snapshot used across GNOME Shell disable/enable cycles, including lock and unlock. Invalid snapshot rectangles are ignored. Closing a window, returning it from the scratchpad, or destroying the tiler removes the corresponding geometry state.

Monitor rebuilds preserve original free-window geometry, continue tracking global scratchpad members on free workspaces, and reapply a visible scratchpad window within the new work area.

## Regression coverage

Geometry tests cover the centered fallback, exact restoration, cross-monitor clamping, and oversized-window shrinking.
