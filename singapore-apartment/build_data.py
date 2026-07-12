#!/usr/bin/env python3
"""
Regenerates data/sales.json, data/rent.json, data/prob_data.json, data/meta.json
for the Singapore 2nd Apartment explorer, from raw URA-style CSVs.

USAGE
    python3 build_data.py --source /path/to/sg-rental-apartment-analysis/data

Auto-discovery, not a hardcoded file list:
    - Every *.csv under <source>/sales/  is treated as a sales file.
    - Every *.csv under <source>/rental/ is treated as a rental file.
    - District is read from each row's "Postal District" column, NOT from the filename.
      So a new district shows up automatically the moment a CSV containing rows for that
      district is dropped into either folder - no code changes needed here or in app.js.
    - A file that is empty/corrupted is skipped with a warning (and listed in meta.json),
      not silently ignored and not estimated.

REQUIRED COLUMNS (must match exactly - this is the standard URA-caveat / rental-contract
export format used by the existing files):
    sales:  Project Name, Transacted Price ($), Area (SQFT), Unit Price ($ PSF), Sale Date,
            Tenure, Postal District   (plus other columns, which are read but unused)
    rental: Project Name, Postal District, No of Bedroom, Monthly Rent ($), Floor Area (SQFT),
            Lease Commencement Date   (plus other columns, which are read but unused)

If a new CSV uses different column names, this script will raise a KeyError naming the
missing column - it will not guess or silently drop it.
"""
import argparse, glob, json, os, sys
import pandas as pd, numpy as np

def clean_num(s):
    if pd.isna(s): return np.nan
    return float(str(s).replace(',', '').replace('$','').strip())

def parse_mon_yy(s):
    return pd.to_datetime(str(s).strip(), format='%b-%y')

def load_sales_file(path):
    try:
        df = pd.read_csv(path)
    except pd.errors.EmptyDataError:
        return None
    df['Price'] = df['Transacted Price ($)'].apply(clean_num)
    df['SQFT'] = df['Area (SQFT)'].apply(clean_num)
    df['PSF'] = df['Unit Price ($ PSF)'].apply(clean_num)
    df['Date'] = df['Sale Date'].apply(parse_mon_yy)
    df['District'] = 'D' + df['Postal District'].astype(str).str.zfill(2)
    return df

def load_rental_file(path):
    try:
        df = pd.read_csv(path)
    except pd.errors.EmptyDataError:
        return None
    df['Rent'] = df['Monthly Rent ($)'].apply(clean_num)
    def mid(rng):
        if pd.isna(rng): return np.nan
        a,b = str(rng).split(' to ')
        return (float(a.replace(',',''))+float(b.replace(',','')))/2
    df['SQFT_mid'] = df['Floor Area (SQFT)'].apply(mid)
    df['Date'] = df['Lease Commencement Date'].apply(parse_mon_yy)
    df['Bed'] = pd.to_numeric(df['No of Bedroom'], errors='coerce')
    df['District'] = 'D' + df['Postal District'].astype(str).str.zfill(2)
    return df

def band(sqft):
    if sqft<550: return 'A'
    if sqft<750: return 'B'
    return 'C'

RATE=0.0175; TENURE=30; MCST_MO=500; INS=300; AGENT=0.042; REPAIR=0.02; VAC=1
# Buyer's other chargeable income (SGD/yr) used to find the marginal tax bracket for rental
# profit in this precomputed panel (matches the app.js calculator's default of $0; editable there
# per-scenario, but this server-side panel needs one fixed assumption baked in). Defaults to $0
# (rental income taxed from the first dollar, i.e. the most conservative/generic starting point -
# no assumption made about the buyer's other income). Adjust and re-run for a specific buyer.
BASE_INCOME = 0
LTV_CHECKPOINTS = [0.20,0.25,0.30,0.35,0.40,0.45,0.50,0.55,0.60,0.65,0.70,0.75,0.80,0.85,0.90,0.95,1.00]

def pmt(rm_,n,pv): return pv*rm_/(1-(1+rm_)**-n)

# Progressive resident individual income tax brackets, Singapore, YA2024 onwards (unchanged
# through YA2026 as of this writing). Source: IRAS / PwC Worldwide Tax Summaries.
# Each row: (bracket floor, cumulative tax at floor, marginal rate on the excess above floor).
TAX_BRACKETS = [
    (0,        0,       0.00),
    (20000,    0,       0.02),
    (30000,    200,     0.035),
    (40000,    550,     0.07),
    (80000,    3350,    0.115),
    (120000,   7950,    0.15),
    (160000,   13950,   0.18),
    (200000,   21150,   0.19),
    (240000,   28750,   0.195),
    (280000,   36550,   0.20),
    (320000,   44550,   0.22),
    (500000,   84150,   0.23),
    (1000000,  199150,  0.24),
]

