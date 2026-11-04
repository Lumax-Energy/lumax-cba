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

**Section library.** The built-in IPE table has since been removed; see "Beam library" at
the end of this note.

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

## Beam library (beams.json)

The hardcoded IPE section table is gone. Beams now live in `beams.json` at the root of this
repository and are maintained on the new **Beams** tab:

- **Add beam** opens a helper: pick a shape (rolled I/H, parallel-flange channel, cold-formed
  lipped or plain C, RHS/SHS, CHS, solid bar, or direct entry), type the dimensions, and A, I,
  Z, Av, the bending-axis height and the mass are worked out as you type, with a drawing of
  the section. Supplier figures can be entered instead; each one is shown against the
  calculated value, and anything more than 5 % away is highlighted (a cm⁴ typed as mm⁴ shows
  up at once). **Paste table** takes rows copied from a supplier's spreadsheet, in mm or cm
  units, and says which rows it could not read.
- New and edited beams are kept in the browser straight away. **Save to GitHub** commits
  `beams.json` to `main` through the GitHub API with a token the user supplies (kept in memory
  unless "Remember" is ticked). The edits are replayed on the file as it is on GitHub at that
  moment, so a colleague's additions made meanwhile are kept, and a write that races another
  is refused by GitHub and retried. A `beams.json` the app cannot fully read is never
  overwritten. The live site serves the same file, so everyone sees a saved beam within about
  a minute.
- A model stores a copy of the properties of every library beam it uses (`sectionDefs`). If
  a beam is later deleted or renamed, the model still analyses with its copy and the QA tab
  says so. A section name found in neither place stops the analysis with **MISSING SECTION**
  instead of quietly using the Custom properties, which is what the old code did with an
  unknown name. Saved models that used an IPE section therefore stop with that message until
  another section is chosen or the beam is added to the library.
- The 3-span preset now uses Custom properties with the same values as before (I = 19.43e6
  mm⁴, Z = 194.3e3 mm³, A = 2850 mm², Av = 1120 mm²), so its results are unchanged.

**Section helper checks** (`test/07-beam-library.js`):

- Every shape is built from rectangles and annular circular sectors with exact closed-form
  moments. 720 random sections (120 per shape) were compared with an independent Green's
  theorem integration of the drawn outline: the worst disagreement in A, I, Z or the axis
  position is below 1e-6.
- Against published nominal tables: rolled I 200×100 (IPE 200), HE 200 A, HE 300 B, UPE 200,
  CHS 48.3×3.2 and SHS 100×100×5 (EN 10219) all agree within 0.1 % for A, I and Z.
- Impossible dimensions (a lip shorter than the bend, flanges thicker than the depth, walls
  thicker than the radius) are refused with a reason.
- Shear area conventions: I and channel h·tw, lipped C h·t, RHS 2·h·t, CHS 2A/π, bar A.
- Calculated properties are nominal gross values. For thin cold-formed sections the stresses
  reported on the gross Z can be unconservative where the section buckles locally; the helper
  says so on the form.

**Library and GitHub checks** (same file): parsing of hand-edited files (bad or repeated names
dropped and counted, unknown fields kept), replay of edits on a newer GitHub copy, missing and
carried sections in the engine, and the Beams tab driven in jsdom against a mocked GitHub API:
add, validate, override, use, delete with confirmation, undo, paste in cm, save with a 409
conflict and retry, rejected token, malformed remote file, first save creating the file,
token never stored unless asked and never written into the model or the cache, and a reload
before Pages has republished not undoing a save.

The test files now set a non-zero exit code on failure (`01`, `02`, `04`, `05`, `07`, as `06`
already did), and `cd test && npm install && npm test` runs the whole suite.

### Independent review of the beam library

Four reviewers (calculator and engine, GitHub sync, UI and security, regressions against the
previous version) looked for defects, and each finding was then checked by a second reviewer
trying to refute it. 34 were confirmed and all are fixed; `test/08-review-fixes.js` reproduces
each one. The ones that could change results or lose data:

- **Edits made while a save was in flight were lost.** The save cleared every pending edit when
  it finished, including ones made while it was waiting for GitHub. Now only the edits it wrote
  are cleared; later ones stay pending ("1 later change is still to save"). Discard and Reload
  are disabled while saving.
- **A colleague's change to the same beam was overwritten without notice.** Every edit now
  remembers the GitHub version it started from. If GitHub's copy has changed since (edited,
  deleted, or a beam added under the same name), nothing is written: both versions are listed
  and the user keeps GitHub's or their own, per beam.
