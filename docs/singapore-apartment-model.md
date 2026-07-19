# Singapore price-rent stochastic model

A technical report on the offline econometric and Monte-Carlo pipeline that powers the
stochastic-model card in the Singapore Rental Property Investment Calculator.

**Audience.** You are reading this because you want to know exactly what the numbers on
the page mean, how they were computed, and where the honest limitations are. It is not
a user guide; the README covers that.

**Date of writing.** 2026-07-19, on ~5 years (22 quarters) of URA-style transaction data.
Numbers quoted below are from the current fit; the process is designed to be re-run on
longer history without code changes.

## 1. What the model is trying to answer

The site's live calculator already answers the deterministic side: given a specific
price, rent, LTV, mortgage rate, and holding period, what does the monthly cash flow look
like and what is the upfront cash requirement? Those are arithmetic.

The stochastic model answers three questions the arithmetic cannot:

1. **Is today's price stretched relative to rent?** The two series must eventually stay
   tied by a long-run relationship (rent has to justify price, or vice versa). If we can
   identify that relationship, the current deviation from it is a live valuation gauge.

2. **Where is yield likely to settle?** Rental yield (rent÷price) tends to mean-revert.
   If we can calibrate the reversion, the current yield relative to its long-run mean
   tells the buyer whether they are entering cheap or rich.

3. **Under uncertainty, does buying beat the alternative?** Rather than a single point
   estimate, we want the full distribution of outcomes: after tax, after exit costs,
   in real dollars, across thousands of plausible paths.

The model produces four small JSON artifacts. The website loads them and interpolates
between grid points; it runs zero statistics in the browser.

## 2. Architecture

```
transaction data (sales.json, rent.json)
        │
        ▼
    quarterly aggregation
        │
        ├───────────────────────► series.json  (chart + inspection)
        │
        ▼
    econometric fitting per district
        │  correlation, cointegration, VECM, OU, structural breaks
        │
        ├───────────────────────► model_params.json  (valuation gauge)
        │
        ▼
    Monte-Carlo grid (per district × horizon × LTV × yield bucket
                      × appreciation drift × ETF return)
        │  5,000 paths / cell, correlated OU-yield + GBM-price
        │  after-tax, after-exit, real terminal wealth
        │
        ├───────────────────────► mc_grid.json  (buy vs ETF outcomes)
        │
        ▼
    provenance
                                    model_meta.json  (audit trail)
```

Everything lives in a single notebook, `sg_price_rent_model.ipynb`, which runs cleanly
top-to-bottom via `Restart & Run All`. Libraries are pinned to pandas, numpy, scipy,
statsmodels — no deep learning, no heavyweight dependencies.

## 3. Data pipeline

### 3.1 Aggregation

URA-style transaction rows carry a district code, a project name, floor area (sqft),
price per square foot (PSF), and a `YYYY-MM` transaction date. The rental-contract feed
carries the same shape minus PSF, plus a bedroom count.

The pipeline groups every transaction into a **year-quarter bucket** (`2024-Q3` etc.)
and takes the **median PSF per district × size band per quarter**. Median is used, not
mean, so a single unusually high or low transaction does not swing the quarterly point.

Size bands, defined identically in `build_data.py`, `app.js`, and the notebook:

| Band | Range (sqft)  | Rough bedroom equivalent |
| ---- | ------------- | ------------------------ |
| A    | 350 – 550     | ~1 BR                    |
| B    | 550 – 750     | ~1.5 BR                  |
| C    | 750 – 1000    | ~2 BR                    |

The output is a **shared quarter axis** (`quarters_all: [2021-Q2, ..., 2026-Q3]`) and,
for every district × band series, three parallel arrays of the same length: sale-PSF
median, rent-PSF median, gross yield. A quarter with no transactions is `null`, never
omitted, so the client never has to date-match.

### 3.2 Trimming and interpolation

For the econometric fit (§4), each district's pooled series is trimmed to the
contiguous span where **both** sale and rent data exist at each end. Interior
single-quarter gaps are linearly interpolated on the log scale, and the count of
interpolated quarters is recorded in the output block (`interpolated_quarters`) so
downstream readers can see how much of the fit rests on real data versus fill.

On the current data every district clears the "no leading/trailing gap" bar. Two
districts (D04 and D10) have a single interior interpolated quarter each; the rest
have zero.

