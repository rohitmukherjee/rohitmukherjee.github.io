# Singapore Rental Property Investment Calculator

A static, self-contained web app for analyzing 1 to 2 bedroom condo investments in Singapore,
plus an offline notebook that fits a stochastic price-rent model over the same transaction data.

The app runs entirely in the browser. It loads precomputed JSON from `data/` at runtime and
performs deterministic cash-flow arithmetic (amortization, stamp duties, progressive income tax)
on the client. All statistical modeling happens offline in the notebook, never in the browser.

## Overview

The project has two independent parts that share one `data/` folder:

| Part | Files | Role |
| --- | --- | --- |
| Website | `index.html`, `app.js` | Live cash-flow calculator, yield tables, break-even screens, trend charts. Deterministic arithmetic only. |
| App data builder | `build_data.py` | Aggregates raw URA-style CSVs into `sales.json`, `rent.json`, `prob_data.json`, `meta.json`. |
| Model notebook | `sg_price_rent_model.ipynb` | Fits the price-rent econometric model and runs the Monte-Carlo grid. Writes `series.json`, `model_params.json`, `mc_grid.json`, `model_meta.json`. |

Each JSON artifact is independently shippable. The website degrades gracefully: if the model
artifacts are absent, the calculator still works and the stochastic-model card stays hidden.

## Data artifacts

| File | Produced by | Contents |
| --- | --- | --- |
| `sales.json` | `build_data.py` | `[district, project, tenure, sqft, psf, price, "YYYY-MM"]` per sale. |
| `rent.json` | `build_data.py` | `[district, project, bed, sqft, rent, "YYYY-MM"]` per lease. |
| `prob_data.json` | `build_data.py` | Break-even probabilities at 17 LTV checkpoints, per district/project/size band/tenure. |
| `meta.json` | `build_data.py` | Generation stamp and cash-flow assumptions for the probability panel. |
| `series.json` | notebook | Quarterly sale-PSF and rental-PSF medians per district and size band. |
| `model_params.json` | notebook | Fitted price-rent econometrics per segment, each with an uncertainty flag. |
| `mc_grid.json` | notebook | Monte-Carlo terminal-wealth summaries (buy vs ETF) and break-even appreciation, on an interpolable grid. |
| `model_meta.json` | notebook | Model provenance: data range, model specs, MC seed and path count, grid axes. |

## Before you begin

