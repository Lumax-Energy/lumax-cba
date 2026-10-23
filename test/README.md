# CBA verification suite

Plain Node, no test framework. `01`–`04` exercise the analysis engine; `05` loads the page
in a headless DOM and drives the UI; `06` covers the all-combinations view.

    npm install jsdom        # only needed for 05-ui.js and 06-all-combinations.js
    ./extract-engine.sh      # pulls the engine out of index.html into engine.js
    node 01-closed-form.js
    node 02-statics-crosscheck.js
    node 03-deflection-refinement.js
    node 04-random-sweep.js
    node 05-ui.js
    node 06-all-combinations.js

`06` first checks that every combination's results in the all-combinations view are identical
to what the single view reports when that combination is selected (random models plus both
presets), then drives the view itself: legend toggles, Plot checkboxes, pinning, presets and
imports, escaping of combination names, and the long-format CSV.

`02` is the important one: it recomputes shear and moment at every station from the support
reactions and applied loads by free-body statics — sharing no code with the element
recovery — across 500 randomly generated beams.

Re-run `extract-engine.sh` after any edit to the engine section of `index.html`.
