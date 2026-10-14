---
name: PersonaBot Admin
description: A greenroom call sheet for a roleplay engine — production paper, ink, and a single red stamp.
colors:
  paper: "#f4f1ea"
  panel: "#faf8f5"
  ink: "#171512"
  muted: "#565049"
  rule: "#cdc4b3"
  stamp: "#b43622"
  location: "#316147"
  alert: "#935f06"
typography:
  display:
    fontFamily: "Oswald, system-ui, sans-serif"
    fontSize: "21px"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "0.05em"
  title:
    fontFamily: "Oswald, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.06em"
  body:
    fontFamily: "system-ui, -apple-system, PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.6
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0.06em"
rounded:
  none: "0"
  sm: "2px"
  default: "3px"
  md: "4px"
  lg: "5px"
  xl: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.stamp}"
    textColor: "#ffffff"
    rounded: "{rounded.default}"
    padding: "0 16px"
    height: "36px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.default}"
    padding: "0 16px"
    height: "36px"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.default}"
    padding: "0 12px"
    height: "36px"
  badge:
    backgroundColor: "transparent"
    textColor: "{colors.stamp}"
    rounded: "{rounded.none}"
    padding: "2px 6px"
---

# Design System: PersonaBot Admin

## Overview

**Creative North Star: "The Greenroom Call Sheet"**

The admin is a production-day document, not a dashboard. Every surface behaves like a printed call sheet pinned to the greenroom wall: a ruled ledger of who is on today, what they're running, and what changed. The page is paper; the numbers are stamped in ink; the one red stamp marks what is live. Nothing floats, nothing glows.

Layout is a fixed index rail plus a single ruled column of sections. Information is grouped by hairline rules rather than by cards-within-cards; a section is a bordered block, and everything inside it sits on one plane. Density is high and deliberate — this is a working document an operator scans, so the eye is carried by type and rule weight, not by containers.

The material stance is matte and physical. Cream paper in daylight, near-black ink at night ("night shoot"), with the same red and green accents in both. Motion is one authored gesture: a short damped slide-in when a sheet or modal arrives. There is no gradient, no glass, no drop shadow as decoration.

**Key Characteristics:**
- One flat plane per section; depth is carried by rule weight and tonal panel, never by stacked cards.
- A single red stamp (`#b43622`) marks the live/active thing on a screen; green marks healthy connection.
- Data — IDs, timestamps, counts, token totals, clock — is mono, uppercase where it labels, tabular where it counts.
- Corners are square. 0–6px, and only controls get the top of that range.
- The rail keeps the ink constant across themes; only the paper flips.

## Colors

A four-ink palette on production stock: near-black ink, fountain red, scene green, and a warm amber for caution.

### Primary
- **Fountain Red — Stamp** (`#b43622`): The active/committed accent. Primary button fill, the active nav item's left marker, the code number of the current page, live status stamps, the "unsaved changes" flag. Its scarcity is the signal.
- **Scene Green — Location** (`#316147`): Healthy/positive state. "Online" gateway badges, "configured" and vision-capable model stamps, a successful simulation reply's left rule.

### Tertiary
- **Craft Amber — Alert** (`#935f06`): Caution, not error. Warning badges ("reconnecting", "unconfigured"), the server-agent danger panel, the "update available" state. Destructive *actions* reuse it rather than introducing a fifth hue.

### Neutral
- **Paper** (`#f4f1ea`): The daylight page. The whole surface is one sheet.
- **Panel** (`#faf8f5`): Section and modal bodies — a half-step brighter than paper so a bordered block reads as raised without a shadow. Inputs use pure white (`#ffffff`) to sit forward of the panel.
- **Ink** (`#171512`): All primary text; the rail background in both themes.
- **Muted** (`#565049`): Secondary text, hints, column labels, mono metadata. Tuned to clear WCAG AA on both paper and ink.
- **Rule** (`#cdc4b3`): The single 1px hairline — table rows, card borders, header dividers. The whole layout is drawn with this line.

### Named Rules
**The One Stamp Rule.** Red marks exactly one thing per screen — what is live right now. If two things compete for the stamp, one of them is wrong.

**The Ink-Line Rule.** Relationships between elements are drawn with a 1px `rule` border or with space. Never with a panel background change alone, and never with a card inside a card.

## Typography

**Display Font:** Oswald (with `system-ui`, sans-serif)
**Body Font:** System CJK sans (PingFang SC / Microsoft YaHei / Noto Sans CJK SC)
**Label/Mono Font:** IBM Plex Mono (with `ui-monospace`)

**Character:** A condensed signage face for headings and figures against a mechanical mono for all data, with a quiet humanist CJK face carrying the prose. The contrast is signage-vs-instrument, not serif-vs-sans.

### Hierarchy
- **Display** (500, 21px, 1.1, `0.05em`): The page title in the header, and the large figure value in a figure block.
- **Title** (500, 16px, 1.2, `0.06em`, uppercase): Section headers (`CardTitle`) and modal titles.
- **Body** (400, 13.5px, 1.6): All Chinese prose, descriptions, hints, form values. Table body sits here.
- **Data** (400, 11px, `0.06em`, uppercase for labels): IDs, timestamps, counts, token totals, the live clock, column headers, status stamps. Tabular numerals on.
- **Label** (400, 11px, `0.16em`, uppercase): Field labels and the `call-label` eyebrow. Muted by default.

