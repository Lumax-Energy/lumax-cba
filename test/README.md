# CBA verification suite

Plain Node, no test framework. `01`–`04` exercise the analysis engine; `05` loads the page
in a headless DOM and drives the UI.

    npm install jsdom        # only needed for 05-ui.js
    ./extract-engine.sh      # pulls the engine out of index.html into engine.js
    node 01-closed-form.js
    node 02-statics-crosscheck.js
    node 03-deflection-refinement.js
    node 04-random-sweep.js
    node 05-ui.js

`02` is the important one: it recomputes shear and moment at every station from the support
reactions and applied loads by free-body statics — sharing no code with the element
recovery — across 500 randomly generated beams.

Re-run `extract-engine.sh` after any edit to the engine section of `index.html`.