## 4. Econometric fitting

Every fit is performed at the **district level**, not district × band, because the
current 20-quarter sample cannot support a robust band-level split — narrower bands
introduce holes that would either need imputation (fabricating data) or would drop the
usable series below the minimum length for a VECM. The pipeline includes an automatic
`FIT_LEVEL="auto"` resolver that upgrades to band-level fits the moment the data
supports it (see §7). Today the resolver returns "district".

For each district we produce a `model_params.json` block containing five estimates,
each with a standard error or confidence interval where possible.

### 4.1 Return correlation

The quarterly return correlation `ρ(Δlog p, Δlog r)` is computed on the trimmed series
along with a **Fisher-z 95% confidence interval**, so the reader can see how much of
the fitted number is signal versus sample noise.

On today's data the point estimates cluster near zero and the intervals are wide
(D09: ρ = −0.22 with CI [−0.61, 0.26]). The UI shows both, honestly labeled.

### 4.2 Cointegration testing

We run **both** the Engle-Granger single-equation test and the Johansen
multi-equation test on `[log p, log r]`, and take the OR of their 5% verdicts as the
"cointegrated_at_5pct" flag.

An implementation detail worth calling out: `statsmodels.tsa.stattools.coint` defaults
to `autolag='aic'`, which on short series picks absurd lags (this pipeline caught a
lag-of-9 on a 20-observation series that produced a degenerate `stat = 0.0`). We
therefore use a **deterministic, capped lag**: 1 for series < 40 quarters, 2 for
longer series. This makes the p-values reproducible across data refreshes, which the
provenance workflow depends on, and avoids the pathology.

On today's data 4 of 7 districts show a cointegration verdict at 5% and 3 do not. With
only 20 quarters both tests have low statistical power **and** a non-negligible
false-positive rate; the verdicts should not be treated as load-bearing, and the UI
flags this by rendering the VECM output as "indicative, not established" whenever the
cointegration verdict is `False`.

### 4.3 VECM

The Vector Error-Correction Model is fit with rank 1 and one lag of differences:

- **Cointegrating vector `β = [1, β_r]`** (normalised on log price) captures the
  long-run price-rent relationship. `β_r` is the rent elasticity of the rent-justified
  price level.
- **Adjustment coefficients `α_p, α_r`** measure how fast each series pulls back toward
  the long-run relationship after a deviation. Standard errors are extracted from the
  statsmodels fit; the ratio |α/SE| is the honest strength signal.
- **Current error-correction gap** is the deviation of the cointegrating combination
  `β' [log p_t, log r_t]` from its sample mean. This is the live valuation gauge
  exposed as the "VECM valuation gap" tile in the UI. Positive → price sits above the
  rent-implied level.

A **rent-leads-price Granger causality test** at one lag is also stored; its p-value
answers whether rent movements systematically precede price movements. On the current
sample none of the districts show a significant lead.

### 4.4 OU calibration on yield

Rental yield `y = rent × 12 / price` is modelled as an **Ornstein-Uhlenbeck** process:

```
dy = λ(μ − y) dt + σ dW
```

Calibration uses the exact discretisation. For quarterly steps `dt = 0.25`:

```
y_{t+1} = b · y_t + c + ε_t
```

with `b = exp(−λ dt)`, so `μ = c / (1 − b)` and the OU volatility recovered from the
residual variance as `σ² = Var(ε) · 2λ / (1 − b²)`.

The parameters are estimated by OLS on `(y_t, y_{t+1})` pairs. Standard errors on `b`
and `c` come directly from the OLS covariance; SEs on `λ` and `μ` are propagated via
the delta method. The half-life follows: `t_½ = ln(2) / λ`.

If the fit returns `b ≥ 1` (non-mean-reverting), the block is flagged and falls back
to a weak-reversion default — this cannot happen on any of the current districts, but
the guardrail is there for future refreshes on different regimes.

On today's data OU long-run yields range from **2.88%** (D10) to **3.73%** (D01)
across districts, with wide SEs. The λ values are noisy: some districts (D02, D15)
imply implausibly fast reversion (half-life < 0.1 yr), a well-known artifact of
short-sample OU calibration. These are decorative on today's data and will firm up
with longer history.

### 4.5 Structural-break scan

