# CBA — verification and corrections

Continuous Beam Analysis, Lumax Energy. This note records what was checked, what was
found to be wrong, and what was changed. The app remains a single dependency-free
`index.html`.

## Verification performed

The solver was checked three independent ways.

**1. Closed-form solutions.** Simply supported spans under full and partial UDL, off-centre
point loads and applied moments; cantilevers under tip load and UDL; propped cantilever;
two-span continuous beam; overhangs; self-weight. Reactions, shear, bending moment,
deflection and end slope all match theory to machine precision (worst error ~1e-13).

**2. Free-body statics at every station.** For each station the shear and moment were
recomputed from the support reactions and the applied loads alone — a calculation that
shares no code with the element recovery — and compared against what the engine reports.
Run over 500 randomly generated beams (random span counts and lengths, random support
types, mixed load types and load cases). Worst disagreement: 3e-12 %.

**3. Mesh refinement.** Every element was subdivided and the beam re-solved. Coarse and
refined models agree on deflections, moments and reactions to ~1e-13.

**Section library.** All 15 IPE sections were checked against EN 10365 nominal values —
mass, h, tw, tf, I, Z and A are correct. `Av` is the web area h·tw, which is consistent
with the "average shear stress" label the app uses.

**Runtime.** The page was loaded in a headless DOM and every tab, both presets, geometry
edits, load add/remove, support changes, blanked-out numeric fields, probe clicks and both
exports were exercised. No JavaScript errors. A 1000-model random sweep produced no
exceptions, no non-finite outputs, and no equilibrium or continuity failures.

## Corrections

### 1. A load sitting exactly at x = 0 was dropped at that station

`macaulay()` tested `x > a`, so a point load or applied moment placed at the very start of
the beam was excluded from the station at x = 0. At interior nodes the other face of the
discontinuity is carried by the adjacent element's station, but at x = 0 there is no
element to the left, so the step was simply lost.

Effect: a 30 kNm moment applied at the left support of a 6 m span reported a peak hogging
moment of **−28.8 kNm instead of −30.0 kNm** — a design value understated by 4 %.

Fix: `macaulay()` takes a `rightLimit` flag, used only for the first station of the first
element, so that station reports the limit from inside the beam.

### 2. Reported extrema were limited by station spacing

Peaks falling between stations were understated: 1.2 % at 13 stations/element, 0.16 % at
the default 26. The reported location of the peak was out by a similar margin.

Fix: after the base stations are built, exact stations are inserted at the zero-crossings
of the combined shear (a stationary bending moment) and of the combined rotation (a
stationary deflection), for every combination with non-zero factors. Shear is linear
between neighbouring stations so its zero is found exactly; the rotation zero is bisected.

The two-span benchmark now returns 54.0000 kNm at x = 3.000 (exact) at every station
density, instead of 53.9136 at x = 2.880.

Cost: analysis of the 12-span preset went from ~7 ms to ~18 ms. Re-render happens on
`change`, not per keystroke, so this is not perceptible.

### 3. The deflection check compared unrelated quantities

It took the largest deflection anywhere on the beam and divided it by the **longest** span.
A 3 m overhang tip deflecting 9.71 mm was judged against a 2.5 m backspan's allowance and
returned 0.97 utilisation — while the actual span deflection was 0.66 mm. A pure cantilever
had fewer than two vertical supports, so `longestSpan` was 0 and the check silently
returned "N/A" — no check at all.

Fix: each span between consecutive vertical supports, and each overhang, is now checked
against its own length. The card shows a per-segment table and names the governing
segment. Cantilevers are measured on the overhang length; if the project convention is
2 × the overhang, adjust the limit accordingly.

Knock-on effect worth noting: the 3-span preset's utilisation moved from 0.392 to 0.471,
because the governing deflection sits in a 5 m end span that was previously being judged
against the 6 m centre span.

### 4. Silent input truncation

UDLs extending past the ends of the beam, and models declaring more than 24 elements, were
quietly clipped with no indication. Sections with Z or Av of zero reported stress as zero
rather than flagging it. All four now raise warnings on the QA tab.

### 5. Header showed an irrelevant second moment of area

The meta line always printed `I default {customI}`, even when the default section was a
library section — so it could display an I belonging to nothing in the model. It now names
the default section and its actual I.

