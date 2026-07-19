/* Singapore Rental Property Investment Calculator
   Loads data/*.json at runtime (nothing embedded/hardcoded in this file).
   sales.json:  [district, project, tenure, sqft, psf, price, "YYYY-MM"]
   rent.json:   [district, project, bed, sqft, rent, "YYYY-MM"]
   prob_data.json: { checkpoints:[...], byTenure: { ALL:[...], FH:[...], LH:[...] } }
     each record: {level, district, project, band, n_sales, n_rent, median_price, median_rent, near:[], strict:[]}
*/

// Friendly labels for known districts. Any district code found in the data but NOT listed here
// still works fully (chips, filters, tables, chart) - it just displays its bare code instead of
// a neighborhood name. Add an entry here any time to give a new district a friendly label; you
// do NOT need to edit this file just to pick up new districts - see buildDistrictChips().
const DISTRICT_NAMES = {
  "D01": "Raffles Place / Marina / Cecil",
  "D02": "Tanjong Pagar / Shenton Way / Chinatown",
  "D03": "Tiong Bahru / Queenstown / Redhill",
  "D04": "Sentosa / Harbourfront / Telok Blangah",
  "D05": "Buona Vista / West Coast / Clementi",
  "D06": "City Hall / Clarke Quay",
  "D07": "Beach Road / Bugis / Rochor",
  "D08": "Little India / Farrer Park",
  "D09": "Orchard / River Valley / Dhoby Ghaut",
  "D10": "Holland Village / Tanglin / Bukit Timah",
  "D11": "Newton / Novena",
  "D12": "Balestier / Toa Payoh",
  "D13": "Macpherson / Potong Pasir",
  "D14": "Geylang / Paya Lebar",
  "D15": "East Coast / Katong / Marine Parade",
  "D16": "Bedok / Upper East Coast",
  "D17": "Changi / Loyang",
  "D18": "Pasir Ris / Tampines",
  "D19": "Hougang / Punggol / Sengkang",
  "D20": "Bishan / Ang Mo Kio",
  "D21": "Clementi Park / Upper Bukit Timah",
  "D22": "Boon Lay / Jurong",
  "D23": "Bukit Batok / Choa Chu Kang",
  "D25": "Kranji / Woodlands",
  "D26": "Upper Thomson / Springleaf",
  "D27": "Sembawang / Yishun",
  "D28": "Seletar / Yio Chu Kang",
};
const BAND_NAMES = { A: "350–550 sqft (~1BR)", B: "550–750 sqft (~1.5BR)", C: "750–1000 sqft (~2BR)" };
const BAND_RANGE = { A: [350,550], B: [550,750], C: [750,1000] };

let SALES = [], RENT = [], PROB = null;

const state = {
  districts: new Set(),   // populated dynamically from the loaded data in boot() - not hardcoded
  tenure: 'all',           // 'all' | 'freehold' | 'leasehold'
  bed: 'all',
  sizeMin: 350, sizeMax: 1000,
  dateWindow: 24,
  weighting: 'median',     // 'median' | 'weighted'
  halfLifeMonths: 12,
  sortSales: {col:'n', dir:-1},
  sortRent: {col:'n', dir:-1},
  chartMode: 'district',
  chartProjects: new Set(),
  chartDistricts: new Set(),  // independent of the top-of-page district filter - scoped to the chart only
  chartMetric: 'both',        // 'sale' | 'rent' | 'both'
  rateMode: 'flat',           // 'flat' | 'chunked' - opportunity-cost chart's mortgage rate assumption
};

// ---------------- utilities ----------------
function median(arr){
  if(!arr.length) return null;
  const s=[...arr].sort((a,b)=>a-b);
  const m=Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
}
function nowRef(){ return new Date(2026,6,1); } // Jul 2026 - latest month present in the source CSVs
function monthsBetween(dateStr, ref){
  const [y,m] = dateStr.split('-').map(Number);
  return (ref.getFullYear()-y)*12 + (ref.getMonth()-(m-1));
}
function weightedAverage(values, dateStrs, halfLifeMonths, ref){
  let wSum=0, vwSum=0;
  for(let i=0;i<values.length;i++){
    const ma = Math.max(monthsBetween(dateStrs[i], ref), 0);
    const w = Math.pow(0.5, ma/halfLifeMonths);
    wSum += w; vwSum += w*values[i];
  }
  return wSum>0 ? vwSum/wSum : null;
}
function sizeBand(sqft){ return sqft<550 ? 'A' : (sqft<750 ? 'B' : 'C'); }
function fmtCur(v){ if(v==null||isNaN(v)) return '—'; return '$'+Math.round(v).toLocaleString(); }
function fmtPct(v){ if(v==null||isNaN(v)) return '—'; return (v*100).toFixed(2)+'%'; }
function pgLink(project){
  const q = encodeURIComponent(project+' Singapore');
  const url = 'https://www.propertyguru.com.sg/property-for-sale?freetext='+q;
  return `<a href="${url}" target="_blank" rel="noopener">${project}</a>`;
}
function currentCutoff(){
  const ref = nowRef();
  if(state.dateWindow>=999) return new Date(2000,0,1);
  const d = new Date(ref); d.setMonth(d.getMonth()-state.dateWindow);
  return d;
}
// ---------------- finance (mirrors prob_data.json's server-side assumptions exactly) ----------------
function pmt(rateM, n, pv){ return pv*rateM/(1-Math.pow(1+rateM,-n)); }
function propertyTaxAnnual(av){
  if(av<=30000) return av*0.12;
  if(av<=45000) return 30000*0.12+(av-30000)*0.20;
  if(av<=60000) return 30000*0.12+15000*0.20+(av-45000)*0.28;
  return 30000*0.12+15000*0.20+15000*0.28+(av-60000)*0.36;
}
// Exact first-year interest/principal via amortization (NOT the flat loan*rate approximation - that
// overstates year-1 interest by ~1.2% at these rates/tenures, verified against a closed-form check).
function year1InterestPrincipal(loan, ratePct, tenureYrs, monthlyPmt){
  const rm = ratePct/100/12;
  const bal12 = loan*Math.pow(1+rm,12) - monthlyPmt*(Math.pow(1+rm,12)-1)/rm;
  const principalYr1 = loan - bal12;
  const interestYr1 = monthlyPmt*12 - principalYr1;
  return {interestYr1, principalYr1};
}
// Progressive resident individual income tax brackets, Singapore, YA2024 onwards (unchanged
// through YA2026 as of this writing). Source: IRAS / PwC Worldwide Tax Summaries -
// https://www.iras.gov.sg/taxes/individual-income-tax/basics-of-individual-income-tax/tax-residency-and-tax-rates/individual-income-tax-rates
// Each row: [bracket floor, cumulative tax at floor, marginal rate on the excess above floor].
const TAX_BRACKETS = [
  [0,        0,       0.00],
  [20000,    0,       0.02],
  [30000,    200,     0.035],
  [40000,    550,     0.07],
  [80000,    3350,    0.115],
  [120000,   7950,    0.15],
  [160000,   13950,   0.18],
  [200000,   21150,   0.19],
  [240000,   28750,   0.195],
  [280000,   36550,   0.20],
  [320000,   44550,   0.22],
  [500000,   84150,   0.23],
  [1000000,  199150,  0.24],
];
function taxOnChargeableIncome(x){
  if(x<=0) return 0;
  let bracket = TAX_BRACKETS[0];
  for(const b of TAX_BRACKETS){ if(x>=b[0]) bracket=b; else break; }
  return bracket[1] + (x-bracket[0])*bracket[2];
}
// Marginal tax on an incremental slice of income (the rental profit) stacked ON TOP of the buyer's
// other chargeable income (salary net of SRS/CPF/other reliefs). This replaces a flat guessed rate -
// it finds the buyer's REAL bracket and correctly handles the slice spanning more than one bracket.
function marginalTax(baseIncome, slice){
  if(slice<=0) return 0;
  return taxOnChargeableIncome(baseIncome+slice) - taxOnChargeableIncome(baseIncome);
}
// Buyer's Stamp Duty (BSD), residential property, rates effective 15-Feb-2023 (IRAS, current
// through 2026): 1% / 2% / 3% / 4% / 5% / 6% progressive tiers on price/valuation.
function bsd(price){
  const tiers = [[180000,0.01],[180000,0.02],[640000,0.03],[1000000,0.04],[1000000,0.05],[Infinity,0.06]];
  let remaining = price, total = 0;
  for(const [size,rate] of tiers){
    const amt = Math.min(remaining, size);
    total += amt*rate;
    remaining -= amt;
    if(remaining<=0) break;
  }
  return total;
}
// Additional Buyer's Stamp Duty (ABSD) - flat rate on the full price, rate depends on buyer
// citizenship/PR status and count of residential properties already held in that buyer's own name.
// Current rates (IRAS, effective 27-Apr-2023, current through 2026): SC 1st 0%/2nd 20%/3rd+ 30%;
// SPR 1st 5%/2nd 30%/3rd+ 35%; Foreigner 60%.
function absd(price, ratePct){ return price*(ratePct/100); }
// Seller's Stamp Duty schedule (IRAS, residential, current rates): 12% if sold <1yr,
// 8% <2yr, 4% <3yr, 0% thereafter. Applied to the sale price at exit. Kept in sync with
// the offline MC model (model_core.py ssd_rate).
function ssdRate(holdYears){
  if(holdYears<1) return 0.12;
  if(holdYears<2) return 0.08;
  if(holdYears<3) return 0.04;
  return 0;
}
const SELL_AGENT_PCT_UI = 0.02;   // seller's marketing agent commission (SG norm ~2%)