### Named Rules
**The Mono-Is-Machine-Rule.** Any value the system produced or an ID it references is mono. Any sentence a human reads is sans. If a string is both, it is mono and the prose moves beside it.

**The Signage Heading Rule.** Headings are display-condensed, uppercase, and tracked. If a heading would need a lowercase Chinese translation that breaks the line, shorten the Chinese instead of dropping the case.

## Layout

A fixed 240px rail on the left, a ruled content column to its right, capped at comfortable measure and padded 16–24px. Sections stack with 16px gaps (`space-y-4`/`space-y-5`); the page never centres itself with a max-width gutter, because it reads as a sheet filling the desk.

Two-column splits use a 2:1 grid for a chart-plus-ledger or a list-plus-detail. Figure strips are a 4-up ruled row on desktop that collapses to 2-up then stacks on mobile, each cell separated by hairlines rather than gaps.

On mobile the rail becomes an off-canvas drawer opened from the header; the content column goes full-width and long forms grow a sticky save bar pinned to the bottom safe area.

## Elevation & Depth

Depth is tonal and ruled, not shadowed. A section is a bordered block on `panel`; the rail is ink; a modal is a panel lifted over an ink scrim. There is exactly one shadow in the system and it is structural: a hard, un-blurred offset shadow (`6px 6px 0 hsl(var(--ink)/0.18)`, with a lighter `4px 4px 0` for toasts) that reads as a second sheet of paper offset beneath the first. No diffused, ambient, or blurred shadows are used.

**The Flat-By-Default Rule.** Surfaces are flat at rest. The only shadow is the hard paper-offset on a sheet that has been laid on top of another (modal, toast) — never on hover, never on cards.

## Shapes

Square is the default. Section borders, table rules, figure cells, stamps, and toasts use 0px radius. Interactive controls (buttons, inputs, select, switches) use the top of the scale, 3–4px, because a control is a small physical object and a knife edge would read as a mistake. Avatars and the brand letter are the only circles, and they are reserved for identity, never for status.

Stamps (badges) are rectangular with a 1px border and no fill — a rubber stamp impression, never a pill or a dot.

**The Square-Stamp Rule.** Status is a rectangle with a border and uppercase mono text. A pill or a coloured dot is a different vocabulary and does not belong here.

## Components

### Buttons
- **Shape:** 3px radius (`rounded`), mono uppercase 13px, `0.06em` tracking, 36px tall (32px for `sm`).
- **Primary:** fountain-red fill, white text.
- **Outline:** transparent with a 1px `rule` border, ink text; hover fills `ink/4%`.
- **Ghost:** no border; hover fills `ink/6%`. Used for row actions.
- **Destructive:** transparent with a 1px `alert`-tinted border and alert text; hover fills `alert/10%`. The dangerous action is legible, not a red button.
- **Hover / Focus:** colour fill only, no lift; focus is a 2px stamp ring at 45% with a paper offset.

### Cards / Containers
- **Corner Style:** 0px.
- **Background:** `panel` on a `paper` page.
- **Border:** 1px `rule`, always.
- **Internal Padding:** 16px body; header 12px/16px with a 1px bottom rule.
- **Rule:** a card never contains a card; grouping inside a card is done with rules and spacing.

### Inputs / Fields
- **Style:** 1px `rule` stroke, white (`field`) background, 3px radius, 36px tall, 13px body text.
- **Focus:** border shifts to `stamp` with a 1px stamp ring; the browser caret is stamp-coloured.
- **Placeholder:** solid `muted`, never below AA.
- **Raw textareas** (keyword lists, whitelists) follow the same stroke/field/focus recipe, mono where the content is machine data.

### Badges (Stamps)
- **Style:** 1px border, transparent fill, 11px mono uppercase, `0.08em` tracking, 0px radius.
- **Variants:** `stamp` (default/active), `location` (success/online), `alert` (warning/danger), `rule`+muted (neutral/inactive).

### Navigation
- **Style:** A fixed ink rail. Items are 13.5px sans with a 17px line icon, a 3px left marker (fountain-red when active, transparent otherwise), and a right-aligned 11px mono code (`01`–`08`). Inactive items are ink-paper at 55% and lift to 85% on hover; the active item is full paper.
- **Mobile:** the same item language inside an off-canvas drawer.
- **The rail pins its own palette** (`.rail`), so the ink stays ink and the accents stay legible in both themes.

### Figure (signature)
A ruled ledger cell: a mono `call-label` (uppercase, tracked) above a large Oswald value, above an optional mono sub-line. Figures sit in a 4-up ruled strip. This is the admin's signature element — the "numbers on the call sheet" — and replaces the reflex stat-card.

## Do's and Don'ts

### Do:
- **Do** draw grouping with 1px `rule` borders and space; keep one flat plane per section.
- **Do** set every system-produced value, ID, timestamp, and count in IBM Plex Mono with tabular numerals.
- **Do** reserve the red stamp for the single live/committed thing on a screen.
- **Do** keep corners square (0px) on surfaces and 3–4px only on interactive controls.
- **Do** carry depth with the hard paper-offset shadow on sheets laid on top of others.

### Don't:
- **Don't** nest a card inside a card; use a rule or spacing instead.
- **Don't** use pills, dots, gradients, glass/blur panels, or diffused shadows.
- **Don't** set Chinese prose in the display or mono face; body text stays in the system CJK sans.
- **Don't** let the rail invert with the theme; it is ink in both daylight and night shoot.
- **Don't** introduce a fifth hue for destructive actions; amber `alert` already carries caution and destructive.
