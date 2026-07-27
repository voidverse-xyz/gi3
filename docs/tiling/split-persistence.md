# Split persistence and root-edge movement

## Problem

Two layout failures can occur when single-child containers are treated as disposable:

1. `H[a V[b c]]`, followed by closing `c`, can collapse to `H[a b]`. Opening another window beside `b` then produces a third column instead of reusing the vertical split.
2. When a horizontal root is left with one vertical container, cleanup can absorb the container and change the root to vertical. A subsequent rightward move then has no horizontal ancestor through which it can pop out.

## Cause

Flattening every single-child container discards explicit split intent and makes the outer orientation unstable.

Treating a perpendicular root edge as a no-op also prevents a vertical root from being restructured into columns through a rightward or leftward move.

## Implemented semantics

- Cleanup removes empty non-root containers but preserves single-child containers. Their orientation remains the insertion target for the next window.
- A sole root container remains nested, preserving the root's outer orientation.
- Moving a direct root child perpendicular to the root creates a new outer split while wrapping the remaining siblings in their previous orientation. For example:

  ```text
  V[a b c] --move c right--> H[V[a b] c]
  ```

- Perpendicular root-edge restructuring is symmetric for left, right, up, and down.
- Closing the focused last window while the root container itself is focused clears the empty-container focus.

## Regression coverage

- `tests/engine/close.test.js` verifies that closing and reopening a member preserves `H[a V[b]]` and reopens as `H[a V[b d]]`.
- `tests/engine/move.test.js` verifies preserved outer orientation, all four perpendicular root-edge directions, split preservation after pop-out, and equal geometry shares.
- `tests/engine/snapshot.test.js` verifies that reconciliation preserves surviving single-child split containers.