function calcCashFlow(price, rent, ltvPct, ratePct, tenureYrs, mcstMo, insYr, agentPct, repairPct, vacMo, baseIncome){
  const ltv=ltvPct/100, agent=agentPct/100, repair=repairPct/100;
  const loan=price*ltv;
  const mortM=pmt(ratePct/100/12, tenureYrs*12, loan);
  const effAnnualRent=rent*(12-vacMo);
  // Property tax AV is based on market rental potential (IRAS assesses AV from comparable
  // rentals, not the owner's actual after-vacancy income) - so it uses the FULL annual rent,
  // not the vacancy-discounted figure used for actual income/opex/tax-on-profit below.
  const ptax=propertyTaxAnnual(rent*12);
  const agentAmt=effAnnualRent*agent, repairAmt=effAnnualRent*repair, mcstAnnual=mcstMo*12;
  const {interestYr1, principalYr1} = year1InterestPrincipal(loan, ratePct, tenureYrs, mortM);
  const pretaxAnnual=effAnnualRent-mortM*12-mcstAnnual-insYr-agentAmt-repairAmt-ptax;
  const taxableProfit=effAnnualRent-interestYr1-mcstAnnual-insYr-agentAmt-repairAmt-ptax;
  const taxableProfitPos = Math.max(taxableProfit,0);
  const incomeTax=marginalTax(baseIncome, taxableProfitPos);
  const marginalRate = taxableProfitPos>0 ? incomeTax/taxableProfitPos : null;
  const aftertaxAnnual=pretaxAnnual-incomeTax;
  const trueEconAnnual=aftertaxAnnual+principalYr1;
  return {loan, mortM, effAnnualRent, ptax, agentAmt, repairAmt, mcstAnnual, interestYr1, principalYr1, incomeTax, marginalRate,
    aftertaxMonthly: aftertaxAnnual/12, trueEconMonthly: trueEconAnnual/12, grossYield: rent*12/price};
}
function breakevenLTV(price, rent, ratePct, tenureYrs, mcstMo, insYr, agentPct, repairPct, vacMo, baseIncome){
  function cfAt(ltv){ return calcCashFlow(price,rent,ltv*100,ratePct,tenureYrs,mcstMo,insYr,agentPct,repairPct,vacMo,baseIncome).aftertaxMonthly; }
  if(cfAt(0)<0) return null;
  let lo=0, hi=1;
  for(let i=0;i<40;i++){ const mid=(lo+hi)/2; if(cfAt(mid)>=0) lo=mid; else hi=mid; }
  return lo;
}
// Upfront cash required at purchase: down payment + BSD + ABSD + buyer's own agent commission
// (usually 0 in SG resale - the seller pays the transaction agent; only set >0 if engaging an
// exclusive buyer's agent who charges the buyer directly) + legal/misc costs.
function upfrontCosts(price, ltvPct, absdRatePct, buyerAgentPct, legalMisc){
  const loan = price*(ltvPct/100);
  const downPayment = price - loan;
  const bsdAmt = bsd(price);
  const absdAmt = absd(price, absdRatePct);
  const buyerAgentAmt = price*(buyerAgentPct/100);
  const total = downPayment + bsdAmt + absdAmt + buyerAgentAmt + legalMisc;
  return {downPayment, bsd: bsdAmt, absd: absdAmt, buyerAgentAmt, legalMisc, total};
}
// Remaining mortgage balance after `months` monthly payments (standard amortization formula,
// same one used by year1InterestPrincipal but generalized to any month count/horizon).
function loanBalanceAt(loan, ratePct, tenureYrs, monthlyPmt, months){
  const rm = ratePct/100/12;
  const totalMonths = tenureYrs*12;
  if(months<=0) return loan;
  if(months>=totalMonths) return 0;
  const bal = loan*Math.pow(1+rm,months) - monthlyPmt*(Math.pow(1+rm,months)-1)/rm;
  return Math.max(bal,0);
}
// Future value of a level monthly payment stream compounded at monthlyRate over `months` months
// (ordinary annuity, payments at month-end).
function fvAnnuity(payment, months, monthlyRate){
  if(months<=0 || payment<=0) return 0;
  if(Math.abs(monthlyRate) < 1e-9) return payment*months;
  return payment*(Math.pow(1+monthlyRate,months)-1)/monthlyRate;
}
// Simulates the FULL month-by-month amortization given a piecewise interest-rate schedule.
// periods: [{years, ratePct}, ...] - the LAST period's rate applies to all remaining months
// through the end of tenureYrs, regardless of its own `years`. At every rate change, the payment
// is RECALCULATED to fully amortize the remaining balance over the remaining original tenure -
// this is standard behavior for an SG mortgage that reprices without refinancing elsewhere (same
// payoff date, new installment). Verified against the single-rate closed-form functions above
// (loanBalanceAt/year1InterestPrincipal) to the 6th decimal, and against independent hand-checked
// multi-period math (3 different rates over a 10yr loan, ending at exactly $0 balance).
// Returns an array indexed by month (0=starting balance before any payment, 1..totalMonths=after
// that month's payment), each entry {balance, ratePct, payment, interest, principal}.
function simulateAmortization(loan, tenureYrs, periods){
  const totalMonths = Math.round(tenureYrs*12);
  const sched = [{balance: loan, ratePct: periods[0].ratePct, payment: null, interest: 0, principal: 0}];
  let bal = loan, periodIdx = 0, periodStartMonth = 0, payment = null;
  for(let m=1; m<=totalMonths; m++){
    while(periodIdx < periods.length-1 && (m-1) >= periodStartMonth + periods[periodIdx].years*12){
      periodStartMonth += periods[periodIdx].years*12;
      periodIdx++;
      payment = null; // force recompute at the reprice point
    }
    const ratePct = periods[periodIdx].ratePct;
    const rm = ratePct/100/12;
    if(payment==null){
      const remainingMonths = totalMonths-(m-1);
      payment = pmt(rm, remainingMonths, bal);
    }
    const interest = bal*rm;
    const principal = Math.min(payment-interest, bal);
    bal = Math.max(bal-principal, 0);
    sched.push({balance: bal, ratePct, payment, interest, principal});
  }
  return sched;
}

// ---------------- filtering ----------------
function inDateWindow(dateStr){
  const cutoff = currentCutoff();
  const [y,m] = dateStr.split('-').map(Number);
  const d = new Date(y, m-1, 1);
  return d >= cutoff;
}
function filteredSales(){
  return SALES.filter(r=>{
    const [d,proj,ten,sqft,psf,price,ds]=r;
    if(!state.districts.has(d)) return false;
    if(sqft<state.sizeMin||sqft>state.sizeMax) return false;
    if(state.tenure==='freehold' && ten!=='Freehold') return false;
    if(state.tenure==='leasehold' && ten==='Freehold') return false;
    if(!inDateWindow(ds)) return false;
    return true;
  });
}
function filteredRent(){
  return RENT.filter(r=>{
    const [d,proj,bed,sqft,rent,ds]=r;
    if(!state.districts.has(d)) return false;
    if(sqft<state.sizeMin||sqft>state.sizeMax) return false;
    if(state.bed==='1' && bed!==1) return false;
    if(state.bed==='2' && bed!==2) return false;
    if(!inDateWindow(ds)) return false;
    return true;
  });
}
// Chart-only variants: same size/tenure/bed/date-window filters, but district is deliberately
// NOT applied here - the chart has its own independent district filter (state.chartDistricts),
// separate from the top-of-page table filter (state.districts).
function filteredSalesNoDistrict(){
  return SALES.filter(r=>{
    const [d,proj,ten,sqft,psf,price,ds]=r;
    if(sqft<state.sizeMin||sqft>state.sizeMax) return false;
    if(state.tenure==='freehold' && ten!=='Freehold') return false;
    if(state.tenure==='leasehold' && ten==='Freehold') return false;
    if(!inDateWindow(ds)) return false;
    return true;
  });
}
function filteredRentNoDistrict(){
  return RENT.filter(r=>{
    const [d,proj,bed,sqft,rent,ds]=r;
    if(sqft<state.sizeMin||sqft>state.sizeMax) return false;
    if(state.bed==='1' && bed!==1) return false;
    if(state.bed==='2' && bed!==2) return false;
    if(!inDateWindow(ds)) return false;
    return true;
  });
}

// ---------------- aggregation (grouped by district + project + SIZE BAND, so a project's sale
// price and rent are only compared within the same size band - fixes a real mismatch where e.g.
// Leedon Green's sale transactions skewed ~700sqft while its rental transactions skewed ~650sqft) ----------------
function aggSales(rows){
  const groups={};
  for(const [d,proj,ten,sqft,psf,price,ds] of rows){
    const band = sizeBand(sqft);
    const key=d+'|||'+proj+'|||'+band;
    if(!groups[key]) groups[key]={district:d,project:proj,band,tenures:new Set(),psf:[],price:[],sqft:[],dates:[]};
    groups[key].tenures.add(ten==='Freehold'?'FH':'LH');
    groups[key].psf.push(psf); groups[key].price.push(price); groups[key].sqft.push(sqft); groups[key].dates.push(ds);
  }
  const ref = nowRef();
  return Object.values(groups).map(g=>({
    district:g.district, project:g.project, band:g.band, tenure:[...g.tenures].join('/'),
    n:g.psf.length,
    medianPsf:median(g.psf), medianPrice:median(g.price), medianSqft:median(g.sqft),
    wavgPsf: weightedAverage(g.psf, g.dates, state.halfLifeMonths, ref),
    wavgPrice: weightedAverage(g.price, g.dates, state.halfLifeMonths, ref),
  }));
}
function aggRent(rows){
  const groups={};
  for(const [d,proj,bed,sqft,rent,ds] of rows){
    const band = sizeBand(sqft);
    const key=d+'|||'+proj+'|||'+band;
    if(!groups[key]) groups[key]={district:d,project:proj,band,beds:new Set(),rent:[],sqft:[],dates:[]};
    groups[key].beds.add(bed);
    groups[key].rent.push(rent); groups[key].sqft.push(sqft); groups[key].dates.push(ds);
  }
  const ref = nowRef();
  return Object.values(groups).map(g=>({
    district:g.district, project:g.project, band:g.band, beds:[...g.beds].sort().join('/'),
    n:g.rent.length,
    medianRent:median(g.rent), medianSqft:median(g.sqft),
    wavgRent: weightedAverage(g.rent, g.dates, state.halfLifeMonths, ref),
  }));
}
function priceOf(row){ return state.weighting==='weighted' ? (row.wavgPrice ?? row.medianPrice) : row.medianPrice; }
function rentOf(row){ return state.weighting==='weighted' ? (row.wavgRent ?? row.medianRent) : row.medianRent; }

function sortRows(rows, sortState, accessor){
  rows.sort((a,b)=>{
    const av=accessor(a,sortState.col), bv=accessor(b,sortState.col);
    if(av==null) return 1; if(bv==null) return -1;
    if(av<bv) return -1*sortState.dir; if(av>bv) return 1*sortState.dir; return 0;
  });
}

