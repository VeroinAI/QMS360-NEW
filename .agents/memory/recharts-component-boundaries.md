---
name: Recharts component boundaries
description: Recharts 2 rendering constraints that can silently hide plots or produce invalid categorical coordinates.
---

With the workspace's Recharts 2, keep recognized axis components as direct chart children, not inside conditional React fragments. A custom component immediately inside ResponsiveContainer must forward the measured width and height to the underlying chart.

**Why:** Typechecks and numeric-data checks passed while wrapped charts rendered blank. Forwarding dimensions exposed a second failure: fragment-wrapped axes were not discovered, yielding missing ticks, invalid category coordinates and partially rendered bars.

**How to apply:** Render conditional XAxis and YAxis as separate direct children. Label a real plotted series rather than adding a dummy missing-value series. Rendering regressions should assert actual category labels, multiple plotted bars and finite coordinates, not merely an SVG/container.
