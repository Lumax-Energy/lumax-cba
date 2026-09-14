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