// ---------------- rendering ----------------
function render(){
  const sRows = filteredSales();
  const rRows = filteredRent();
  const salesAgg = aggSales(sRows);
  const rentAgg = aggRent(rRows);
  const priceLabel = state.weighting==='weighted' ? `Recency-wtd avg (half-life ${state.halfLifeMonths}mo)` : 'Median';

  document.getElementById('salesSub').textContent = sRows.length.toLocaleString()+' sale transactions -> '+salesAgg.length+' project x size-band groups (current filters)';
  document.getElementById('rentSub').textContent = rRows.length.toLocaleString()+' rental transactions -> '+rentAgg.length+' project x size-band groups (current filters)';

  const rentByKey = {}; rentAgg.forEach(r=>rentByKey[r.district+'|||'+r.project+'|||'+r.band]=r);
  const matched = salesAgg.map(s=>{
    const r = rentByKey[s.district+'|||'+s.project+'|||'+s.band];
    if(!r) return null;
    const price = priceOf(s), rent = rentOf(r);
    if(price==null||rent==null) return null;
    const gy = rent*12/price;
    return {district:s.district, project:s.project, band:s.band, tenure:s.tenure,
      n:s.n, rentN:r.n, price, rent, grossYield:gy};
  }).filter(Boolean);

  const allYields = matched.map(m=>m.grossYield);
  const summaryGrid = document.getElementById('summaryGrid');
  const medYield = median(allYields);
  summaryGrid.innerHTML = `
    <div class="stat"><div class="v">${sRows.length.toLocaleString()}</div><div class="l">sale txns in filter</div></div>
    <div class="stat"><div class="v">${rRows.length.toLocaleString()}</div><div class="l">rental txns in filter</div></div>
    <div class="stat"><div class="v">${matched.length}</div><div class="l">project x size-band groups with both price &amp; rent</div></div>
    <div class="stat"><div class="v">${medYield!=null?fmtPct(medYield):'—'}</div><div class="l">median gross yield (matched, ${priceLabel.toLowerCase()})</div></div>
  `;

  // Sales table
  sortRows(salesAgg, state.sortSales, (r,c)=> c==='district'?r.district : c==='project'?r.project : c==='tenure'?r.tenure
    : c==='price'? priceOf(r) : c==='psf'? (state.weighting==='weighted'?r.wavgPsf:r.medianPsf) : r[c]);
  const sHead=['District','Project','Size band','Tenure','n','PSF ('+priceLabel+')','Price ('+priceLabel+')','Median Size'];
  const sKeys=['district','project','band','tenure','n','psf','price','medianSqft'];
  document.querySelector('#salesTable thead').innerHTML = '<tr>'+sHead.map((h,i)=>`<th data-k="${sKeys[i]}">${h}</th>`).join('')+'</tr>';
  document.querySelector('#salesTable tbody').innerHTML = salesAgg.map(r=>`<tr>
    <td>${r.district}</td>
    <td>${pgLink(r.project)}</td>
    <td>${BAND_NAMES[r.band]}</td><td>${r.tenure}</td><td>${r.n}</td>
    <td>${fmtCur(state.weighting==='weighted'?r.wavgPsf:r.medianPsf)}</td>
    <td>${fmtCur(priceOf(r))}</td><td>${Math.round(r.medianSqft)}</td>
  </tr>`).join('');

  // Rent table
  sortRows(rentAgg, state.sortRent, (r,c)=> c==='district'?r.district : c==='project'?r.project : c==='beds'?r.beds : c==='rent'?rentOf(r) : r[c]);
  const rHead=['District','Project','Size band','Bed','n','Rent ('+priceLabel+')','Median Size'];
  const rKeys=['district','project','band','beds','n','rent','medianSqft'];
  document.querySelector('#rentTable thead').innerHTML = '<tr>'+rHead.map((h,i)=>`<th data-k="${rKeys[i]}">${h}</th>`).join('')+'</tr>';
  document.querySelector('#rentTable tbody').innerHTML = rentAgg.map(r=>`<tr>
    <td>${r.district}</td><td>${pgLink(r.project)}</td><td>${BAND_NAMES[r.band]}</td><td>${r.beds}</td><td>${r.n}</td>
    <td>${fmtCur(rentOf(r))}</td><td>${Math.round(r.medianSqft)}</td>
  </tr>`).join('');

  // Matched table
  matched.sort((a,b)=>b.grossYield-a.grossYield);
  document.querySelector('#matchedTable thead').innerHTML = '<tr><th>District</th><th>Project</th><th>Size band</th><th>Tenure</th><th>Sales n</th>'+
    `<th>Price (${priceLabel})</th><th>Rent n</th><th>Rent (${priceLabel})</th><th>Gross Yield${infoTip("Annual rent divided by purchase price, before any costs, mortgage, or tax. A quick, rough-and-ready measure of a property's income potential - not the same as actual after-tax cash flow.", true)}</th><th></th></tr>`;
  document.querySelector('#matchedTable tbody').innerHTML = matched.map((r,idx)=>`<tr>
    <td>${r.district}</td><td>${pgLink(r.project)}</td><td>${BAND_NAMES[r.band]}</td><td>${r.tenure}</td><td>${r.n}</td>
    <td>${fmtCur(r.price)}</td><td>${r.rentN}</td><td>${fmtCur(r.rent)}</td>
    <td class="${r.grossYield>=0.03?'good':(r.grossYield>=0.025?'warn':'bad')}">${fmtPct(r.grossYield)}</td>
    <td><button class="use" data-idx="${idx}">Use</button></td>
  </tr>`).join('');
  document.querySelectorAll('#matchedTable button.use').forEach(btn=>{
    btn.onclick=()=>{
      const r = matched[btn.dataset.idx];
      document.getElementById('cPrice').value = Math.round(r.price);
      document.getElementById('cRent').value = Math.round(r.rent);
      const g = computeGrowthRate(r.district, r.project);
      if(g){ document.getElementById('cGrowth').value = (g.cagr*100).toFixed(2); LAST_GROWTH_INFO = g; }
      renderCalc();
      renderOppCost();
      window.scrollTo({top:document.getElementById('calcOut').getBoundingClientRect().top+window.scrollY-20, behavior:'smooth'});
    };
  });

  // Breakeven table (uses calculator's opex assumptions, matched table's price/rent basis per current weighting toggle)
  const cMcst=+document.getElementById('cMcst').value, cIns=+document.getElementById('cIns').value,
        cAgent=+document.getElementById('cAgent').value, cRepair=+document.getElementById('cRepair').value,
        cVac=+document.getElementById('cVac').value, cIncome=+document.getElementById('cIncome').value,
        cRate=+document.getElementById('cRate').value, cTenure=+document.getElementById('cTenure').value;
  const beRows = matched.map(r=>{
    const be = breakevenLTV(r.price, r.rent, cRate, cTenure, cMcst, cIns, cAgent, cRepair, cVac, cIncome);
    return {...r, breakeven: be};
  }).sort((a,b)=> (b.breakeven??-1)-(a.breakeven??-1));
  document.querySelector('#breakevenTable thead').innerHTML = '<tr><th>District</th><th>Project</th><th>Size band</th><th>Price</th><th>Rent</th><th>Gross Yield</th>'+
    `<th>Breakeven LTV${infoTip("The HIGHEST loan-to-value at which monthly cash flow (rent minus mortgage minus running costs minus tax) still stays at or above $0. Higher is better - it means the property can support a bigger, more typical loan without a monthly cash shortfall.", true)}</th><th>At 75% LTV?</th></tr>`;
  document.querySelector('#breakevenTable tbody').innerHTML = beRows.map(r=>{
    const beTxt = r.breakeven==null? 'never (rent &lt; opex+tax)' : (r.breakeven*100).toFixed(1)+'%';
    const cls = r.breakeven==null? 'bad' : (r.breakeven>=0.75?'good':(r.breakeven>=0.5?'warn':'bad'));
    const at75 = r.breakeven!=null && r.breakeven>=0.75 ? '<span class="good">Yes</span>' : '<span class="bad">No</span>';
    return `<tr><td>${r.district}</td><td>${pgLink(r.project)}</td><td>${BAND_NAMES[r.band]}</td><td>${fmtCur(r.price)}</td><td>${fmtCur(r.rent)}</td>
      <td>${fmtPct(r.grossYield)}</td><td class="${cls}">${beTxt}</td><td>${at75}</td></tr>`;
  }).join('');

  renderChart();
  populateChartProjectPicker(matched);
}