def tax_on_chargeable_income(x):
    x = np.asarray(x, dtype=float)
    out = np.zeros_like(x)
    for floor, base, rate in TAX_BRACKETS:
        mask = x >= floor
        out = np.where(mask, base + (x-floor)*rate, out)
    return np.maximum(out, 0)

def marginal_tax_vec(base_income, slice_arr):
    """Marginal tax on an incremental slice of income (rental profit) stacked on top of
    base_income - not a flat rate. Correctly handles the slice spanning more than one bracket."""
    slice_arr = np.maximum(np.asarray(slice_arr, dtype=float), 0)
    return tax_on_chargeable_income(base_income+slice_arr) - tax_on_chargeable_income(base_income)

def ptax_vec(av):
    av = np.asarray(av, dtype=float)
    return np.where(av<=30000, av*0.12,
           np.where(av<=45000, 30000*0.12+(av-30000)*0.20,
           np.where(av<=60000, 30000*0.12+15000*0.20+(av-45000)*0.28,
                    30000*0.12+15000*0.20+15000*0.28+(av-60000)*0.36)))

def year1_interest_principal(loan, rate, m):
    """Exact first-year interest/principal via amortization (not the flat loan*rate approximation,
    which overstates year-1 interest by ~1.2% at 1.75%/30yr - verified against this closed form)."""
    rm = rate/12
    bal12 = loan*(1+rm)**12 - m*((1+rm)**12-1)/rm
    principal = loan - bal12
    interest = m*12 - principal
    return interest, principal

def cashflow_matrix(prices, rents, ltv):
    prices = np.asarray(prices, dtype=float); rents = np.asarray(rents, dtype=float)
    P = prices[:,None]; R = rents[None,:]
    loan = P*ltv
    m = pmt(RATE/12, TENURE*12, loan)
    eff = R*(12-VAC)
    # Property tax AV is based on market rental potential (IRAS assesses AV from comparable
    # rentals, not the owner's actual after-vacancy income) - so it uses the FULL annual rent,
    # not the vacancy-discounted "eff" figure used for actual income/opex/tax-on-profit below.
    pt = ptax_vec(R*12)
    ag = eff*AGENT; rp = eff*REPAIR; mc = MCST_MO*12
    interest, _ = year1_interest_principal(loan, RATE, m)
    pretax = eff - m*12 - mc - INS - ag - rp - pt
    taxable = eff - interest - mc - INS - ag - rp - pt
    tax = marginal_tax_vec(BASE_INCOME, taxable)
    return (pretax - tax)/12

