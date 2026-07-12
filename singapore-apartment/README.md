# Singapore Rental Property Investment Calculator

Self-contained static SPA (`index.html` + `app.js`) that loads `data/*.json` at runtime via
`fetch()`. Nothing is embedded in the JS/HTML — the data files are the source of truth.

## Viewing locally

Opening `index.html` directly (`file://`) will **not** work — browsers block `fetch()` of local
files without a server. Run:

```
cd singapore-apartment
python3 -m http.server 8000
```

then open `http://localhost:8000`.

## Publishing

Once pushed to this repo, GitHub Pages serves it over HTTPS at
`https://rohitmukherjee.github.io/singapore-apartment/` and `fetch('data/...')` works normally
(no server setup needed). This repo's root `index.html` (your main site) is untouched.

## Regenerating the data

`build_data.py` rebuilds `data/sales.json`, `data/rent.json`, `data/prob_data.json`, and
`data/meta.json` from raw URA-style CSVs:

```
python3 build_data.py --source /path/to/sg-rental-apartment-analysis/data
```

It auto-discovers every `*.csv` under `<source>/sales/` and `<source>/rental/` — district is
read from each row's `Postal District` column, not the filename. Drop a new CSV (any filename)
into either folder and re-run; new districts appear automatically, in the app too (district
chips are built from whatever's actually in the loaded data, not a hardcoded list).

This only works automatically if new CSVs have the same column headers as the existing ones
(standard URA caveat / rental-contract export format — see the docstring at the top of
`build_data.py`). A schema mismatch raises a `KeyError` naming the missing column; it will not
silently guess.

A file that's empty or fails to parse is skipped with a printed warning and listed in
`meta.json`'s `corrupted_files_this_run` — never silently dropped, never estimated.

## Methodology notes

- Sales rows have no bedroom count; size (350–1000 sqft, split into three bands: A 350–550 ~1BR,
  B 550–750 ~1.5BR, C 750–1000 ~2BR) is the proxy. Rental rows have a real bedroom field.
- Matching for yield/cash-flow analysis is by **district + project + size band**, not just
  project name — a project's sale price is only compared against rent for similarly-sized units.
- The "probability of breaking even" panel is precomputed in `build_data.py` (full cross-product
  of every real transacted price × every real transacted rent for a group, at 17 LTV checkpoints
  from 20–100%, for each of ALL/freehold/leasehold tenure) because that's too heavy to redo
  per-click in-browser at full population size. The app interpolates between checkpoints.
- Year-1 mortgage interest is computed exactly via amortization (not the flat `loan × rate`
  approximation, which overstates it by ~1.2% at 1.75%/30yr).
- Income tax on rental profit uses Singapore's actual progressive resident brackets (IRAS, YA2024
  onwards, unchanged through YA2026), applied to the profit as the TOP slice stacked on the buyer's
  other chargeable income (`baseIncome`/`BASE_INCOME`) — not a flat guessed rate. Defaults to $0
  (no assumption about the buyer's other income); editable per-scenario in the calculator
  (`cIncome`), fixed in `build_data.py` for the precomputed probability panel (re-run to change).
- Property tax uses the non-owner-occupied residential AV brackets (12%/20%/28%/36% at
  $30k/$45k/$60k, IRAS, effective 1 Jan 2024, unchanged through 2026) applied to the property's
  FULL annual market rent (not vacancy-discounted) — IRAS assesses Annual Value from comparable
  market rentals regardless of the owner's actual vacancy.
- The calculator's "Upfront cash required" section computes Buyer's Stamp Duty (progressive 1–6%
  scale, effective 15-Feb-2023) and Additional Buyer's Stamp Duty (flat rate depending on buyer
  citizenship/PR status and existing property count, effective 27-Apr-2023) per current IRAS
  rates, plus optional buyer's-agent commission (0% by default — the seller normally pays the
  transaction agent in SG resale deals) and legal/misc costs.
- The "Opportunity cost of capital" section compares the total capital outlay (down payment + BSD
  + ABSD + agent + legal) compounding at an assumed investment CAGR against the property's own
  value compounding at a REAL historical appreciation rate computed from transacted PSF data for
  that specific project (falling back to the district if the project's own sale history has fewer
  than 8 transactions). This is not a leverage-adjusted equity comparison — the property line
  tracks the full (mostly-loan) purchase price, not net equity after the mortgage balance.
- Cash-flow assumptions are set in both `build_data.py` (server-side, baked into `prob_data.json`)
  and the in-page calculator (client-side, live-editable): 1.75% p.a., 30yr, $500/mo MCST, $300/yr
  insurance, 4.2% agent commission, 2% repairs reserve, 1 month/yr vacancy. Only the
  calculator/breakeven tables respond to changes in these — the probability panel is fixed to the
  values baked in at generation time (re-run `build_data.py` to change them there).