function renderCalc(){
  const price=+document.getElementById('cPrice').value, rent=+document.getElementById('cRent').value,
        ltv=+document.getElementById('cLTV').value, rate=+document.getElementById('cRate').value,
        tenure=+document.getElementById('cTenure').value, mcst=+document.getElementById('cMcst').value,
        ins=+document.getElementById('cIns').value, agent=+document.getElementById('cAgent').value,
        repair=+document.getElementById('cRepair').value, vac=+document.getElementById('cVac').value,
        income=+document.getElementById('cIncome').value,
        absdPct=+document.getElementById('cAbsd').value, buyerAgentPct=+document.getElementById('cBuyerAgent').value,
        legal=+document.getElementById('cLegal').value;
  const c = calcCashFlow(price,rent,ltv,rate,tenure,mcst,ins,agent,repair,vac,income);
  const be = breakevenLTV(price,rent,rate,tenure,mcst,ins,agent,repair,vac,income);
  const up = upfrontCosts(price, ltv, absdPct, buyerAgentPct, legal);
  // Exit-cost block: use the horizon + appreciation from the opportunity-cost card as the
  // "what would I net if I sold at year H?" assumption. These live below in the DOM but their
  // defaults (10yr / 0%) are read before the user touches anything.
  const horizonYrs = Math.max(1, Math.round(+document.getElementById('cHorizon').value || 10));
  const growthPct = +document.getElementById('cGrowth').value || 0;
  const propValAtH = price*Math.pow(1+growthPct/100, horizonYrs);
  const balAtH = loanBalanceAt(c.loan, rate, tenure, c.mortM, horizonYrs*12);
  const sellComm = SELL_AGENT_PCT_UI*propValAtH;
  const ssdRateH = ssdRate(horizonYrs);
  const ssdAmt = ssdRateH*propValAtH;
  const netProceeds = propValAtH - balAtH - sellComm - ssdAmt;
  const out = document.getElementById('calcOut');
  out.innerHTML = `
    <div class="calcline"><span>Gross yield</span><span>${fmtPct(c.grossYield)}</span></div>
    <div class="calcline"><span>Loan amount (${ltv}% LTV)</span><span>${fmtCur(c.loan)}</span></div>
    <div class="calcline"><span>Monthly mortgage (P&amp;I)</span><span>${fmtCur(c.mortM)}</span></div>
    <div class="calcline"><span>Property tax (non-owner-occ., annual)${infoTip("IRAS's non-owner-occupied residential rates (12/20/28/36% at $30k/$45k/$60k of Annual Value). Based on the unit's FULL market rent, not the vacancy-discounted figure - IRAS assesses Annual Value from comparable market rentals regardless of actual occupancy.")}</span><span>${fmtCur(c.ptax)}</span></div>
    <div class="calcline"><span>MCST + insurance + leasing agent + repairs (annual)</span><span>${fmtCur(c.mcstAnnual+ins+c.agentAmt+c.repairAmt)}</span></div>
    <div class="calcline"><span>Marginal tax rate on this rental profit (stacked on ${fmtCur(income)} other chargeable income)${infoTip("Rental profit is taxed as the TOP slice on top of your other chargeable income, using Singapore's real progressive resident tax brackets - not a flat guessed rate. A higher 'other income' pushes the rental profit into a higher bracket.")}</span><span>${c.marginalRate!=null?fmtPct(c.marginalRate):'0.00% (loss - no tax)'}</span></div>
    <div class="calcline"><span>Income tax on rental profit (annual, exact Yr-1 interest)</span><span>${fmtCur(c.incomeTax)}</span></div>
    <div class="calcline total"><span>Net cash flow after tax (monthly)</span><span class="${c.aftertaxMonthly>=0?'good':'bad'}">${fmtCur(c.aftertaxMonthly)}</span></div>
    <div class="calcline"><span>&nbsp;&nbsp;of which, principal repaid (equity build)</span><span>${fmtCur(c.principalYr1/12)}</span></div>
    <div class="calcline total"><span>"True economic" cash flow (excl. principal)</span><span class="${c.trueEconMonthly>=0?'good':'bad'}">${fmtCur(c.trueEconMonthly)}</span></div>
    <div class="calcline total"><span>Breakeven LTV (literal $0 cash flow)</span><span class="${be!=null&&be>=0.75?'good':'warn'}">${be==null?'not achievable':(be*100).toFixed(1)+'%'}</span></div>
    <div class="small" style="margin-top:8px;">"Net cash flow after tax" is what actually leaves your bank account each month. "True economic" cash flow adds back the mortgage principal portion, since that money converts into home equity rather than being spent. Year-1 interest is computed exactly via amortization. Income tax uses Singapore's real progressive resident brackets (IRAS, YA2024 onwards) applied to the rental profit as the TOP slice of the buyer's income, not a flat guessed rate.</div>
    <div class="calcline total" style="margin-top:14px;border-top:1px solid var(--border);padding-top:10px;"><span>Exit costs at year ${horizonYrs} (if sold)${infoTip("What actually reaches your bank on sale after the mortgage payoff, the seller's marketing agent commission (typically ~2% of sale price in Singapore), and Seller's Stamp Duty if you exit inside the 3-year SSD window (12% <1yr, 8% <2yr, 4% <3yr, 0% after). Uses the horizon and appreciation you set in the opportunity-cost section below.")}</span><span></span></div>
    <div class="calcline"><span>Estimated property value at year ${horizonYrs} (${growthPct.toFixed(2)}% CAGR)</span><span>${fmtCur(propValAtH)}</span></div>
    <div class="calcline"><span>Remaining mortgage balance at year ${horizonYrs}</span><span>&minus;${fmtCur(balAtH)}</span></div>
    <div class="calcline"><span>Selling agent commission (${(SELL_AGENT_PCT_UI*100).toFixed(1)}% of sale price)</span><span>&minus;${fmtCur(sellComm)}</span></div>
    <div class="calcline"><span>Seller's Stamp Duty (${(ssdRateH*100).toFixed(0)}% at ${horizonYrs}yr hold)${infoTip("IRAS SSD: 12% within 1yr of purchase, 8% <2yr, 4% <3yr, 0% thereafter. Applied to the sale price at exit.")}</span><span>&minus;${fmtCur(ssdAmt)}</span></div>
    <div class="calcline total"><span>Net proceeds from sale</span><span class="${netProceeds>=up.total?'good':'warn'}">${fmtCur(netProceeds)}</span></div>
    <div class="small" style="margin-top:8px;">Deterministic arithmetic: your original outlay was ${fmtCur(up.total)}. Ignoring the monthly cash flow and the money's time value, the property side of the trade nets ${netProceeds>=up.total?'a gain of ':'a loss of '}${fmtCur(Math.abs(netProceeds-up.total))} in nominal dollars at ${horizonYrs}yr / ${growthPct.toFixed(2)}% CAGR. See the "Opportunity cost of capital" chart below for the full comparison with your alternative investment (which factors in monthly cash flows and compounding).</div>
    <div class="calcline total" style="margin-top:14px;border-top:1px solid var(--border);padding-top:10px;"><span>Upfront cash required at purchase</span><span></span></div>
    <div class="calcline"><span>Down payment (${(100-ltv).toFixed(1)}% of price)</span><span>${fmtCur(up.downPayment)}</span></div>
    <div class="calcline"><span>Buyer's Stamp Duty (BSD, progressive scale)${infoTip("A tax on the purchase price paid by every property buyer in Singapore, regardless of citizenship. Progressive scale from 1% to 6% depending on price tier, per IRAS.")}</span><span>${fmtCur(up.bsd)}</span></div>
    <div class="calcline"><span>Additional Buyer's Stamp Duty (ABSD, ${absdPct}%)${infoTip("An extra flat-rate tax on top of BSD, applied based on the buyer's own citizenship/PR status and how many residential properties are already in their name - select the matching profile above.")}</span><span>${fmtCur(up.absd)}</span></div>
    <div class="calcline"><span>Buyer's own agent commission (${buyerAgentPct}% of price)</span><span>${fmtCur(up.buyerAgentAmt)}</span></div>
    <div class="calcline"><span>Legal &amp; misc costs</span><span>${fmtCur(up.legalMisc)}</span></div>
    <div class="calcline total"><span>Total cash needed at purchase</span><span>${fmtCur(up.total)}</span></div>
    <div class="small" style="margin-top:8px;">BSD (1-6% progressive) and ABSD rates are per IRAS (BSD effective 15-Feb-2023, ABSD effective 27-Apr-2023, both current through 2026). ABSD depends on the buyer's own citizenship/PR status and how many residential properties are already in that buyer's own name - select the matching profile above. In SG resale transactions the SELLER'S agent commission is normally paid by the seller, not the buyer - the buyer's-agent line defaults to 0% and should only be set if you're engaging an exclusive buyer's agent who charges you directly.</div>
  `;
}

