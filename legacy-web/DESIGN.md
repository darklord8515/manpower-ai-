# CONSTRUCTIQ design system

The source of truth for values is `src/styles/tokens.css`. This file records the rules for using them.

## The principle: red means "look here"

The interface is charcoal and grey. Red appears only on the current location, the most urgent actions
and real shortfalls, so a delayed project stands out without anything else competing with it.
Status is never shown by colour alone: every status has an icon and a text label.

## Colour

| Token | Value | Use |
|---|---|---|
| `--color-brand` | `#B8202E` | Urgent actions, current nav item, delayed status, shortfall |
| `--color-brand-soft` | `#FCEBED` | Current nav background, highlighted rows |
| `--color-ink` | `#242424` | Primary text, main chart series |
| `--color-ink-2` / `--color-ink-3` | `#555555` / `#6B6B6B` | Secondary and tertiary text |
| `--color-surface` / `--color-canvas` | `#FFFFFF` / `#F5F5F5` | Panels / page background |
| `--color-ok` / `--color-warn` | `#1F7A5A` / `#9A5B00` | On track / at risk |

## Type

IBM Plex Sans Variable, with tabular numerals for all figures. IBM Plex Sans Arabic is the matching
family if an Arabic interface is added. Sizes: 12, 13, 14, 16, 20, 26px. Labels use sentence case,
never all caps.

## Space, shape, depth

- Spacing follows a 4px grid (`--space-1` to `--space-8`).
- Radius follows hierarchy: 4px for small marks, 6px for controls, 12px for cards, 32px for the workspace edge.
- Cards use a hairline border and the very soft `--shadow-card`. Stronger shadows are only for things that float.
- Card padding comes from `--panel-padding`, so equivalent cards always match.

## Sidebar and workspace edge

The sidebar is charcoal (`--sidebar-bg`) with white labels and outline icons. The current page uses the soft red
background with red text. The workspace meets it with a large curve at the top and bottom of the screen, drawn by two
fixed corner pieces in `AppShell`. They follow the sidebar width and are hidden when the sidebar becomes a drawer.

## Data display

- **Progress tracks:** the fill is the actual value, the tick is the plan or target, and the gap
  between them is red. The same component is used wherever a value is measured against a goal.
- **Charts:** greys and charcoal first. Label values directly where possible, and give each chart a
  text alternative.
- **Workforce status:** four states, told apart by pattern as well as shade. Deployed is solid charcoal,
  Mobilizing is hatched, Available is mid grey, and Unavailable groups leave (outlined) with visa or medical
  holds (red). Every state shows its count and share as text.
- **Shortages:** "Short" adds positive trade gaps, "Over" adds negative ones, "Pending" counts open requests
  whether or not they are approved, and "No request" is the shortage left after that.
- **Approvals:** show the effect on project staffing, the date, readiness and possible consequences. A decision
  that makes a project worse is shown in red. Financial costs are not shown.

## Motion

Motion only responds to user actions (opening, collapsing, confirming) and stays under 200ms. There
are no entrance animations. `prefers-reduced-motion` removes all of it.

## Honesty in the interface

Anything not built says so. Session-only actions state that they reset on refresh. Don't add a link or
button that looks functional but does nothing.

## Projections

The forecast, timeline and transitions panels only calculate from existing demo data, in `forecastSelectors.ts`. No AI
model is connected, and the forecast panel says so. Do not add figures that can't be derived, and don't add "View all"
style links until their destinations exist.

## Demo data

All data is fictional. "Fictional Demo Data" stays in the sticky header at every screen size, the footer
carries a disclaimer, and the browser title says "(Demo)". Project and people names are invented; only emirate
names are real. The utilization target is an illustrative placeholder in `src/config/workforce.ts`, and the
interface must keep saying it is not an approved company target. Never add real company data here.