The long-run yield is **regime-dependent**. Singapore's ABSD rounds (2011, 2013, 2018,
2021, 2023), the TDSR framework (2013), and the 2022-2024 rate cycle all plausibly
shifted the equilibrium. Pooling pre-break and post-break data into one long-run mean
would blend incompatible regimes.

We run a **Quandt-Andrews sup-F single-break scan** on the yield level with a 15%
trim: for each candidate break point `k` we fit a level-shift regression, compute the
F-statistic, and take the supremum. Andrews' (1993) asymptotic 5% critical value at
15% trim is ≈ 8.85. Any district with sup-F above that threshold gets its break
quarter recorded in `structural_breaks.breaks_detected`.

On today's data 5 of 7 districts flag a break, mostly clustered around the 2022-2023
rate-cycle turn. The report is honest: with only 20 quarters, single-break testing
has power for the largest shifts only, and full Bai-Perron multiple-break estimation
is disabled until longer history is available.

**Design choice: single-break sup-F was chosen over full Bai-Perron precisely because
of the sample size.** Bai-Perron requires enough observations in each candidate regime
to fit a level; on 20 quarters that would inflate false positives without adding real
information. Once the dataset extends to ~80 quarters the scan will be swapped for
Bai-Perron in one place, without changing anything else.

### 4.6 Data-adequacy flagging

Every segment block carries a `data_adequacy` object with a `flag` field: `"ok"` if
n_quarters ≥ 40, `"low_confidence"` otherwise. This flag drives the UI: the
stochastic-model card renders a large amber banner when any segment is
low-confidence, and every fitted-value tile carries its SE / CI alongside the point
estimate. Nothing about the presentation lets the reader forget the uncertainty.

## 5. Monte-Carlo simulation

The Monte-Carlo engine simulates correlated quarterly paths of yield and price, then
turns each path into a full after-tax, after-exit-cost, real terminal wealth for
"buy the property" versus "invest the same cash in an ETF".

### 5.1 Path generation

Two correlated shocks per path per quarter, drawn once and re-used across every cell
in the district's grid (common random numbers → reproducible + apples-to-apples
comparison across cells):

```
Z_y  ~ N(0, 1)                          # yield shock
Z_p  = ρ · Z_y + √(1−ρ²) · Z_ind        # price shock, correlated with Z_y
```

`ρ` is the empirical correlation of quarterly Δlog p and Δyield. On today's data this
is strongly negative (D09: ρ ≈ −0.96), which is the right sign: when price jumps up,
yield mechanically drops if rent moves slowly.

The yield path is the OU exact-discretization step, driven by `Z_y`:

```
y_{t+1} = μ + b · (y_t − μ) + σ_step · Z_y
```

with `σ_step = σ · √((1 − b²) / (2λ))`, chosen so the stationary variance matches.
Yields are clipped at 1 basis point on the downside (they cannot go negative in the
model).

The price path is geometric Brownian motion with a **user-set drift** and stochastic
volatility from `Z_p`:

```
log P_t = log P_0 + t · log(1 + drift) / 4 + Σ σ_p · Z_p
```

where `σ_p` is the empirical quarterly log-price volatility. Drift is a grid axis,
not a fitted quantity, because the data does not pin down the long-run appreciation
rate and the user should own that assumption explicitly. See §5.4 for the entry-yield
bucketing.

**Annual rent** is `y × P` averaged over the 4 quarters of each ownership year — a
vectorised reshape, not a Python loop, so the whole grid runs in ~100 seconds per
district on a laptop.

### 5.2 Terminal wealth: buy side

For every horizon `H`, LTV, entry-yield bucket, drift, and ETF-return combination we
compute the full economic outcome of buying the property.

```
outlay = downpayment + BSD(P₀) + ABSD(P₀) + legal
loan   = P₀ · LTV
```

An **exact deterministic amortization** produces the per-year interest, principal,
and payment arrays for the whole horizon. This is the same amortization used in the
live calculator (`app.js`), verified to the sixth decimal against a closed-form check.

**Per-year after-tax cash flow** is computed vectorized across all paths:

```
effective_rent  = rent_year · (12 − vacancy_months) / 12
opex_i          = (MCST_annual + insurance) · (1 + inflation)ⁱ    # inflates
agent_fee       = effective_rent · 4.2%                           # leasing agent
repair_reserve  = effective_rent · 2%
property_tax    = IRAS non-owner-occ AV brackets applied to rent_year
pretax_cf       = effective_rent − payment − opex − agent − repair − property_tax
taxable         = effective_rent − interest − opex − agent − repair − property_tax
tax             = marginal_tax(base_income, max(taxable, 0))
aftertax_cf     = pretax_cf − tax
```