The notebook depends on pandas, numpy, statsmodels, scipy, and Jupyter. Dependencies
are declared in `pyproject.toml` and pinned in `uv.lock`. This project uses
[uv](https://docs.astral.sh/uv/) to manage the environment.

1.  Install uv, if you do not have it:

    ```
    pip install uv
    ```

2.  Create the environment and install the locked dependencies:

    ```
    cd singapore-apartment
    uv sync
    ```

    This reads `pyproject.toml` and `uv.lock`, creates `.venv/`, and installs everything.
    Rerun `uv sync` whenever `uv.lock` changes.

## View the website locally

Opening `index.html` from the filesystem does not work, because browsers block `fetch()` of
local files. Serve the folder over HTTP:

1.  Start a local server:

    ```
    cd singapore-apartment
    python3 -m http.server 8000
    ```

2.  Open `http://localhost:8000`.

Once pushed to this repository, GitHub Pages serves the app over HTTPS at
`https://rohitmukherjee.github.io/singapore-apartment/`, and `fetch('data/...')` works with no
server setup.

## Regenerate the app data

`build_data.py` rebuilds `sales.json`, `rent.json`, `prob_data.json`, and `meta.json` from raw
URA-style CSVs.

1.  Run the builder against a source folder that contains `sales/` and `rental/` subfolders:

    ```
    python3 build_data.py --source /path/to/realis-export/data
    ```

The builder auto-discovers every `*.csv` under `<source>/sales/` and `<source>/rental/`. District
is read from each row's `Postal District` column, not the filename, so a new district appears
automatically in the app the moment its rows are present. A file that is empty or fails to parse
is skipped with a warning and listed in `meta.json`, never silently dropped and never estimated.

New CSVs must use the same column headers as the existing files (the standard URA and
rental-contract export format documented at the top of `build_data.py`). A schema mismatch raises
a `KeyError` naming the missing column.

## Regenerate the model

`sg_price_rent_model.ipynb` fits the econometric model and runs the Monte-Carlo grid, then writes
the four model artifacts into `data/`.

1.  Open the notebook and edit the configuration cell if needed. The common settings are:

    | Setting | Purpose |
    | --- | --- |
    | `HISTORICAL_SALES_SOURCE`, `HISTORICAL_RENT_SOURCE` | Input paths. Today they point at `data/sales.json` and `data/rent.json`. Point them at a longer REALIS export when you have one. |
    | `SOURCE_KIND` | `"app_json"` for the current array-of-arrays files, or `"realis_csv"` for the future long export (adapter stub included). |
    | `DATE_RANGE` | `None` for all history, or a `("2006-Q1", "2026-Q2")` window. |
    | `FIT_LEVEL` | `"auto"` picks the finest level the data supports. Today it resolves to `district`; with roughly 40 or more quarters per band it upgrades to `district_band` on its own. |

2.  Run the whole notebook from a clean state (Kernel, then Restart & Run All). It is designed to
    run top to bottom without manual intervention.

    To run it headless from the command line:

    ```
    uv run jupyter nbconvert --to notebook --execute --inplace sg_price_rent_model.ipynb
    ```

3.  Confirm the four artifacts were rewritten in `data/` and reload the website.

### Data limitation

The current dataset covers roughly 5 years (about 20 quarters, a single market regime). The
cointegration, VECM, and OU estimates are therefore statistically weak. The notebook computes and
stores them anyway, so the pipeline is ready for a longer history, and flags every fitted block as
`low_confidence`. The website labels these outputs as provisional and gates the load-bearing
readouts on the fitted flag. When you drop in a longer series and re-run, the flags clear on their
own, structural-break detection becomes meaningful, and the fit level can upgrade to per-band.

Compare successive `model_params.json` and `model_meta.json` across data refreshes to catch
parameter instability.

## Methodology notes

- Sales rows have no bedroom count, so size is the 1 to 2 bedroom proxy: band A is 350 to 550 sqft
  (about 1BR), band B is 550 to 750 sqft (about 1.5BR), band C is 750 to 1000 sqft (about 2BR).
  Rental rows carry a real bedroom field.
- Yield and cash-flow matching is by district, project, and size band, not project name alone, so a
  project's sale price is only compared against rent for similarly sized units.
- Year-1 mortgage interest is computed exactly through amortization, not a flat `loan x rate`
  approximation.
- Income tax on rental profit uses Singapore's progressive resident brackets (IRAS, YA2024
  onwards), applied to the profit as the top slice on the buyer's other chargeable income.
- Property tax uses the non-owner-occupied AV brackets (IRAS, effective 1 Jan 2024) on the full
  annual market rent, since IRAS assesses Annual Value from comparable rentals regardless of actual
  vacancy.
- The Monte-Carlo terminal wealth is after tax, after exit costs (selling agent commission and
  Seller's Stamp Duty when inside the holding window), and inflation adjusted (real). Rent and
  expenses grow rather than staying frozen while value compounds. The opportunity-cost and
  appreciation-drift assumptions are user set, because the data does not pin them down.

## Project layout

```
singapore-apartment/
  index.html                 Website markup and styles
  app.js                     Website logic (deterministic, reads data/*.json)
  build_data.py              App data builder (CSV to sales/rent/prob/meta JSON)
  sg_price_rent_model.ipynb  Model notebook (fits model, writes model artifacts)
  data/                      All JSON artifacts
  README.md                  This file
```