### 6. Custom section fields were wrongly locked

The I / Z / A / Av inputs were enabled only when the **default** section was "Custom". An
element individually set to "Custom" used those values but the user could not edit them.
They are now enabled whenever any element uses a custom section.

### 7. Default combinations contradicted their own factors

`1.2 G + 1.6 Q1` was labelled class "Service" with the note "Unfactored service
combination". This matters because the deflection check runs on whichever combination is
selected, so the shipped default was checking deflection under factored loads.

The factors were **not** changed — they remain the user's design-basis responsibility — but
the classes and notes now say what the numbers actually are, and the first user slot has
been replaced with an unfactored `SLS G+Q1` combination for serviceability checks. Note
that the shipped set still mixes 1.2/1.6 with 1.35 for G; confirm the whole set against the
project design basis before use.

## Not changed

- Roller and pinned supports behave identically, since the model carries no axial degree of
  freedom. That is correct for this element type.
- Self-weight uses ρ·A rather than the catalogue mass per metre. The difference is under
  0.2 % and ρ·A is the only option available for custom sections.
- The 24-element limit is unchanged; it is now reported rather than silent.

## All-combinations view (added)

The selected-combination dropdown, the Combinations tab and a new toggle at the top of the
Results tab all offer **All combinations**. In that view every combination with a non-zero
factor is drawn on the shear, moment, deflection, slope, shear-stress and bending-stress
diagrams at once, one colour per combination, with the envelope as a faint band behind them.
Hovering a diagram lists every combination's value at that station; clicking pins it. Below
the diagrams: the governing value of each extremum and which combination produces it,
extrema per combination, support reactions per combination with max / min, the deflection
check per combination, and the station table for any one quantity across all combinations.
Combinations can be hidden from the legend or with the Plot column on the Combinations tab;
when any are hidden, a warning above the governing values says so. CSV export in this view
writes every shown combination in long format, with element and face columns so the two
rows at a node stay distinct. On the schematic, each support shows the largest reaction over
the smallest across the shown combinations.

**How it was checked.** The per-combination results come from the same function that
produces the selected-combination results, so the two views cannot disagree.
`test/06-all-combinations.js` confirms it: for both presets and 150 random models, each of
1,558 combination results is identical, value for value, to what the single view reports
when that combination is selected. Engine tests `01`–`04` and the UI test `05` produce the
same output as before the change. The view was then reviewed independently (engine
equivalence, UI state and edge cases, pointer mapping and layout at desktop and phone
widths, engineering presentation, performance), and every confirmed finding was fixed. The
fixes were re-checked against the reviewers' own reproductions, in jsdom (`06`) and, for
scrolling, focus, resizing and pointer mapping, which jsdom cannot see, in real Chrome.

Fixed along the way, affecting both views:

- On screens wider than about 950 px the diagrams are centred with blank margins, but hover
  and click positions were scaled by the full element width, so near the ends of the beam the
  pinned station was off by up to a fifth of the beam length (correct only at midspan).
  Pointer positions now account for the margins.
- On a phone the Results tab scrolled sideways because a wide table stretched the whole
  column. Wide tables now scroll inside their own card.
- On a phone the diagrams drew as a thin strip with unreadable labels. Below 640 px they are
  now laid out on a narrower canvas that fills the width. Rotating the phone redraws only
  the diagrams, so a field being typed in and the scroll position are kept.
- Pinning a station re-rendered the page and could move the diagram that was clicked; the
  clicked block now stays where it was, and the tables keep their scroll position, down and
  across.
- Toggling a button, select or checkbox from the keyboard sent focus back to the top of the
  page; focus now stays on that control.
- The station tables are skipped by the browser's layout while off screen. On the largest
  model the program allows (24 elements, 51 stations each, 12 combinations) a re-render
  went from about 350 ms to about 170 ms in the all-combinations view and from about 260 ms
  to 130 ms in the single view. Clicking a row of the station table itself is still slow on
  that model (about half a second), because the table is on screen and has to be laid out.
- A hand-edited file with a missing, numeric or repeated combination id could make two
  rows share a result, colour or selection. Ids are now made unique when a file is loaded.
- Tiny negative values were displayed as `-0`; they now read `0`.