The **progressive resident income-tax brackets** (IRAS YA2024 onwards) are applied
as a top-slice on the buyer's other chargeable income, not a flat rate. Property tax
uses the non-owner-occupied AV brackets on the full annual rent, not the
vacancy-discounted figure — IRAS assesses AV from comparable market rentals
regardless of the owner's actual occupancy. These match the live calculator exactly.

**Reinvested surplus** (positive cash flow) is compounded forward at the ETF return
to the horizon. **Redirected shortfall** (negative cash flow) is treated as capital
the buyer would otherwise have invested in the ETF; it goes on the ETF side of the
ledger, not silently subtracted.

**Exit costs at the horizon** are applied to the property value:

```
sell_comm = 2% · P_T                                  # seller's marketing agent
SSD       = ssd_rate(H) · P_T                         # IRAS Seller's Stamp Duty:
                                                       #   12% <1yr, 8% <2yr, 4% <3yr, 0% after
buy_nominal = (P_T − loan_balance_T − sell_comm − SSD) + reinvested_surplus
```

Finally divide by cumulative inflation to get the **real terminal wealth**.

### 5.3 Terminal wealth: ETF side

Deliberately simpler, mirroring how the alternative would actually play out:

```
etf_nominal = outlay · (1 + etf_return)^H + redirected_shortfall
etf_real    = etf_nominal / (1 + inflation)^H
```

No exit costs on the ETF side — a normal brokerage sale is essentially free — which
is an intentional asymmetry, not a bug. Real trading costs on liquid ETFs are
negligible next to Singapore's SSD and marketing-agent commission.

### 5.4 Entry-yield bucketing

The MC needs a starting yield `y_0`. Different buyers will enter at different yields
depending on which project they pick, so the grid axis is discretised into three
buckets per district: the mean yield of the district's low-third, middle-third, and
high-third historical quarterly observations. The bucket edges are stored in
`mc_grid.json.entry_yield_bucket_edges` and the client picks the buyer's bucket by
comparing the user-entered gross yield against those edges.

### 5.5 Break-even solver

The headline number the UI shows is the **break-even appreciation CAGR**: the price
drift at which the median simulated buy terminal wealth equals the median simulated
ETF terminal wealth, given the user's LTV, horizon, entry-yield bucket, and ETF
return.

This is solved offline by **bisection on drift** with common random numbers. Given
the pre-drawn stochastic shock arrays, changing drift only shifts the log-price path
by a constant — no re-simulation of OU or shocks is needed. Bisection runs 18
iterations (final resolution ≈ 1e-4% CAGR on a 35% range, well under the MC sampling
noise floor).

Cells where the buy side already wins at −10% drift store `−10`; cells where it
never catches up at +25% drift store `null`. The client shows "no crossover in range"
for the latter.

### 5.6 Grid shape and size

| Axis                    | Values                              |
| ----------------------- | ----------------------------------- |
| district                | 7 (D01, D02, D03, D04, D09, D10, D15) |
| horizon_years           | 5, 10, 15, 20, 25, 30               |
| ltv_pct                 | 0, 25, 50, 55, 60, 65, 70, 75, 80   |
| entry_yield_bucket      | low, mid, high                      |
| appreciation_drift_pct  | −2, 0, 2, 4, 6                      |
| etf_return_pct          | 3, 5, 7, 9, 11                      |

Total cells: **28,350** (7 × 6 × 9 × 3 × 5 × 5). Break-even rows: **5,670** (grid
without the drift axis, since break-even solves for it).

**Band was intentionally dropped** from the MC grid. Band affects the dollar level
via the deterministic finance layer (stamp-duty tiers, loan size), not the return
distribution — so the client applies band scaling arithmetically on top of the
district reference price. This keeps the artifact ~12 MB uncompressed rather than
~35 MB.

### 5.7 Reproducibility

- **Fixed seed:** `MC_SEED = 42`, recorded in `model_meta.json`.
- **Common random numbers:** the same shock arrays feed every cell in a district's
  grid, so between-cell differences reflect the actual grid axes, not sampling noise.