// ---------------- opportunity cost of capital ----------------
// Historical price-appreciation CAGR for a project (falling back to its district if the project's
// own sale history is too thin), computed from REAL transacted PSF data - not assumed. Uses ALL
// available sale history for the project/district (ignores the table's date-window/size filters,
// since a short window isn't enough to compute a meaningful multi-year growth rate).
let LAST_GROWTH_INFO = null;
function computeGrowthRate(district, project){
  let rows, source;
  if(district && project){
    rows = SALES.filter(r=> r[0]===district && r[1]===project);
    source = `project ${district} — ${project}`;
    if(rows.length < 8){
      const thin = rows.length;
      rows = SALES.filter(r=> r[0]===district);
      source = `district ${district} (project history too thin: only ${thin} txns for ${project})`;
    }
  } else if(district){
    rows = SALES.filter(r=> r[0]===district);
    source = `district ${district}`;
  } else {
    rows = SALES;
    source = 'all districts blended';
  }
  const byQ = {};
  for(const [d,proj,ten,sqft,psf,price,ds] of rows){
    const q = quarterOf(ds);
    byQ[q] = byQ[q] || [];
    byQ[q].push(psf);
  }
  const quarters = Object.keys(byQ).sort(quarterSort);
  if(quarters.length<2) return null;
  const firstQ=quarters[0], lastQ=quarters[quarters.length-1];
  const firstPsf=median(byQ[firstQ]), lastPsf=median(byQ[lastQ]);
  const [fy,fq]=firstQ.split('-Q').map(Number), [ly,lq]=lastQ.split('-Q').map(Number);
  const years=((ly*4+lq)-(fy*4+fq))/4;
  if(years<=0 || !firstPsf || !lastPsf) return null;
  const cagr=Math.pow(lastPsf/firstPsf, 1/years)-1;
  return {cagr, years, firstQ, lastQ, firstPsf, lastPsf, n:rows.length, source};
}
function describeGrowth(g){
  if(!g) return 'Not enough historical spread to compute a trend (need sales in at least 2 distinct quarters).';
  return `Computed from real transacted PSF, ${g.source}: ${g.firstQ} ($${Math.round(g.firstPsf)}/sqft) → ${g.lastQ} ($${Math.round(g.lastPsf)}/sqft) over ${g.years.toFixed(1)} yrs, n=${g.n.toLocaleString()} sale txns → ${(g.cagr*100).toFixed(2)}% CAGR. Editable above - click "Use" on a matched-project row to recompute for that specific project/district.`;
}
function escapeXml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
// Hover info button for dynamically-rendered labels/headers (mirrors the static .info-tip markup in
// index.html). `below=true` for anything inside a scrolling .tablewrap (e.g. sticky <th>), since a
// tooltip popping upward there would be clipped by the container's overflow:auto.
function infoTip(text, below){ return `<span class="info-tip${below?' below':''}" tabindex="0">i<span class="info-bubble">${escapeXml(text)}</span></span>`; }
// keyLevels: [{value, label, color}] - drawn as precise dashed reference lines with exact $ labels
// on the right axis (start point, each series' final value), in addition to the generic gridlines.
function drawOppChart(years, series, keyLevels){
  const svg = document.getElementById('oppChart');
  const wrap = document.getElementById('oppLegend');
  const allVals = series.flatMap(s=>s.values);
  if(!allVals.length){ svg.innerHTML=''; wrap.innerHTML=''; return; }
  const yMin = 0, yMax = Math.max(...allVals)*1.08;
  const W=1080, H=380, padL=95, padR=100, padT=20, padB=50;
  const x = i => padL + (years.length<=1?0:i*(W-padL-padR)/(years.length-1));
  const y = v => H-padB - (v-yMin)/(yMax-yMin||1)*(H-padT-padB);
  let parts=[];
  parts.push(`<line x1="${padL}" y1="${H-padB}" x2="${W-padR}" y2="${H-padB}" stroke="#2a3244"/>`);
  parts.push(`<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H-padB}" stroke="#2a3244"/>`);
  for(let i=0;i<=4;i++){
    const v = yMin+i*(yMax-yMin)/4, yy=y(v);
    parts.push(`<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" stroke="#1e2534"/>`);
    parts.push(`<text x="${padL-8}" y="${yy+4}" fill="#8b93a7" font-size="10" text-anchor="end">${fmtCur(v)}</text>`);
  }
  const step = Math.max(1, Math.ceil(years.length/12));
  years.forEach((yr,i)=>{ if(i%step===0) parts.push(`<text x="${x(i)}" y="${H-padB+16}" fill="#8b93a7" font-size="10" text-anchor="middle">Yr ${yr}</text>`); });
  series.forEach(s=>{
    let path=''; let started=false;
    s.values.forEach((v,i)=>{ path += (started?'L':'M')+x(i)+','+y(v)+' '; started=true; });
    parts.push(`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-dasharray="${s.dash||'none'}"/>`);
    s.values.forEach((v,i)=>{
      const tip = (s.tooltips && s.tooltips[i]) ? `<title>${escapeXml(s.tooltips[i])}</title>` : '';
      parts.push(`<circle cx="${x(i)}" cy="${y(v)}" r="5.5" fill="${s.color}" style="cursor:help">${tip}</circle>`);
    });
  });
  // Precise key-level markers on the right edge, so exact $ amounts at start/end don't need hovering.
  (keyLevels||[]).forEach(kl=>{
    const yy = y(kl.value);
    const col = kl.color || '#8b93a7';
    parts.push(`<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" stroke="${col}" stroke-width="1" stroke-dasharray="2,3" opacity="0.7"/>`);
    parts.push(`<text x="${W-padR+6}" y="${yy+3}" fill="${col}" font-size="10.5" font-weight="600" text-anchor="start">${fmtCur(kl.value)}</text>`);
    parts.push(`<text x="${W-padR+6}" y="${yy+14}" fill="${col}" font-size="8.5" text-anchor="start" opacity="0.8">${escapeXml(kl.label)}</text>`);
  });
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = parts.join('');
  wrap.innerHTML = series.map(s=>`<span class="legend-item"><span class="legend-swatch" style="${s.dash?`background:transparent;border:2px dashed ${s.color};`:`background:${s.color};`}"></span>${s.label} — final: ${fmtCur(s.values[s.values.length-1])}</span>`).join('');
}
// Builds the piecewise rate schedule fed to simulateAmortization(), from the rate-mode toggle.
// 'flat' = single rate (cRate) for the whole tenure, matching the main calculator exactly.
// 'chunked' = up to 3 periods (Years 1-N, N+1-2N, 2N+1-onwards), each independently editable -
// lets you model a fixed-rate period followed by a reprice, e.g. a 3yr fixed SG mortgage package
// reverting to a floating/reference rate afterwards, rather than assuming one rate forever.
function buildRatePeriods(){
  const baseRate = +document.getElementById('cRate').value;
  if(state.rateMode!=='chunked') return [{years: 9999, ratePct: baseRate}];
  const periodYrs = Math.max(1, +document.getElementById('cRatePeriodYrs').value || 3);
  const r1 = +document.getElementById('cRateY1').value, r2 = +document.getElementById('cRateY2').value, r3 = +document.getElementById('cRateY3').value;
  return [{years: periodYrs, ratePct: r1}, {years: periodYrs, ratePct: r2}, {years: 9999, ratePct: r3}];
}
// After-tax monthly cash flow DURING calendar year t (t=0 is Year 1 of ownership), using the
// schedule's actual interest/payment for that year - so a rate reprice mid-horizon correctly
// changes both the mortgage payment AND the interest tax-deduction from that year onward. Rent,
// MCST, insurance, agent/repair %, and property tax are held flat at today's levels throughout
// (no rent growth or expense inflation is modeled - flagged in the on-page caveat).
function cashFlowForYear(t, schedule, rent, mcst, ins, agent, repair, vac, income){
  const startMonth=t*12+1, endMonth=(t+1)*12;
  let yearInterest=0, yearPaymentTotal=0, activeRatePct=null;
  for(let m=startMonth;m<=endMonth;m++){
    if(m<schedule.length){
      yearInterest+=schedule[m].interest;
      yearPaymentTotal+=(schedule[m].interest+schedule[m].principal);
      if(activeRatePct==null) activeRatePct=schedule[m].ratePct;
    }
    // months past the schedule's length = loan already fully repaid: contributes $0 interest and
    // $0 payment for the rest of that year, which correctly makes cash flow jump up once paid off.
  }
  const effAnnualRent = rent*(12-vac);
  const ptax = propertyTaxAnnual(rent*12);
  const agentAmt=effAnnualRent*(agent/100), repairAmt=effAnnualRent*(repair/100), mcstAnnual=mcst*12;
  const pretaxAnnual = effAnnualRent - yearPaymentTotal - mcstAnnual - ins - agentAmt - repairAmt - ptax;
  const taxableProfit = effAnnualRent - yearInterest - mcstAnnual - ins - agentAmt - repairAmt - ptax;
  const incomeTax = marginalTax(income, Math.max(taxableProfit,0));
  const aftertaxAnnual = pretaxAnnual - incomeTax;
  return {monthlyCF: aftertaxAnnual/12, activeRatePct};
}
function renderOppCost(){
  const price=+document.getElementById('cPrice').value, rent=+document.getElementById('cRent').value,
        ltv=+document.getElementById('cLTV').value, tenure=+document.getElementById('cTenure').value,
        mcst=+document.getElementById('cMcst').value, ins=+document.getElementById('cIns').value,
        agent=+document.getElementById('cAgent').value, repair=+document.getElementById('cRepair').value,
        vac=+document.getElementById('cVac').value, income=+document.getElementById('cIncome').value,
        absdPct=+document.getElementById('cAbsd').value, buyerAgentPct=+document.getElementById('cBuyerAgent').value,
        legal=+document.getElementById('cLegal').value, growthPct=+document.getElementById('cGrowth').value,
        oppCagr=+document.getElementById('cOppCagr').value,
        horizon=Math.max(1, Math.round(+document.getElementById('cHorizon').value || 10));
  const up = upfrontCosts(price, ltv, absdPct, buyerAgentPct, legal);
  const loan = price*(ltv/100);
  const rOpp = oppCagr/100/12;
  const periods = buildRatePeriods();
  const schedule = simulateAmortization(loan, tenure, periods);

  // BSD/ABSD/buyer's agent/legal never convert into equity and never come back - they're spent
  // the moment you buy. They're still part of the capital you committed, though, so both chart
  // lines should start from the SAME total (up.total) - the property path carries this piece
  // forward as a frozen ($0-return) component rather than silently excluding it, which would make
  // the two lines start at different points for no visible reason.
  const sunkCost = up.total - up.downPayment;

  const cfByYear = [...Array(horizon).keys()].map(t=>cashFlowForYear(t, schedule, rent, mcst, ins, agent, repair, vac, income));

  document.getElementById('oppCostBox').innerHTML = `
    <div class="stat"><div class="v">${fmtCur(up.total)}</div><div class="l">Total capital outlay (down payment + BSD + ABSD + agent + legal)</div></div>
    <div class="stat"><div class="v">${fmtCur(sunkCost)}</div><div class="l">Of which, one-time sunk costs (never recovered, don't compound)</div></div>
    <div class="stat"><div class="v">${growthPct.toFixed(2)}%</div><div class="l">Assumed property/district appreciation (CAGR)</div></div>
    <div class="stat"><div class="v">${fmtCur(cfByYear[0].monthlyCF)}</div><div class="l">Monthly cash flow, Year 1${state.rateMode==='chunked'?' (varies by rate period thereafter)':' (held flat across the horizon)'}</div></div>
  `;
  document.getElementById('growthSource').textContent = describeGrowth(LAST_GROWTH_INFO);

  const years = [...Array(horizon+1).keys()];
  const propTip = [], altTip = [];
  // Reinvest/redirect each year's actual surplus or shortfall, compounded from the point it
  // occurred to year t - not a single lump sum, since the amount itself can change year to year
  // once a rate reprice hits.
  function cumulativeSurplusFV(t){
    let fv=0;
    for(let y=0;y<t;y++){ const cf=cfByYear[y].monthlyCF; if(cf>0){ fv += fvAnnuity(cf,12,rOpp)*Math.pow(1+rOpp,(t-(y+1))*12); } }
    return fv;
  }
  function cumulativeShortfallFV(t){
    let fv=0;
    for(let y=0;y<t;y++){ const cf=cfByYear[y].monthlyCF; if(cf<0){ fv += fvAnnuity(-cf,12,rOpp)*Math.pow(1+rOpp,(t-(y+1))*12); } }
    return fv;
  }
  // Property path = net equity (value minus remaining loan balance, from the actual rate-schedule
  // simulation) minus exit costs realized if sold at year t (2% marketing agent commission + SSD
  // if inside the 3-year window) + the frozen sunk-cost slice + cumulative reinvested cash-flow
  // surplus. At t=0 no exit costs apply - you just bought, no sale realized.
  const equityPath = years.map(t=>{
    const months = Math.min(t*12, schedule.length-1);
    const propVal = price*Math.pow(1+growthPct/100, t);
    const bal = schedule[months].balance;
    const equity = propVal - bal;
    const pctOwned = propVal>0 ? equity/propVal*100 : 0;
    const sellComm = t>0 ? SELL_AGENT_PCT_UI*propVal : 0;
    const ssdR = t>0 ? ssdRate(t) : 0;
    const ssdAmt = ssdR*propVal;
    const surplusFV = cumulativeSurplusFV(t);
    const total = equity - sellComm - ssdAmt + sunkCost + surplusFV;
    propTip.push(`Year ${t}\nProperty value: ${fmtCur(propVal)}\nLoan balance: ${fmtCur(bal)}  (rate: ${schedule[months].ratePct}%)\nEquity: ${fmtCur(equity)}  (${pctOwned.toFixed(1)}% owned)`
      + (sellComm>0 ? `\n- selling agent commission (${(SELL_AGENT_PCT_UI*100).toFixed(1)}%): ${fmtCur(sellComm)}` : '')
      + (ssdAmt>0  ? `\n- Seller's Stamp Duty (${(ssdR*100).toFixed(0)}%, inside ${Math.ceil(3)}yr window): ${fmtCur(ssdAmt)}` : '')
      + `\n+ sunk transaction costs (frozen): ${fmtCur(sunkCost)}`
      + (surplusFV>0 ? `\n+ reinvested cash-flow surplus (cumulative): ${fmtCur(surplusFV)}` : '')
      + `\nTotal: ${fmtCur(total)}`);
    return total;
  });
  // Alternative path = total outlay invested at t=0, PLUS every year's actual cash shortfall (if
  // any) redirected into the alternative investment instead (since in the "don't buy" world you'd
  // never have had to find that cash to begin with).
  const altPath = years.map(t=>{
    const base = up.total*Math.pow(1+oppCagr/100, t);
    const redirectedFV = cumulativeShortfallFV(t);
    const total = base + redirectedFV;
    altTip.push(`Year ${t}\nOutlay grown at ${oppCagr}%: ${fmtCur(base)}`
      + (redirectedFV>0 ? `\n+ redirected monthly shortfalls (cumulative): ${fmtCur(redirectedFV)}` : '')
      + `\nTotal: ${fmtCur(total)}`);
    return total;
  });

  drawOppChart(years, [
    {label:'Capital invested elsewhere (+ redirected shortfalls)', color:'#3ecf8e', dash:'6,4', values:altPath, tooltips:altTip},
    {label:'Property path (net equity after 2% sell commission + SSD when applicable, + sunk costs, + reinvested surplus)', color:'#4f8cff', dash:'none', values:equityPath, tooltips:propTip},
  ], [
    {value: up.total, label:'Start (both paths)', color:'#8b93a7'},
    {value: equityPath[equityPath.length-1], label:'Property, final', color:'#4f8cff'},
    {value: altPath[altPath.length-1], label:'Alternative, final', color:'#3ecf8e'},
  ]);
}