def probs_at_checkpoints(prices, rents):
    near=[]; strict=[]
    for ltv in LTV_CHECKPOINTS:
        cf = cashflow_matrix(prices, rents, ltv)
        near.append(round(float((cf>=-250).mean()),4))
        strict.append(round(float((cf>=0).mean()),4))
    return near, strict

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', required=True, help='Path to the data/ folder containing sales/ and rental/ subfolders')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), 'data'), help='Output folder (default: ./data next to this script)')
    ap.add_argument('--size-lo', type=int, default=350)
    ap.add_argument('--size-hi', type=int, default=1000)
    ap.add_argument('--months-window', type=int, default=24, help='Lookback window for the probability panel')
    args = ap.parse_args()

    sales_files = sorted(glob.glob(os.path.join(args.source, 'sales', '*.csv')))
    rental_files = sorted(glob.glob(os.path.join(args.source, 'rental', '*.csv')))
    if not sales_files: sys.exit(f"No CSVs found under {args.source}/sales/")
    if not rental_files: sys.exit(f"No CSVs found under {args.source}/rental/")

    corrupted = []
    sales_frames = []
    for f in sales_files:
        df = load_sales_file(f)
        if df is None: corrupted.append(f); print("EMPTY/CORRUPT, skipped:", f)
        else: sales_frames.append(df)
    rent_frames = []
    for f in rental_files:
        df = load_rental_file(f)
        if df is None: corrupted.append(f); print("EMPTY/CORRUPT, skipped:", f)
        else: rent_frames.append(df)

    sales = pd.concat(sales_frames, ignore_index=True)
    rent = pd.concat(rent_frames, ignore_index=True)
    print(f"Loaded {len(sales):,} sales rows and {len(rent):,} rental rows.")
    print(f"Districts found: {sorted(set(sales['District']) | set(rent['District']))}")

    s = sales[sales['SQFT'].between(args.size_lo, args.size_hi)].copy()
    r = rent[(rent['SQFT_mid'].between(args.size_lo, args.size_hi)) & (rent['Bed'].isin([1,2]))].copy()
    s['DateStr'] = s['Date'].dt.strftime('%Y-%m')
    r['DateStr'] = r['Date'].dt.strftime('%Y-%m')

    sales_records = s[['District','Project Name','Tenure','SQFT','PSF','Price','DateStr']].values.tolist()
    sales_records = [[d,p,t,round(sq,1),round(psf,1),round(pr,0),ds] for d,p,t,sq,psf,pr,ds in sales_records]
    rent_records = r[['District','Project Name','Bed','SQFT_mid','Rent','DateStr']].values.tolist()
    rent_records = [[d,p,int(bd),round(sq,1),round(rt,0),ds] for d,p,bd,sq,rt,ds in rent_records]

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out,'sales.json'),'w') as f: json.dump(sales_records, f)
    with open(os.path.join(args.out,'rent.json'),'w') as f: json.dump(rent_records, f)
    print(f"Wrote {len(sales_records):,} sales.json rows, {len(rent_records):,} rent.json rows.")

    # ---- probability panel (last N months, per district/project/size-band/tenure) ----
    cutoff = pd.Timestamp.now().normalize() - pd.DateOffset(months=args.months_window)
    # use the max date actually in the data as "now", so this stays correct for stale/future-dated exports
    ref_date = sales['Date'].max()
    cutoff = ref_date - pd.DateOffset(months=args.months_window)
    s24 = s[s['Date']>=cutoff].copy(); r24 = r[r['Date']>=cutoff].copy()
    s24['Band'] = s24['SQFT'].apply(band); r24['Band'] = r24['SQFT_mid'].apply(band)

    def build_for_tenure(mode):
        if mode=='ALL': sd = s24
        elif mode=='FH': sd = s24[s24['Tenure']=='Freehold']
        else: sd = s24[s24['Tenure']!='Freehold']
        out=[]
        for (dist,bd), sg in sd.groupby(['District','Band']):
            rg = r24[(r24['District']==dist)&(r24['Band']==bd)]
            if len(sg)<5 or len(rg)<5: continue
            near,strict = probs_at_checkpoints(sg['Price'].values, rg['Rent'].values)
            out.append(dict(level='district', district=dist, project=None, band=bd,
                n_sales=len(sg), n_rent=len(rg), median_price=float(sg['Price'].median()),
                median_rent=float(rg['Rent'].median()), near=near, strict=strict))
        for (dist,proj,bd), sg in sd.groupby(['District','Project Name','Band']):
            rg = r24[(r24['District']==dist)&(r24['Project Name']==proj)&(r24['Band']==bd)]
            if len(sg)<3 or len(rg)<3: continue
            near,strict = probs_at_checkpoints(sg['Price'].values, rg['Rent'].values)
            out.append(dict(level='project', district=dist, project=proj, band=bd,
                n_sales=len(sg), n_rent=len(rg), median_price=float(sg['Price'].median()),
                median_rent=float(rg['Rent'].median()), near=near, strict=strict))
        return out

    prob = {'checkpoints': LTV_CHECKPOINTS, 'byTenure': {k: build_for_tenure(k) for k in ('ALL','FH','LH')}}
    with open(os.path.join(args.out,'prob_data.json'),'w') as f: json.dump(prob, f)
    for k,v in prob['byTenure'].items(): print(f"prob_data byTenure[{k}]: {len(v)} records")

    meta = dict(
        generated=pd.Timestamp.now().isoformat(),
        source=os.path.basename(os.path.normpath(args.source)) or 'source',  # basename only - don't leak the full local filesystem path into a file that may be shared/published
        sales_rows=len(sales_records), rent_rows=len(rent_records),
        size_filter=[args.size_lo, args.size_hi],
        probability_panel_lookback_months=args.months_window,
        probability_panel_reference_date=str(ref_date.date()),
        districts_found=sorted(set(sales['District']) | set(rent['District'])),
        corrupted_files_this_run=corrupted,
        assumptions=dict(rate_pct=RATE*100, tenure_yrs=TENURE, mcst_month=MCST_MO, insurance_yr=INS,
            agent_pct=AGENT*100, repair_pct=REPAIR*100, vacancy_months=VAC,
            income_tax_method='progressive resident brackets (IRAS, YA2024 onwards), marginal on top of base_income',
            base_income=BASE_INCOME),
    )
    with open(os.path.join(args.out,'meta.json'),'w') as f: json.dump(meta, f, indent=2)
    print("\nDone. meta.json:")
    print(json.dumps(meta, indent=2))

if __name__=='__main__':
    main()