- **Thousands separators were read as decimal commas.** A cell copied as `1,943` became 1.943,
  so I or A came out 1000 times too small, with no error. Values that can be read either way are
  now refused unless the rest of the table shows its decimal mark (`28.5` elsewhere means commas
  group thousands; `28,5` means the opposite; a semicolon-separated file implies decimal
  commas). Every pasted row and every value typed into the form is also checked for physical
  consistency: Z² ≤ A·I for any section, and I/Z between h/2 and h when the depth is known.
  That catches unit slips (cm⁴ against mm³) and misread separators.
- **Ambiguous column names.** `Zx`, `Sx` and `W` were taken as the elastic modulus, but tables
  use them for the plastic modulus or the weight per metre, and `d` was taken as the depth (often
  the straight web depth). These are no longer read; `Wel`, `Wel,y`, `Zex`, `Ze` and `Z` are.
  `W (pl)` is not read as `W`. Quoted CSV cells keep their commas. A units option for tables in
  10³ mm², 10⁶ mm⁴ and 10³ mm³ was added, and the unit hint suggests whichever unit makes every
  row consistent.
- **"Enter my own values" kept stale numbers.** Values filled in from the calculation stayed
  fixed when a dimension or the material changed afterwards, and were saved. Fields the user has
  not typed in now follow the dimensions and material; a blank mass comes from the area actually
  used.
- **Editing a beam changed fields the form does not show.** A supplier's mass was replaced by
  the calculated one, and hand-added fields (grade, part number, who added it) were dropped. An
  edit now changes only what the form edits. Saving writes untouched beams, and top-level fields,
  back exactly as they were in beams.json; `steel` and `Aluminum` are recognised.
- **Importing a colleague's file replaced its section properties with a different local
  library entry of the same name.** The file's copy is now kept; the analysis uses the library
  values and the QA tab lists the differences, with a button on the Beams tab to adopt the
  library's values. The same applies when a beam is changed on GitHub after a model was saved.
- **A saved copy of a section was deleted as soon as nothing used it**, so choosing another
  section and going back lost its properties. Copies of sections that are in no library are now
  kept and listed in the section selects as "(saved copy)".
- **Two open tabs overwrote each other's unsaved library edits**, and a library reload in one
  tab wrote its older model over the other tab's newer one. Tabs now pick up each other's library
  edits, and the model is written only when it changes.
- **The status could be decided by a section's name.** "INVALID GEOMETRY" was found by searching
  the warning text, which now quotes section names ("… non-positive camber"). It is a flag now.
- A model file without section names, or a default section nobody has, is handled (Custom, and a
  warning with the I shown as unknown rather than 0).

Smaller fixes: a refusal from GitHub that is not a race (a branch rule) is shown with GitHub's
own message instead of being retried; files over 1 MB are read; Undo of a delete no longer
replaces a newer beam named in other capitals; a model section that differs from a library beam
only in capitals can be pointed at the library's; a section nobody has gets an "Add" button that
opens the form under its name; suggested names give the wall thickness exactly (0.75, not 0.8);
clearing the name while editing no longer renames the beam to an unseen suggestion; the token
field no longer swallows the click that follows it; a save finishing no longer takes the field
being typed in; Delete and Discard confirmations lapse on any other click; row buttons name their
beam for screen readers, focus stays near the action, and messages are announced once through a
single live region.

Kept as decided: the IPE sections stay out of the library, as asked. A model saved with one
stops with **MISSING SECTION**, and the Beams tab names the section with a button to add it.

### Second review

The four reviewers then re-ran every reproduction against the fixed code, and looked for defects
the fixes had introduced; a second reviewer again tried to refute each. 32 of the 34 original
findings were confirmed fixed; three had loose ends, and 22 new defects were confirmed, two of
medium severity. All are fixed and reproduced in `test/09-recheck-fixes.js`:

- **An idle second tab wrote its older model over newer work** when the library changed in
  another tab (or on a reload), because the model's saved section copies followed the library
  and the changed model was then saved. Library updates that arrive by themselves now change the
  model in memory only; the model is written only by actions taken in that tab.
- **Edits made during a save that undid what it wrote** (deleting a beam the save was adding, an
  Undo of a delete being saved, a Discard in another tab) were lost. Every beam edited while a
  save is in flight now ends up exactly as this browser shows it, as a pending change if needed.
- Conflicts: a delete of a beam a colleague had only re-capitalised vanished instead of becoming
  a choice; a beam GitHub already held exactly as wanted (a save whose reply was lost) was
  reported as a conflict; a resolved conflict came back while the live site still served an older
  revision; and a 404 from GitHub when the token cannot see the repository emptied the local
  library and was shown as a colleague's delete. All fixed.