// ---------------- probability panel ----------------
function interp(checkpoints, values, ltv){
  if(ltv<=checkpoints[0]) return values[0];
  if(ltv>=checkpoints[checkpoints.length-1]) return values[values.length-1];
  for(let i=0;i<checkpoints.length-1;i++){
    if(ltv>=checkpoints[i] && ltv<=checkpoints[i+1]){
      const t=(ltv-checkpoints[i])/(checkpoints[i+1]-checkpoints[i]);
      return values[i]+t*(values[i+1]-values[i]);
    }
  }
  return values[values.length-1];
}
function bandOverlapsFilter(band){
  const [lo,hi] = BAND_RANGE[band];
  return hi>state.sizeMin && lo<state.sizeMax;
}
function renderProb(){
  const ltvPct = +document.getElementById('probLtv').value;
  document.getElementById('probLtvLabel').textContent = ltvPct+'%';
  const ltv = ltvPct/100;
  const cp = PROB.checkpoints;
  const tenureKey = state.tenure==='freehold' ? 'FH' : (state.tenure==='leasehold' ? 'LH' : 'ALL');
  const records = PROB.byTenure[tenureKey] || [];
  const rows = records
    .filter(rec => state.districts.has(rec.district) && bandOverlapsFilter(rec.band))
    .map(rec=>{
      const pNear = interp(cp, rec.near, ltv);
      const pStrict = interp(cp, rec.strict, ltv);
      return {...rec, pNear, pStrict};
    })
    .sort((a,b)=> b.pNear-a.pNear);
  const districtRows = rows.filter(r=>r.level==='district');
  const projectRows = rows.filter(r=>r.level==='project');
  const ordered = [...districtRows, ...projectRows];
  document.querySelector('#probTable thead').innerHTML =
    '<tr><th>Level</th><th>District / Project</th><th>Size band</th><th>n (sales&times;rent)</th><th>Median Price</th><th>Median Rent</th>'+
    '<th>P(literal breakeven, CF&ge;$0)</th><th>P(near-breakeven, CF&ge;&minus;$250)</th><th>&ge;75%?</th></tr>';
  document.querySelector('#probTable tbody').innerHTML = ordered.map(r=>{
    const cls = r.pNear>=0.75?'good':(r.pNear>=0.5?'warn':'bad');
    const label = r.level==='district' ? ('<b>'+r.district+' — '+(DISTRICT_NAMES[r.district]||'')+' (ALL projects)</b>') : (r.district+' — '+pgLink(r.project));
    const flag = r.pNear>=0.75 ? '<span class="good">YES</span>' : '<span class="bad">no</span>';
    return `<tr style="${r.level==='district'?'background:rgba(79,140,255,0.08);':''}">
      <td>${r.level==='district'?'District':'Project'}</td><td>${label}</td><td>${BAND_NAMES[r.band]}</td>
      <td>${r.n_sales}&times;${r.n_rent}</td><td>${fmtCur(r.median_price)}</td><td>${fmtCur(r.median_rent)}</td>
      <td class="${r.pStrict>=0.75?'good':(r.pStrict>=0.5?'warn':'bad')}">${(r.pStrict*100).toFixed(1)}%</td>
      <td class="${cls}">${(r.pNear*100).toFixed(1)}%</td><td>${flag}</td>
    </tr>`;
  }).join('');
}

// ---------------- trend chart ----------------
function quarterOf(dateStr){
  const [y,m] = dateStr.split('-').map(Number);
  return y+'-Q'+Math.ceil(m/3);
}
function quarterSort(a,b){
  const [ya,qa]=a.split('-Q').map(Number), [yb,qb]=b.split('-Q').map(Number);
  return (ya*4+qa)-(yb*4+qb);
}
const CHART_COLORS = ['#4f8cff','#3ecf8e','#ffb84f','#ff6b6b','#c792ea','#40c4ff','#f78fb3','#a3e635'];

