# Legend placement and attribution

Drag the legend near an edge to snap it while dragging. The attraction distance is 12 CSS pixels from its anchored position. Pull away to detach; release preserves the visible position. The lock toggle disables attraction. Arrow keys choose corners; Home restores bottom left.

Corner placement survives viewport and content changes. Free placement retains its saved pixel coordinates, with temporary clamping when necessary. Preview placement does not replace the saved normal-map position.

Drag borders to resize, including in export preview. Ctrl+corner-drag scales the legend proportionally, with a hover hint. Scale is saved separately from layout dimensions. Preview retains measured dimensions subject to frame bounds.

Attribution remains expanded below the ruler at bottom right, separated by 4px. Legend bounds reserve space when overlapping those controls.

Regression coverage: legend position and element resize unit tests, browser legend interactions and attribution visibility on desktop/mobile.