- Paste and form: a dot used to group thousands ("36.920.000" beside "5.383") is now read the same
  way in every field of the form, as for a table. Units written in the column titles, or in a
  units row under them, are read: a table whose titles contradict the units setting is refused,
  naming the right units, and h given in cm or m is converted. The consistency check is now
  two-sided: A·I may not exceed 12·Z² (beam sections stay well below), which catches a table read
  in units that are too large, and a given mass must match A for the material. Non-numbers such as
  "n.a." no longer sway the decimal mark, a CSV row with more cells than titles is refused (usually
  unquoted thousands separators), and quoted cells may contain line breaks. (The ratio check
  catches a table read in 10³ units by mistake. A table read in cm instead of mm, or the reverse,
  keeps every ratio, so only a depth or a mass shows it: see the third review.)
- "custom" in any capitals is the model's own section, as it was before. A missing section that
  differs from a library beam only in capitals or spaces offers that beam; "Add" opens the form
  under a name it can accept and points the model at the new beam.
- A saved copy that differs from the library survives being briefly unused, and unused saved
  copies are listed on the Beams tab with a button to remove them.
- Editing a calculated beam with "Enter my own values": the values not typed in now follow the
  dimensions, as when adding. Long notes and large hand-added fields survive an edit unchanged.
- A render waiting for a field to be left now waits for the click that left it, so that click is
  never lost; focus moves on after pasting, saving, reloading, forgetting the token and resolving
  conflicts; and a second message with the same text is announced again.

### Third review

The same four reviewers re-ran the second round's reproductions (24 of 27 confirmed fixed) and
probed the newest code; 13 new defects were confirmed, two of medium severity. All are fixed, with
the three loose ends and three further reports that had not been verified, and
`test/10-third-pass.js` reproduces each:

- **Editing a calculated beam with a decimal comma misread the stored dimensions.** The form took
  its decimal mark from every field, including the dimensions the app had filled in itself
  ("200.406"), so typing "7,6" in one field turned those into 200406 mm and saved a section a
  million times too large. Only fields typed since the form opened now decide the mark; the app's
  own values are read as written. A dimension over 3 m is refused as a backstop.
- **An Edit form opened before the library refreshed overwrote a colleague's change.** The form
  now remembers the GitHub version it was filled from, so a change (or delete) that arrives while
  it is open becomes a choice when saving.
- **mm and cm tables that state no units** cannot be told apart by the ratio checks. The paste
  preview now shows each section's depth (2·I/Z), and a hint names every row that would be
  shallower than 40 mm (read in mm) or deeper than 1.2 m (read in cm or 10³ units), whether or not
  the table states its units. A lone "1.808" for a section property in a table
  or form with no other decimal clue is refused as ambiguous, like "1,808".
- Units in tables: multipliers ("mm² ×10²", "10³ mm²", a lost superscript "x 102") are read per
  column and matched to a unit system; units rows may be labelled ("Units") or come as two rows
  (unit, then multiplier); bracketed units in a units row, and words such as "(nominal)" or
  "(in cm2)", are read correctly. The delimiter is found outside quoted cells (a wrapped first
  title), ditto marks no longer swallow rows, and names are whitespace-normalised, so a wrapped
  name cell or a double space matches the beam it looks like.
- The bound A·I ≤ 12·Z² refused genuine tees cut from wide column sections (up to 13.7); it is now
  20, which every slip it is meant to catch still exceeds by far.
- Sync: a deleted beams.json is told apart from a token that cannot see the repository (the
  repository is asked) and is created again on saving; a save whose reply is lost is recognised by
  reading the file back, so edits made meanwhile are handled as after any save; deleting and
  restoring a beam during a save no longer turns a colleague's merged change into a conflict.
- Section copies that start-up made from the browser's cached library follow GitHub's version when
  it loads, instead of being taken for copies saved with the model; an element whose section is
  empty follows the default section again, as before.
- A render waiting for a field now also waits while a select is being opened and while the user
  moves between fields, so a caret, a selection or an open list is never disturbed; a closed select
  or a link gets its focus back after the page is redrawn. Meanwhile the header's status badge and
  summary line, and the Beams tab's status line, buttons and messages, are updated in place, so
  the page never shows results the model no longer gives, and the message is announced.

A last focused pass over these changes (two reviewers, each finding checked by a third) confirmed
them and found four further defects, all fixed and reproduced in `test/11-final-pass.js`: a page
that kept showing the previous results while a closed select had focus; a deleted beams.json being
written back with only the pending edits (it is now written from the whole library shown); unit
multipliers written without an "x" ("mm²" then "10²", "(10² mm²)", "×100"); and a save whose reply
was lost while the connection stayed down, which is now checked at the next save or reload.