function renderChart(){
  const svg = document.getElementById('trendChart');
  const wrap = document.getElementById('chartLegend');
  const metricsToShow = state.chartMetric==='both' ? ['sale','rent'] : [state.chartMetric];
  const seriesMap = {}; // key: labelBase|||metric -> {labelBase, metric, byQ:{quarter:[values]}}

  function push(labelBase, metric, q, val){
    if(val==null || !isFinite(val)) return;
    const key = labelBase+'|||'+metric;
    if(!seriesMap[key]) seriesMap[key] = {labelBase, metric, byQ:{}};
    seriesMap[key].byQ[q] = seriesMap[key].byQ[q] || [];
    seriesMap[key].byQ[q].push(val);
  }

  if(state.chartMode==='district'){
    // Chart has its own independent district filter (state.chartDistricts) - separate from the
    // top-of-page table filter - so filteredSalesNoDistrict/filteredRentNoDistrict are used here.
    if(metricsToShow.includes('sale')){
      for(const [d,proj,ten,sqft,psf,price,ds] of filteredSalesNoDistrict()){
        if(!state.chartDistricts.has(d)) continue;
        push(d, 'sale', quarterOf(ds), psf);
      }
    }
    if(metricsToShow.includes('rent')){
      for(const [d,proj,bed,sqft,rent,ds] of filteredRentNoDistrict()){
        if(!state.chartDistricts.has(d)) continue;
        push(d, 'rent', quarterOf(ds), sqft>0 ? rent/sqft : null);
      }
    }
  } else {
    if(metricsToShow.includes('sale')){
      for(const [d,proj,ten,sqft,psf,price,ds] of filteredSalesNoDistrict()){
        if(!state.chartProjects.has(d+'|||'+proj)) continue;
        push(d+' — '+proj, 'sale', quarterOf(ds), psf);
      }
    }
    if(metricsToShow.includes('rent')){
      for(const [d,proj,bed,sqft,rent,ds] of filteredRentNoDistrict()){
        if(!state.chartProjects.has(d+'|||'+proj)) continue;
        push(d+' — '+proj, 'rent', quarterOf(ds), sqft>0 ? rent/sqft : null);
      }
    }
  }

  const seriesKeys = Object.keys(seriesMap);
  const allQuarters = new Set();
  seriesKeys.forEach(k=>Object.keys(seriesMap[k].byQ).forEach(q=>allQuarters.add(q)));
  const quarters = [...allQuarters].sort(quarterSort);

  if(quarters.length===0 || seriesKeys.length===0){
    svg.innerHTML = '<text x="20" y="30" fill="#8b93a7" font-size="13">No data for current chart selection.</text>';
    wrap.innerHTML='';
    return;
  }
  const pointsByKey = {};
  seriesKeys.forEach(k=>{ pointsByKey[k] = quarters.map(q => seriesMap[k].byQ[q] ? median(seriesMap[k].byQ[q]) : null); });
  const allVals = Object.values(pointsByKey).flat().filter(v=>v!=null);
  if(!allVals.length){
    svg.innerHTML = '<text x="20" y="30" fill="#8b93a7" font-size="13">No data for current chart selection.</text>';
    wrap.innerHTML='';
    return;
  }
  const yMin = Math.min(...allVals)*0.95, yMax = Math.max(...allVals)*1.05;

  const labelBases = [...new Set(seriesKeys.map(k=>seriesMap[k].labelBase))];
  const colorOf = lb => CHART_COLORS[labelBases.indexOf(lb) % CHART_COLORS.length];

  const W=1080, H=380, padL=70, padR=20, padT=20, padB=50;
  const x = i => padL + (quarters.length<=1?0:i*(W-padL-padR)/(quarters.length-1));
  const y = v => H-padB - (v-yMin)/(yMax-yMin)*(H-padT-padB);

  let svgParts = [];
  // axes
  svgParts.push(`<line x1="${padL}" y1="${H-padB}" x2="${W-padR}" y2="${H-padB}" stroke="#2a3244"/>`);
  svgParts.push(`<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H-padB}" stroke="#2a3244"/>`);
  // y gridlines/labels
  for(let i=0;i<=4;i++){
    const v = yMin + i*(yMax-yMin)/4;
    const yy = y(v);
    svgParts.push(`<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" stroke="#1e2534"/>`);
    svgParts.push(`<text x="${padL-8}" y="${yy+4}" fill="#8b93a7" font-size="10" text-anchor="end">$${Math.round(v)}</text>`);
  }
  // x labels (thin out if many)
  const step = Math.ceil(quarters.length/12);
  quarters.forEach((q,i)=>{ if(i%step===0){ svgParts.push(`<text x="${x(i)}" y="${H-padB+16}" fill="#8b93a7" font-size="10" text-anchor="middle">${q}</text>`); }});
  svgParts.push(`<text x="${padL-50}" y="${padT-4}" fill="#8b93a7" font-size="10">$ / sqft</text>`);

  seriesKeys.forEach(k=>{
    const {labelBase, metric} = seriesMap[k];
    const color = colorOf(labelBase);
    const dash = metric==='rent' ? '6,4' : 'none';
    let path=''; let started=false;
    pointsByKey[k].forEach((v,i)=>{
      if(v==null) { started=false; return; }
      path += (started?'L':'M')+x(i)+','+y(v)+' ';
      started=true;
    });
    svgParts.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-dasharray="${dash}"/>`);
    pointsByKey[k].forEach((v,i)=>{ if(v!=null) svgParts.push(`<circle cx="${x(i)}" cy="${y(v)}" r="2.6" fill="${color}"/>`); });
  });
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = svgParts.join('');

  wrap.innerHTML = seriesKeys.map(k=>{
    const {labelBase, metric} = seriesMap[k];
    const color = colorOf(labelBase);
    const niceLabel = DISTRICT_NAMES[labelBase] ? labelBase+' — '+DISTRICT_NAMES[labelBase] : labelBase;
    const swatchStyle = metric==='rent' ? `background:transparent;border:2px dashed ${color};` : `background:${color};`;
    const metricTag = metricsToShow.length>1 ? (metric==='rent' ? ' · Rental $/sqft' : ' · Sale $/sqft') : '';
    return `<span class="legend-item"><span class="legend-swatch" style="${swatchStyle}"></span>${niceLabel}${metricTag}</span>`;
  }).join('');
}

function populateChartProjectPicker(matched){
  const sel = document.getElementById('chartProjectSelect');
  if(document.activeElement===sel) return; // don't rebuild while user is interacting
  const uniq = [...new Map(matched.map(m=>[m.district+'|||'+m.project, m])).values()]
    .sort((a,b)=> b.n-a.n);
  sel.innerHTML = uniq.map(m=>`<option value="${m.district}|||${m.project}" ${state.chartProjects.has(m.district+'|||'+m.project)?'selected':''}>${m.district} — ${m.project} (n=${m.n})</option>`).join('');
}

// ---------------- controls wiring ----------------
function buildDistrictChips(){
  // District list comes from whatever is actually present in the loaded data, sorted by code -
  // NOT from the DISTRICT_NAMES lookup. A brand-new district code (e.g. from freshly added CSVs)
  // shows up automatically with a bare-code label until/unless you add a friendly name above.
  const codesInData = new Set([...SALES.map(r=>r[0]), ...RENT.map(r=>r[0])]);
  const codes = [...codesInData].sort();
  state.districts = new Set(codes);
  const el = document.getElementById('districtChips');
  el.innerHTML = codes.map(code=>{
    const name = DISTRICT_NAMES[code];
    return `<span class="chip active" data-d="${code}">${code}${name?(' — '+name):''}</span>`;
  }).join('');
  el.querySelectorAll('.chip').forEach(chip=>{
    chip.onclick=()=>{
      const d=chip.dataset.d;
      if(state.districts.has(d)){ state.districts.delete(d); chip.classList.remove('active'); }
      else { state.districts.add(d); chip.classList.add('active'); }
      render(); renderProb();
    };
  });
}
// Chart's own district filter - independent of the top-of-page table district chips
// (buildDistrictChips() / state.districts). Lets you narrow the chart without touching the tables.
function buildChartDistrictChips(){
  const codesInData = new Set([...SALES.map(r=>r[0]), ...RENT.map(r=>r[0])]);
  const codes = [...codesInData].sort();
  state.chartDistricts = new Set(codes);
  const el = document.getElementById('chartDistrictChips');
  el.innerHTML = codes.map(code=>{
    const name = DISTRICT_NAMES[code];
    return `<span class="chip active" data-d="${code}">${code}${name?(' — '+name):''}</span>`;
  }).join('');
  el.querySelectorAll('.chip').forEach(chip=>{
    chip.onclick=()=>{
      const d=chip.dataset.d;
      if(state.chartDistricts.has(d)){ state.chartDistricts.delete(d); chip.classList.remove('active'); }
      else { state.chartDistricts.add(d); chip.classList.add('active'); }
      renderChart();
    };
  });
}
function wireControls(){
  document.getElementById('tenureChips').querySelectorAll('.chip').forEach(chip=>{
    chip.onclick=()=>{
      document.querySelectorAll('#tenureChips .chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active'); state.tenure=chip.dataset.tenure; render(); renderProb();
    };
  });
  document.getElementById('bedChips').querySelectorAll('.chip').forEach(chip=>{
    chip.onclick=()=>{
      document.querySelectorAll('#bedChips .chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active'); state.bed=chip.dataset.bed; render();
    };
  });
  document.getElementById('weightChips').querySelectorAll('.chip').forEach(chip=>{
    chip.onclick=()=>{
      document.querySelectorAll('#weightChips .chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active'); state.weighting=chip.dataset.weight;
      document.getElementById('halfLifeRow').style.display = state.weighting==='weighted' ? 'block' : 'none';
      render();
    };
  });
  document.getElementById('halfLife').oninput = e=>{
    state.halfLifeMonths = +e.target.value;
    document.getElementById('halfLifeLabel').textContent = state.halfLifeMonths+'mo';
    render();
  };
  document.getElementById('sizeMin').oninput=e=>{
    state.sizeMin=Math.min(+e.target.value, state.sizeMax);
    document.getElementById('sizeLabel').textContent=state.sizeMin+'–'+state.sizeMax; render(); renderProb();
  };
  document.getElementById('sizeMax').oninput=e=>{
    state.sizeMax=Math.max(+e.target.value, state.sizeMin);
    document.getElementById('sizeLabel').textContent=state.sizeMin+'–'+state.sizeMax; render(); renderProb();
  };
  document.getElementById('dateWindow').onchange=e=>{ state.dateWindow=+e.target.value; render(); };
  // Calculator inputs: recompute ONLY on `change` (fires when focus leaves the field, on
  // Enter, or on arrow-key increment for number inputs; fires immediately for <select>).
  // Not on `input` - re-rendering on every keystroke made the page jump around while typing
  // multi-digit numbers like "1650000" (7 recomputes, one per digit). The sliders elsewhere
  // (sizeMin/sizeMax/halfLife/probLtv) still use `oninput` for live dragging feedback.
  document.querySelectorAll('input[id^=c], select[id^=c]').forEach(inp=>{
    inp.onchange=()=>{ renderCalc(); render(); renderOppCost(); renderModelCard(); };
  });
  document.getElementById('probLtv').oninput = renderProb;

  document.addEventListener('click', e=>{
    const th = e.target.closest('th[data-k]');
    if(!th) return;
    const table = th.closest('table').id;
    const map = {salesTable:'sortSales', rentTable:'sortRent'};
    const key = map[table]; if(!key) return;
    const s = state[key];
    if(s.col===th.dataset.k) s.dir*=-1; else { s.col=th.dataset.k; s.dir=1; }
    render();
  });

  document.getElementById('chartModeChips').querySelectorAll('.chip').forEach(chip=>{
    chip.onclick=()=>{
      document.querySelectorAll('#chartModeChips .chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active'); state.chartMode=chip.dataset.mode;
      document.getElementById('chartProjectPicker').style.display = state.chartMode==='project'?'block':'none';
      document.getElementById('chartDistrictPicker').style.display = state.chartMode==='district'?'block':'none';
      renderChart();
    };
  });
  document.getElementById('chartMetricChips').querySelectorAll('.chip').forEach(chip=>{
    chip.onclick=()=>{
      document.querySelectorAll('#chartMetricChips .chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active'); state.chartMetric=chip.dataset.metric;
      renderChart();
    };
  });
  document.getElementById('rateModeChips').querySelectorAll('.chip').forEach(chip=>{
    chip.onclick=()=>{
      document.querySelectorAll('#rateModeChips .chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active'); state.rateMode=chip.dataset.mode;
      document.getElementById('rateChunkFields').style.display = state.rateMode==='chunked'?'flex':'none';
      renderOppCost();
    };
  });
  document.getElementById('chartProjectSelect').onchange = e=>{
    state.chartProjects = new Set([...e.target.selectedOptions].map(o=>o.value));
    renderChart();
  };
}

// ============================================================================
// STOCHASTIC PRICE-RENT MODEL (provisional) - reads precomputed artifacts only.
// ZERO statistics in the browser: this loads series.json / model_params.json /
// mc_grid.json / model_meta.json and interpolates the grid. All fitting is done
// offline in sg_price_rent_model.ipynb. Loads non-fatally: if the artifacts are
// absent (e.g. not yet regenerated), the card stays hidden and the rest of the
// app is unaffected.
// ============================================================================
let SERIES=null, MODEL_PARAMS=null, MC_GRID=null, MODEL_META=null, MODEL_OK=false;
let MC_INDEX=null, BE_INDEX=null;

async function loadModelArtifacts(){
  try{
    const [series, params, grid, meta] = await Promise.all([
      fetch('data/series.json').then(r=>r.ok?r.json():null).catch(()=>null),
      fetch('data/model_params.json').then(r=>r.ok?r.json():null).catch(()=>null),
      fetch('data/mc_grid.json').then(r=>r.ok?r.json():null).catch(()=>null),
      fetch('data/model_meta.json').then(r=>r.ok?r.json():null).catch(()=>null),
    ]);
    if(series && params && grid && meta){
      SERIES=series; MODEL_PARAMS=params; MC_GRID=grid; MODEL_META=meta;
      buildMcIndex();
      MODEL_OK=true;
    }
  }catch(e){ MODEL_OK=false; }
}

const mcKey6=(d,b,h,l,dr,e)=>`${d}|${b}|${h}|${l}|${dr}|${e}`;
const mcKey5=(d,b,h,l,e)=>`${d}|${b}|${h}|${l}|${e}`;
function buildMcIndex(){
  MC_INDEX=new Map(); BE_INDEX=new Map();
  for(const c of MC_GRID.cells)
    MC_INDEX.set(mcKey6(c.district,c.entry_yield_bucket,c.horizon_years,c.ltv_pct,c.appreciation_drift_pct,c.etf_return_pct), c);
  for(const b of MC_GRID.breakeven)
    BE_INDEX.set(mcKey5(b.district,b.entry_yield_bucket,b.horizon_years,b.ltv_pct,b.etf_return_pct), b);
}

// Bracketing grid indices + weights for a query value on one sorted axis (clamped at the ends).
function lerpAxis(vals, q){
  if(q<=vals[0]) return [[0,1]];
  if(q>=vals[vals.length-1]) return [[vals.length-1,1]];
  for(let i=0;i<vals.length-1;i++){
    if(q>=vals[i] && q<=vals[i+1]){
      const t=(q-vals[i])/(vals[i+1]-vals[i]);
      if(t===0) return [[i,1]]; if(t===1) return [[i+1,1]];
      return [[i,1-t],[i+1,t]];
    }
  }
  return [[vals.length-1,1]];
}

// Nearest entry-yield bucket for a district, from the stored bucket edges.
function bucketForYield(district, y){
  const edges=MC_GRID.entry_yield_bucket_edges[district];
  if(!edges) return 'mid';
  if(y<=edges.low[1]) return 'low';
  if(y<=edges.mid[1]) return 'mid';
  return 'high';
}

// Multilinear interpolation of a grid cell over the 4 continuous axes (horizon, LTV,
// drift, ETF); district + entry-yield bucket are exact. Mirrors prob_data.json's LTV
// interpolation pattern, generalised to 4 dimensions.
function interpMc(district, bucket, h, ltv, drift, etf){
  const ax=MC_GRID.axes;
  const hw=lerpAxis(ax.horizon_years,h), lw=lerpAxis(ax.ltv_pct,ltv),
        dw=lerpAxis(ax.appreciation_drift_pct,drift), ew=lerpAxis(ax.etf_return_pct,etf);
  const acc={buy:{},etf:{}, prob:0, ref_price:0, outlay:0}; let wsum=0;
  const PS=['p10','p25','median','p75','p90'];
  for(const [hi,wh] of hw) for(const [li,wl] of lw) for(const [di,wd] of dw) for(const [ei,we] of ew){
    const w=wh*wl*wd*we; if(w===0) continue;
    const cell=MC_INDEX.get(mcKey6(district,bucket,ax.horizon_years[hi],ax.ltv_pct[li],ax.appreciation_drift_pct[di],ax.etf_return_pct[ei]));
    if(!cell) continue;
    wsum+=w;
    for(const p of PS){ acc.buy[p]=(acc.buy[p]||0)+w*cell.buy_terminal_wealth_real[p];
                        acc.etf[p]=(acc.etf[p]||0)+w*cell.etf_terminal_wealth_real[p]; }
    acc.prob+=w*cell.prob_buy_beats_etf; acc.ref_price+=w*cell.ref_price; acc.outlay+=w*cell.outlay;
  }
  if(wsum===0) return null;
  for(const p of PS){ acc.buy[p]/=wsum; acc.etf[p]/=wsum; }
  acc.prob/=wsum; acc.ref_price/=wsum; acc.outlay/=wsum;
  return acc;
}
function interpBreakeven(district, bucket, h, ltv, etf){
  const ax=MC_GRID.axes;
  const hw=lerpAxis(ax.horizon_years,h), lw=lerpAxis(ax.ltv_pct,ltv), ew=lerpAxis(ax.etf_return_pct,etf);
  let acc=0, wsum=0, sawNull=false;
  for(const [hi,wh] of hw) for(const [li,wl] of lw) for(const [ei,we] of ew){
    const w=wh*wl*we; if(w===0) continue;
    const b=BE_INDEX.get(mcKey5(district,bucket,ax.horizon_years[hi],ax.ltv_pct[li],ax.etf_return_pct[ei]));
    if(!b) continue;
    if(b.breakeven_appreciation_cagr_pct==null){ sawNull=true; continue; }
    acc+=w*b.breakeven_appreciation_cagr_pct; wsum+=w;
  }
  return wsum>0 ? {value:acc/wsum, partial:sawNull} : {value:null, partial:sawNull};
}

function renderModelCard(){
  if(!MODEL_OK) return;
  const card=document.getElementById('modelCard');
  if(card) card.style.display='block';
  // populate district selector once
  const sel=document.getElementById('mcDistrict');
  if(sel && !sel.dataset.filled){
    sel.innerHTML=MC_GRID.axes.district.map(d=>`<option value="${d}">${d}${DISTRICT_NAMES[d]?(' — '+DISTRICT_NAMES[d]):''}</option>`).join('');
    sel.dataset.filled='1';
    if(LAST_GROWTH_INFO && LAST_GROWTH_INFO.district && MC_GRID.axes.district.includes(LAST_GROWTH_INFO.district))
      sel.value=LAST_GROWTH_INFO.district;
  }
  const district=(sel&&sel.value)||MC_GRID.axes.district[0];
  const price=+document.getElementById('cPrice').value, rent=+document.getElementById('cRent').value,
        ltv=+document.getElementById('cLTV').value, horizon=+document.getElementById('cHorizon').value,
        drift=+document.getElementById('cGrowth').value, etf=+document.getElementById('cOppCagr').value;
  const entryYield = price>0 ? rent*12/price : null;
  const bucket = entryYield!=null ? bucketForYield(district, entryYield) : 'mid';

  const seg = MODEL_PARAMS.segments[district] ||
    MODEL_PARAMS.segments[Object.keys(MODEL_PARAMS.segments).find(k=>k.startsWith(district))||''];
  const globalFlag = MODEL_PARAMS.global_data_adequacy.flag;
  const provisional = globalFlag!=='ok';

  const banner = document.getElementById('mcBanner');
  banner.className = 'model-banner ' + (provisional?'prov':'ok');
  banner.innerHTML = provisional
    ? `<b>Provisional / low-confidence.</b> ${escapeXml(MODEL_PARAMS.global_data_adequacy.reason)}. `
      + `These outputs are shown for completeness and will firm up when a longer history is loaded. `
      + `Data span: ${MODEL_META.source.date_range[0]}&ndash;${MODEL_META.source.date_range[1]} (${MODEL_META.source.n_quarters} quarters, seed ${MODEL_META.monte_carlo.seed}, ${MODEL_META.monte_carlo.n_paths.toLocaleString()} paths).`
    : `<b>Model fitted.</b> ${escapeXml(MODEL_PARAMS.global_data_adequacy.reason)}`;

  // ---- valuation gauge + fitted econometrics (labeled by confidence) ----
  const gaugeEl=document.getElementById('mcGauge');
  if(seg){
    const co=seg.cointegration.cointegrated_at_5pct, ec=seg.vecm.error_correction||{};
    const ou=seg.ou_yield, corr=seg.correlation;
    const brk=seg.structural_breaks;
    const gapTxt = (ec.current_gap!=null)
      ? `${ec.current_gap>0?'+':''}${ec.current_gap.toFixed(3)} (${ec.current_gap>0?'price above':'price below'} the rent-implied level)`
      : '&mdash;';
    gaugeEl.innerHTML = `
      <div class="stat"><div class="v ${co?'good':'warn'}">${co?'Yes':'Not established'}</div>
        <div class="l">Price-rent cointegration at 5%${infoTip('Whether a stable long-run price-to-rent relationship is statistically established. On ~20 quarters of one regime this is expected to be Not established; the VECM gap below is then indicative only.')}</div></div>
      <div class="stat"><div class="v">${gapTxt}</div>
        <div class="l">VECM valuation gap${co?'':' (indicative, not established)'}${infoTip('The error-correction term: how far the current price sits from the level rent would justify, in log points. Positive = price looks stretched vs rent. Meaningful only once cointegration is established.')}</div></div>
      <div class="stat"><div class="v">${(ou.long_run_yield*100).toFixed(2)}%<span class="se"> &plusmn;${ou.long_run_yield_se!=null?(ou.long_run_yield_se*100).toFixed(2):'?'}</span></div>
        <div class="l">OU long-run gross yield (half-life ${ou.half_life_years}y)${infoTip('The yield the mean-reverting model pulls toward, with its standard error. Your entry yield above vs this shows whether you are buying cheap or rich to the long-run. Regime-dependent: not eternal.')}</div></div>
      <div class="stat"><div class="v">${corr.price_rent_return_corr!=null?corr.price_rent_return_corr.toFixed(2):'&mdash;'}<span class="se"> ${corr.ci95?`[${corr.ci95[0].toFixed(2)}, ${corr.ci95[1].toFixed(2)}]`:''}</span></div>
        <div class="l">Price-rent return correlation (95% CI)${infoTip('Quarterly co-movement of price and rent growth, with a 95% confidence interval. A very wide interval spanning zero means the short sample cannot pin this down.')}</div></div>`;
    document.getElementById('mcBreakNote').innerHTML = brk && brk.breaks_detected && brk.breaks_detected.length
      ? `<span class="warn">Structural break flagged</span> in the ${district} yield series (${brk.method}). The long-run yield is regime-dependent; pre-break history should not be pooled once longer data is available.`
      : `No structural break detected in the ${district} yield series so far (${brk?brk.method:'n/a'}); with only ${seg.n_quarters} quarters this test has low power.`;
  } else {
    gaugeEl.innerHTML=''; document.getElementById('mcBreakNote').textContent='';
  }

  // ---- Monte-Carlo terminal wealth + break-even ----
  const mc=interpMc(district, bucket, horizon, ltv, drift, etf);
  const be=interpBreakeven(district, bucket, horizon, ltv, etf);
  const outEl=document.getElementById('mcResult');
  if(!mc){ outEl.innerHTML='<div class="small">No grid coverage for this selection.</div>'; return; }
  const beTxt = be.value==null ? 'no crossover in range' : `${be.value.toFixed(2)}% / yr`;
  const beCls = (be.value!=null && drift>=be.value) ? 'good' : 'warn';
  outEl.innerHTML = `
    <div class="summary-grid">
      <div class="stat" style="border-color:${beCls==='good'?'var(--good)':'var(--warn)'}">
        <div class="v ${beCls}">${beTxt}</div>
        <div class="l">Break-even appreciation${infoTip('The appreciation CAGR at which buying and the ETF finish equal (median path), at your LTV, horizon, entry yield and ETF return. Above it, buying wins on the median path; below it, the ETF wins. This is the headline the data speaks to most robustly.')}</div></div>
      <div class="stat"><div class="v ${mc.prob>=0.5?'good':'bad'}">${(mc.prob*100).toFixed(0)}%</div>
        <div class="l">P(buying beats ETF) at ${drift.toFixed(1)}% appreciation${infoTip('Share of simulated paths on which the property terminal wealth exceeds the ETF, at your chosen appreciation drift.')}</div></div>
      <div class="stat"><div class="v">${fmtCur(mc.buy.median)}</div>
        <div class="l">Buy: median real terminal wealth<br><span class="small">P10&ndash;P90 ${fmtCur(mc.buy.p10)} to ${fmtCur(mc.buy.p90)}</span></div></div>
      <div class="stat"><div class="v">${fmtCur(mc.etf.median)}</div>
        <div class="l">ETF: median real terminal wealth<br><span class="small">P10&ndash;P90 ${fmtCur(mc.etf.p10)} to ${fmtCur(mc.etf.p90)}</span></div></div>
    </div>
    <div class="small" style="margin-top:8px;">
      District <b>${district}</b>, entry-yield bucket <b>${bucket}</b> (your entry yield ${entryYield!=null?(entryYield*100).toFixed(2)+'%':'n/a'}),
      ${horizon}-year horizon, ${ltv}% LTV, ${etf.toFixed(1)}% ETF return. Terminal wealth is after-tax, after exit costs
      (2% selling commission + SSD if within the holding window), inflation-adjusted (real), computed at the district reference
      price of ${fmtCur(mc.ref_price)} (outlay ${fmtCur(mc.outlay)}); scale by your own price for a rough dollar figure.
      ${be.partial?'<br><span class="warn">Some grid corners had no crossover in range; break-even is interpolated from those that did.</span>':''}
      Values interpolated between precomputed grid points; the browser runs no simulation.
    </div>`;
}

// ---------------- boot ----------------
async function boot(){
  const statusEl = document.getElementById('loadStatus');
  try{
    statusEl.textContent = 'Loading data/sales.json, data/rent.json, data/prob_data.json ...';
    const [sales, rent, prob] = await Promise.all([
      fetch('data/sales.json').then(r=>{ if(!r.ok) throw new Error('sales.json '+r.status); return r.json(); }),
      fetch('data/rent.json').then(r=>{ if(!r.ok) throw new Error('rent.json '+r.status); return r.json(); }),
      fetch('data/prob_data.json').then(r=>{ if(!r.ok) throw new Error('prob_data.json '+r.status); return r.json(); }),
    ]);
    SALES = sales; RENT = rent; PROB = prob;
    document.getElementById('nSales').textContent = SALES.length.toLocaleString();
    document.getElementById('nRent').textContent = RENT.length.toLocaleString();
    statusEl.textContent = '';
    document.getElementById('app').style.display = 'block';
    buildDistrictChips();
    buildChartDistrictChips();
    wireControls();
    LAST_GROWTH_INFO = computeGrowthRate(null, null);
    if(LAST_GROWTH_INFO) document.getElementById('cGrowth').value = (LAST_GROWTH_INFO.cagr*100).toFixed(2);
    await loadModelArtifacts();   // non-fatal: card stays hidden if artifacts are absent
    const mcSel = document.getElementById('mcDistrict');
    if(mcSel) mcSel.onchange = renderModelCard;
    renderCalc();
    render();
    renderProb();
    renderOppCost();
    renderModelCard();
  } catch(err){
    statusEl.innerHTML = 'Failed to load data files: '+err.message+
      '<br>This page must be served over HTTP(S) - opening index.html directly via file:// blocks fetch() of local JSON in most browsers. '+
      'Run a local server (e.g. <code>python3 -m http.server</code> in this folder) or view it via GitHub Pages once published.';
  }
}
boot();
