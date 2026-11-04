# CBA verification suite

Plain Node, no test framework. `01`–`04` exercise the analysis engine; `05` loads the page
in a headless DOM and drives the UI; `06` covers the all-combinations view.

    npm install              # jsdom, for 05 to 11
    npm test                 # extracts the engine and runs every file below

or one at a time:

    ./extract-engine.sh      # pulls the engine out of index.html into engine.js
    node 01-closed-form.js
    node 02-statics-crosscheck.js
    node 03-deflection-refinement.js
    node 04-random-sweep.js
    node 05-ui.js
    node 06-all-combinations.js
    node 07-beam-library.js
    node 08-review-fixes.js
    node 09-recheck-fixes.js
    node 10-third-pass.js
    node 11-final-pass.js

`06` first checks that every combination's results in the all-combinations view are identical
to what the single view reports when that combination is selected (random models plus both
presets), then drives the view itself: legend toggles, Plot checkboxes, pinning, presets and
imports, escaping of combination names, and the long-format CSV.

`02` is the important one: it recomputes shear and moment at every station from the support
reactions and applied loads by free-body statics — sharing no code with the element
recovery — across 500 randomly generated beams.

Re-run `extract-engine.sh` after any edit to the engine section of `index.html`.

`07` covers the beam library: the section-property helper against an independent
integration of the drawn outline and against published section tables, the library
bookkeeping (parsing beams.json, replaying edits on a newer GitHub copy), missing and
carried sections, and the Beams tab driven against a mocked GitHub API. The shipped page has
an empty library, so `04`, `05` and `06` use the beams in `test-beams.js`.

`08` reproduces each defect found by an independent review of the beam library and checks the
fixed behaviour: edits made while a save is in flight, colleagues' changes to the same beam,
hand-written fields in beams.json, pasted tables with thousands separators, quoted CSV and
ambiguous column names, the own-values form, focus and screen-reader announcements, and saved
section copies. `09` does the same for the second review, which re-ran the first review's
reproductions against the fixes and looked for defects the fixes introduced, and `10` for the
third, and `11` for a last pass over the third round's changes. `07` to `11` share the mocked
GitHub in `dom-harness.js`.