- **Deterministic cointegration lag:** no autolag, no AIC lag-hunting.
- **Same-input-same-output:** running the notebook twice on the same data produces
  byte-identical artifacts. Two `model_params.json` files from different data
  refreshes can be text-diffed to catch parameter instability across refreshes.

## 6. Client-side interpolation

The website loads all four artifacts on boot. If any file is missing, the model card
stays hidden and the rest of the calculator is unaffected.

For a given user query (a specific horizon, LTV, drift, ETF return), the client:

1. Picks the district (user-selected) and entry-yield bucket (auto-derived from the
   user's price/rent).
2. Runs **multilinear interpolation** over the four continuous axes (horizon, LTV,
   drift, ETF return) between bracketing precomputed cells. This is the same pattern
   `prob_data.json` already uses, just generalised from 1-D to 4-D. Sixteen bracketing
   cells per query in the general case; a Map index keyed on the six-tuple makes it
   O(1) per lookup.
3. Applies the same interpolation to the break-even grid (three axes: horizon, LTV,
   ETF return).

The client runs **zero statistics** — no simulation, no fitting, no random-number
generation. It only interpolates.

## 7. Data-limitation handling

The current dataset covers ~5 years, ~22 quarters, one broadly continuous market
regime. This is thin for the estimators involved, and the pipeline is transparent
about it:

- Every fitted parameter carries an SE or CI beside the point estimate.
- A global `data_adequacy_global.flag = "low_confidence"` is stored in
  `model_params.json` and `model_meta.json` whenever any segment has fewer than
  40 quarters.
- The web UI renders a prominent provisional banner keyed on that flag.
- The VECM output is labeled "indicative, not established" whenever the cointegration
  verdict at 5% is false.
- Cells and break-even values are still computed and stored, so the pipeline is
  end-to-end ready. Once longer history is dropped in, the flags clear automatically
  and the numbers firm up without any code changes.

### 7.1 Forward path: longer history

The `FIT_LEVEL="auto"` resolver decides between district-level and district×band
fitting based on two thresholds:

- `MIN_QUARTERS_FIT = 40`: minimum real (non-interpolated) quarters per band cell.
- `MAX_INTERP_FRAC_BAND = 15%`: maximum share of a band series that can be linear
  interpolation.

Today the resolver reports:

> auto: fell back to district level - band cell D04-B has 14 real quarters (30%
> interpolated); needs >= 40 real and <= 15% interp

At ~80 quarters per band cell (20 years of history), the resolver will upgrade to
band-level fits automatically. No code change, just a longer input file.

### 7.2 Forward path: regime handling

The `structural_breaks` block currently uses a single-break sup-F. Once longer
history is available and multiple breaks become identifiable, the pipeline will swap
in Bai-Perron and the `regime` field in each segment block will move from
`"full_sample"` to `"post_<break_quarter>"`. The schema is designed to accept that
without a re-shape.

## 8. Correctness invariants

A separate validation script (`scratchpad/validate_artifacts.py`) runs 22 structural
checks against the four artifacts. All pass on the shipped fit. Highlights:

- Quarter axis is contiguous and strictly increasing.
- Every per-series array is aligned to `quarters_all`.
- `gross_yield = rent_psf · 12 / sale_psf` holds cell-by-cell, and is `null` iff
  either side is null.
- `mc_grid.cells.length` equals the full grid cross-product; no duplicates, no
  missing corners.
- **Percentile monotonicity:** for every cell, `p10 ≤ p25 ≤ median ≤ p75 ≤ p90` on
  both buy and ETF sides. This catches any bug that would corrupt the sampling.
- Probabilities are in [0, 1].
- **Direction sanity:** `P(buy > ETF)` is non-decreasing in appreciation drift for
  every LTV × horizon × bucket combination. This is a genuine sanity check on the
  MC direction, not a tautology.
- Every fitted parameter carries an SE or CI.
- Engle-Granger uses the fixed lag (a regression check on the autolag pathology
  caught during development).
- `vecm.fitted` matches `cointegrated_at_5pct`.
- Seed and path count are recorded in `model_meta.json`.

## 9. Design choices, honestly

A short catalogue of decisions and why, so future maintainers can push back with
context.

- **Boundary held.** The browser runs zero statistics. This is the single biggest
  architectural choice. The calculator, break-even screens, and yield tables stay
  deterministic and hot-editable. The model is a separate card that reads
  precomputed artifacts. Nothing in `app.js` fits, integrates, or samples.

- **Segment key = district code.** Not URA regions (CCR/RCR/OCR), not custom groups.
  Districts survive data refreshes with no re-mapping; new districts appear
  automatically the moment a transaction from that district is present. Same
  philosophy as the calculator's existing district chips.

- **Fixed lag on Engle-Granger.** Chosen over autolag='aic' because (a) AIC on 20
  observations picked lag 9 and returned `stat = 0.0` during testing, and (b) a
  data-driven lag makes p-values jump between data refreshes, defeating diffability.

- **Median, not mean, for quarterly aggregates.** Standard robust choice; one
  outlier transaction shouldn't move a quarter.

- **Common random numbers across the MC grid.** Between-cell differences reflect
  grid axes (LTV, drift, ETF), not shock luck. This is what makes the interpolation
  smooth and the break-even bisection well-behaved.

- **Band dropped from the MC grid.** Kept the artifact at ~12 MB. Band's effect
  (stamp-duty tiers, loan size on absolute dollars) is deterministic arithmetic and
  belongs on the client. Band remains a first-class field in `series.json` for the
  chart.

- **Real, not nominal, terminal wealth.** Nominal dollars over 30 years drift a
  factor of ~2× just from inflation and mask the actual comparison. Real dollars
  make the buy-vs-ETF question answerable at a glance.

- **User-set drift and ETF axes.** The data does not pin down forward appreciation
  or ETF returns, and dressing up a guess as a fitted quantity would be dishonest.
  The user owns those assumptions and the grid interpolates on their choice.

- **Exit costs on the property line only.** Selling agent commission (~2%) and SSD
  are real Singapore costs on residential exit. ETF exit via a normal brokerage is
  essentially free. Modelling this asymmetrically is not a bias, it is the reality.

- **`uv` for environment management.** `pyproject.toml` + `uv.lock` gives a
  one-command reproducible install (`uv sync`) and a byte-identical dependency
  closure across machines.

## 10. What this model does not do

An honest list of things that were considered and deliberately left out:

- **No stochastic mortgage rate.** The MC uses a single forward mortgage-rate
  assumption. Real SG mortgages reprice; this could be a second grid axis if the
  need arises. For now the live calculator's rate-chunked feature covers the
  deterministic case.

- **No stochastic vacancy.** Vacancy is a fixed number of months per year. In
  reality vacancy is bursty. This would matter mostly for very short horizons.

- **No policy-shock stress test.** ABSD hikes could hit terminal wealth via
  compressed price paths. The pipeline doesn't simulate discretionary policy
  shocks; the user would need to overlay them by hand via the drift axis.

- **No project-level fits.** Everything is district-pooled or district×band. The
  transaction data is not deep enough at the project level for cointegration or
  VECM. The live calculator continues to display per-project yields on the
  deterministic side.

- **No confidence bands on the MC output.** The percentile bands (P10–P90) reflect
  path variability, not estimator variability. In principle we could bootstrap the
  fitted OU parameters and propagate the SE into the percentiles; on 20-quarter
  data the bootstrap would be dominated by the point-estimate uncertainty and add
  more noise than signal. Reconsider once the sample is 3-4× larger.

## 11. Files

| File                                            | Producer               | Consumer      |
| ----------------------------------------------- | ---------------------- | ------------- |
| `singapore-apartment/sg_price_rent_model.ipynb` | you (Restart & Run All) | notebook only |
| `singapore-apartment/data/series.json`          | notebook               | website chart + inspection |
| `singapore-apartment/data/model_params.json`    | notebook               | website valuation gauge |
| `singapore-apartment/data/mc_grid.json`         | notebook               | website MC interpolation |
| `singapore-apartment/data/model_meta.json`      | notebook               | website provisional banner |
| `singapore-apartment/pyproject.toml`            | you (manual edits)     | uv sync |
| `singapore-apartment/uv.lock`                   | uv sync                | uv sync (reproducibility) |

## 12. Rerunning

```bash
cd singapore-apartment
uv sync                                                              # once
uv run jupyter nbconvert --to notebook --execute --inplace \
    sg_price_rent_model.ipynb                                        # ~13 min
```

Reload the website, hard-refresh if the browser cached the old JSON.
