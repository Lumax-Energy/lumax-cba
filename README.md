# CBA — Continuous Beam Analysis

Offline Euler–Bernoulli continuous beam analysis for Lumax Energy.

**Live site:** https://lumax-energy.github.io/lumax-cba/

Single-page app — open `index.html` or use GitHub Pages above.

Formerly Spanline; renamed to **CBA**.

See `VERIFICATION.md` for the validation record and the list of corrections applied.

## Beam library

Beams are not built into the page. They live in [`beams.json`](beams.json) in this repository
and are added, edited and deleted on the app's **Beams** tab, which can calculate section
properties from dimensions or take a pasted supplier table. "Save to GitHub" commits the
file using a GitHub token (fine-grained, this repository only, Contents: read and write);
the live site picks the change up within about a minute. Beams a colleague saved in the
meantime are kept; if a colleague changed or deleted a beam that was also edited here, nothing
is written until you choose which version to keep. `beams.json` can also be edited by hand on
GitHub: fields the app does not use are kept as written.

## Tests

    cd test
    npm install
    npm test
