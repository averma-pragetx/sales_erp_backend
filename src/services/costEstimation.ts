import { IBomComponent, IEquipmentBom, INozzle } from '../models/Stage7Work';

// ── MOC normalization ─────────────────────────────────────────────────────────

function normForMatch(s: string): string {
  return s.toLowerCase().replace(/[-.:\/]/g, ' ').replace(/\s+/g, ' ').trim();
}
function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── MOC rate table (₹/kg, Indian market 2024-25) ──────────────────────────────
const MOC_RATE_TABLE: Array<[string[], number]> = [
  [['titanium gr 1', 'ti gr 1', 'uns r50250'], 3900],
  [['titanium gr 2', 'titanium grade 2', 'ti gr 2', 'uns r50400'], 3600],
  [['titanium'], 3600],
  [['hastelloy c-276', 'hastelloy c276', 'uns n10276', 'hastalloy'], 3300],
  [['hastelloy c22', 'uns n06022'], 3900],
  [['hastelloy b', 'uns n10001'], 3200],
  [['hastelloy'], 3100],
  [['inconel 625', 'alloy 625', 'uns n06625', 'in-625', 'in625'], 3800],
  [['inconel 600', 'alloy 600', 'uns n06600', 'in-600', 'in600'], 3400],
  [['incoloy 825', 'alloy 825', 'uns n08825', 'in-825', 'in825'], 2100],
  [['inconel 800', 'alloy 800', 'uns n08800'], 2300],
  [['inconel', 'incoloy'], 2800],
  [['monel 400', 'monel k500', 'uns n04400', 'uns n05500'], 2100],
  [['monel'], 2000],
  [['nickel 200', 'nickel 201', 'pure nickel', 'uns n02200'], 1500],
  [['nickel'], 1400],
  [['super duplex', '2507', 'uns s32750', 'uns s32760', 'f55', '25cr-7ni', 'sdss'], 870],
  [['duplex 2205', 'saf 2205', 'uns s31803', 'uns s32205', '22cr duplex', '2205'], 680],
  [['duplex'], 680],
  [['ss 347', 'ss347', '347 ss', 'sa 240 gr.347', 'sa 240 347', '1.4912'], 450],
  [['ss 321', 'ss321', '321 ss', 'sa 240 gr.321', 'sa 240 321', '1.4541'], 420],
  [['ss 316l', 'ss316l', '316l', '316 l', 'sa 240 gr.316l', 'sa 240 316l', '1.4404', 'aisi 316l'], 375],
  [['ss 316ti', '316ti', '1.4571'], 410],
  [['ss 316', 'ss316', '316 ss', 'sa 240 gr.316', 'sa 240 316', 'aisi 316', '1.4401'], 390],
  [['ss 304l', 'ss304l', '304l', '304 l', 'sa 240 gr.304l', 'sa 240 304l', '1.4307', 'aisi 304l'], 295],
  [['ss 304', 'ss304', '304 ss', 'sa 240 gr.304', 'sa 240 304', 'aisi 304', '1.4301'], 310],
  [['ss 310', 'ss310', '310 ss', '1.4845'], 480],
  [['stainless steel', 'stainless'], 310],
  [['cu-ni 70/30', '70/30 cu-ni', 'cupro nickel 70/30', 'cuni 70/30'], 970],
  [['cu-ni 90/10', '90/10 cu-ni', 'cupro nickel 90/10', 'cuni 90/10', 'copper nickel'], 870],
  [['admiralty brass', 'naval brass'], 540],
  [['brass'], 520],
  [['copper'], 700],
  [['alloy 20', 'carpenter 20', 'uns n08020'], 850],
  [['p91', '9cr-1mo', '9cr 1mo', 'sa 335 p91', 'sa335p91', 'sa 387 gr.91'], 350],
  [['p9', '9cr-1mo modified', 'sa 335 p9'], 260],
  [['p22', '2.25cr-1mo', '2.25cr 1mo', 'sa 335 p22', 'sa387 gr 22', 'sa 387 gr.22'], 195],
  [['p11', '1.25cr-0.5mo', '1.25cr 0.5mo', 'sa 335 p11', 'sa387 gr 11', 'sa 387 gr.11', '1.25cr'], 175],
  [['p5', '5cr-0.5mo', '5cr 0.5mo', 'sa 335 p5', 'sa 387 gr.5'], 220],
  [['alloy steel', 'sa 387', 'sa387', 'chromoly', 'chrome moly', 'cr-mo', 'cr mo', 'low alloy'], 180],
  [['sa 516 gr 60', 'sa516 gr60', 'sa516 gr.60', 'a 516 gr 60'], 90],
  [['sa 516', 'sa516', 'a516', 'a 516', 'sa516gr70', 'astm a 516'], 92],
  [['sa 285', 'sa285', 'a 285'], 88],
  [['sa 515', 'sa515'], 90],
  [['sa 106', 'sa106', 'a 106'], 95],
  [['is 2062', 'is2062', 'is:2062'], 85],
  [['astm a 36', 'a36'], 82],
  [['carbon steel', 'plain carbon', 'mild steel'], 90],
  [['steel', 'iron'], 88],
];

export function getMocRatePerKg(moc: string | null): number | null {
  if (!moc) return null;
  const norm = normForMatch(moc);
  const comp = compact(moc);
  for (const [keywords, rate] of MOC_RATE_TABLE) {
    for (const kw of keywords) {
      if (norm.includes(normForMatch(kw))) return rate;
      const kwComp = compact(kw);
      if (kwComp.length >= 4 && comp.includes(kwComp)) return rate;
    }
  }
  return null;
}

// ── Fabrication multipliers ───────────────────────────────────────────────────
const COMPONENT_FAB: Array<[string[], number]> = [
  [['tube sheet', 'tubesheet', 'tube-sheet', 'tubesheets'], 0.82],
  [['impingement plate', 'impingement rod', 'impingement'], 0.62],
  [['baffle', 'disc-donut', 'disc donut', 'support disc'], 0.52],
  [['support plate', 'support ring'], 0.50],
  [['shell cover'], 0.40],
  [['channel cover', 'bonnet cover'], 0.38],
  [['channel', 'bonnet', 'rear head', 'front head'], 0.42],
  [['shell'], 0.45],
  [['u-tube bundle', 'tube bundle', 'bundle'], 0.22],
  [['tubes', 'tube '], 0.15],
  [['expansion bellows', 'expansion bellow', 'expansion joint', 'bellow'], 0.35],
  [['nozzle', 'nozzles'], 0.42],
  [['blind flange', 'reducer flange', 'flange'], 0.22],
  [['saddle', 'skirt', 'support leg', 'legs'], 0.35],
  [['tie rod', 'tie-rod', 'spacer'], 0.18],
  [['gasket', 'spiral wound', 'ring joint'], 0.28],
  [['bolt', 'stud bolt', 'nut ', 'fastener', 'hardware'], 0.08],
  [['drain plug', 'vent plug', 'plug'], 0.30],
  [['nameplate', 'name plate', 'tag plate'], 0.05],
];

export function getFabricationMultiplier(componentName: string): number {
  const n = componentName.toLowerCase();
  for (const [keywords, mult] of COMPONENT_FAB) {
    for (const kw of keywords) {
      if (n.includes(kw)) return mult;
    }
  }
  return 0.38;
}

// ── Equipment-level complexity factors ────────────────────────────────────────
function getEquipmentFactors(eq: IEquipmentBom): { special: number; inspection: number } {
  let special = 0;
  let inspection = 0;
  if (eq.hydrogenService) special += 0.12;
  if (eq.ibrApplicable)   inspection += 0.08;
  const sr = (eq.stressRelieving ?? '').toLowerCase();
  if (sr && sr !== 'no' && sr !== 'not required' && sr !== 'n/a') inspection += 0.06;
  const rt = (eq.radiography ?? '').toLowerCase();
  if (rt.includes('100') || rt.includes('full')) inspection += 0.15;
  else if (rt.includes('spot') || rt.includes('10') || rt.includes('20')) inspection += 0.05;
  const maxTemp = Math.max(eq.designTempShellC ?? 0, eq.designTempTubeC ?? 0);
  if (maxTemp > 450) special += 0.10;
  else if (maxTemp > 300) special += 0.05;
  return { special, inspection };
}

// ── Unit-based fallbacks for weightless standard items ────────────────────────
type FallbackFn = (comp: IBomComponent, eq: IEquipmentBom) => { cost: number; basis: string } | null;

function parseQty(qty: string): number {
  if (!qty || qty.toUpperCase() === 'AR' || qty.toUpperCase() === 'N/A' || qty === '-') return 1;
  const n = parseFloat(qty);
  return isNaN(n) || n <= 0 ? 1 : n;
}

function mocLabel(moc: string | null): string {
  if (!moc) return 'CS';
  return moc.length > 18 ? moc.substring(0, 18) + '…' : moc;
}

const UNIT_FALLBACKS: Array<[string[], FallbackFn]> = [
  // Gaskets
  [['gasket', 'spiral wound', 'ring joint', 'ring gasket'], (comp, eq) => {
    const id = eq.sizeIdMm > 0 ? eq.sizeIdMm : 500;
    const base = id < 300 ? 900 : id < 600 ? 1800 : id < 900 ? 3200 : 5500;
    const mocMult = Math.min((getMocRatePerKg(comp.moc) ?? 92) / 92, 4);
    const qty = parseQty(comp.quantity);
    const cost = Math.round(base * qty * mocMult);
    return { cost, basis: `Unit est. ${qty}× ₹${Math.round(base * mocMult)} (gasket, shell ⌀${id}mm)` };
  }],
  // Bolts / studs / hardware
  [['bolt', 'stud bolt', 'stud', 'nut', 'fastener', 'hardware', 'bolting'], (comp, eq) => {
    const qty = parseQty(comp.quantity);
    const sets = qty > 4 ? qty : 24;
    const rate = getMocRatePerKg(comp.moc) ?? 92;
    const cps = rate < 120 ? 90 : rate < 250 ? 200 : rate < 450 ? 350 : rate < 900 ? 700 : 2000;
    return { cost: Math.round(sets * cps), basis: `Unit est. ${sets} sets × ₹${cps} (${mocLabel(comp.moc)} hardware)` };
  }],
  // Tie rods + spacers
  [['tie rod', 'tie-rod', 'spacer', 'tie rods'], (comp, eq) => {
    const qty = parseQty(comp.quantity);
    const pcs = qty > 1 ? qty : 4;
    const rate = getMocRatePerKg(comp.moc) ?? 92;
    const cpp = rate < 120 ? 420 : rate < 250 ? 850 : rate < 450 ? 1600 : 4000;
    return { cost: Math.round(pcs * cpp), basis: `Unit est. ${pcs} pcs × ₹${cpp} (tie rod)` };
  }],
  // Lifting / earthing lugs
  [['lifting lug', 'earthing lug', 'lug', 'lifting'], (comp, eq) => {
    const qty = parseQty(comp.quantity);
    const wt = eq.emptyWeightKg ?? 2000;
    const base = wt < 1000 ? 1500 : wt < 5000 ? 2800 : wt < 15000 ? 5000 : 8500;
    return { cost: Math.round(qty * base), basis: `Unit est. ${qty}× ₹${base} (lug, equip ${wt}kg)` };
  }],
  // Nameplates
  [['nameplate', 'name plate', 'tag plate'], (_comp, _eq) => {
    return { cost: 700, basis: 'Unit est. ₹700 (nameplate)' };
  }],
  // Drain / vent plugs
  [['drain plug', 'vent plug', 'plug', 'drain nozzle', 'vent nozzle'], (comp, eq) => {
    const qty = parseQty(comp.quantity);
    const rate = getMocRatePerKg(comp.moc) ?? 92;
    const cpp = rate < 120 ? 500 : rate < 450 ? 1100 : 2800;
    return { cost: Math.round(qty * cpp), basis: `Unit est. ${qty}× ₹${cpp} (${mocLabel(comp.moc)} plug)` };
  }],
  // Pass partition plates (no separate weight listed on datasheet)
  [['pass partition', 'partition plate', 'pass plate'], (comp, eq) => {
    const id = eq.sizeIdMm > 0 ? eq.sizeIdMm : 600;
    const sl = eq.sizeSlMm > 0 ? eq.sizeSlMm : 3000;
    const estWt = Math.round((id / 1000) * (sl / 1000) * 0.010 * 7850);
    const rate = getMocRatePerKg(comp.moc) ?? 92;
    const cost = Math.round(estWt * rate * 1.5);
    return { cost, basis: `Dim. est. ~${estWt}kg × ₹${rate}/kg + fab (partition)` };
  }],
];

// ── BOM component cost ────────────────────────────────────────────────────────
interface CompCost {
  unitCostPerKg:   number | null;
  materialCost:    number | null;
  fabricationCost: number | null;
  totalCost:       number | null;
  costBasis:       string | null;
}

function estimateComponentCost(comp: IBomComponent, eq: IEquipmentBom): CompCost {
  if (comp.applicable === 'No') {
    return { unitCostPerKg: null, materialCost: null, fabricationCost: null, totalCost: null, costBasis: 'Not applicable' };
  }

  const rate = getMocRatePerKg(comp.moc);

  // Primary: weight-based
  if (rate !== null && comp.weightKg !== null && comp.weightKg > 0) {
    const qty             = parseQty(comp.quantity);
    const materialCost    = Math.round(comp.weightKg * qty * rate);
    const fabMult         = getFabricationMultiplier(comp.component);
    const fabricationCost = Math.round(materialCost * fabMult);
    const totalCost       = materialCost + fabricationCost;
    const basis = `${comp.weightKg}kg × ₹${rate}/kg (${mocLabel(comp.moc)}) + ${Math.round(fabMult * 100)}% fab`;
    return { unitCostPerKg: rate, materialCost, fabricationCost, totalCost, costBasis: basis };
  }

  // Secondary: unit fallback for weightless standard items
  const compLower = comp.component.toLowerCase();
  for (const [keywords, fn] of UNIT_FALLBACKS) {
    if (keywords.some(kw => compLower.includes(kw))) {
      const result = fn(comp, eq);
      if (result) {
        return { unitCostPerKg: rate, materialCost: null, fabricationCost: null, totalCost: result.cost, costBasis: result.basis };
      }
    }
  }

  // Not costed — explain why
  if (rate !== null) {
    return { unitCostPerKg: rate, materialCost: null, fabricationCost: null, totalCost: null, costBasis: `No weight data (${mocLabel(comp.moc)}, ₹${rate}/kg)` };
  }
  if (comp.weightKg !== null && comp.weightKg > 0) {
    return { unitCostPerKg: null, materialCost: null, fabricationCost: null, totalCost: null, costBasis: `${comp.weightKg}kg — MOC not recognized` };
  }
  return { unitCostPerKg: null, materialCost: null, fabricationCost: null, totalCost: null, costBasis: 'No weight or MOC data' };
}

// ── Nozzle cost ───────────────────────────────────────────────────────────────
const CS_FLANGE_BASE_150: Array<[number, number]> = [
  [0.5, 500], [0.75, 620], [1, 780], [1.25, 950], [1.5, 1150],
  [2, 1500], [2.5, 2000], [3, 2700], [4, 3900], [5, 5500],
  [6, 7500], [8, 11500], [10, 17000], [12, 24000],
  [14, 33000], [16, 44000], [18, 58000], [20, 76000], [24, 115000],
];
const CLASS_MULT: Record<number, number> = {
  150: 1.0, 300: 1.7, 600: 2.9, 900: 4.4, 1500: 6.8, 2500: 11.0,
};
const PIPE_KG_PER_M_SCH40: Array<[number, number]> = [
  [0.5, 1.1], [0.75, 1.7], [1, 2.6], [1.25, 3.4], [1.5, 4.1],
  [2, 5.5], [2.5, 7.7], [3, 11.5], [4, 16.5], [5, 22.5],
  [6, 29.0], [8, 44.0], [10, 65.5], [12, 89.0],
  [14, 96.0], [16, 116.0], [18, 142.0], [20, 169.0], [24, 230.0],
];

function interpolate(table: Array<[number, number]>, x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

function parseNps(sizeStr: string): number {
  if (!sizeStr) return 0;
  const s = sizeStr.trim().toUpperCase();
  const dnMatch = s.match(/(?:DN|NB)\s*(\d+)/);
  if (dnMatch) {
    const DN_TO_NPS: Record<number, number> = {
      15: 0.5, 20: 0.75, 25: 1, 32: 1.25, 40: 1.5, 50: 2, 65: 2.5,
      80: 3, 100: 4, 125: 5, 150: 6, 200: 8, 250: 10, 300: 12,
      350: 14, 400: 16, 450: 18, 500: 20, 600: 24,
    };
    const dn = parseInt(dnMatch[1]);
    return DN_TO_NPS[dn] ?? dn / 25.4;
  }
  const numMatch = s.match(/^(\d+(?:\.\d+)?)/);
  return numMatch ? parseFloat(numMatch[1]) : 0;
}

function parseAsmeClass(classStr: string): number {
  if (!classStr) return 150;
  const n = parseInt(classStr.replace(/[^0-9]/g, ''));
  return [150, 300, 600, 900, 1500, 2500].includes(n) ? n : 150;
}

function getScheduleWtMult(schedule: string): number {
  const s = schedule.toUpperCase().replace(/[\s.]/g, '');
  if (s.includes('XXS'))  return 2.8;
  if (s.includes('SCH160')) return 2.6;
  if (s.includes('SCH120')) return 2.1;
  if (s.includes('SCH100')) return 1.9;
  if (s.includes('XS') || s.includes('SCH80')) return 1.6;
  return 1.0;
}

function nozzleAssemblyCost(nps: number): number {
  if (nps <= 2)  return 1300;
  if (nps <= 4)  return 2500;
  if (nps <= 8)  return 4500;
  if (nps <= 14) return 7500;
  return 12000;
}

interface NozzleCost { totalCost: number | null; costBasis: string | null; }

export function estimateNozzleCost(nozzle: INozzle): NozzleCost {
  const nps = parseNps(nozzle.sizeNps);
  if (nps <= 0) return { totalCost: null, costBasis: `NPS not recognized (${nozzle.sizeNps || '—'})` };

  const cls          = parseAsmeClass(nozzle.asmeClass);
  const classMult    = CLASS_MULT[cls] ?? 1.0;
  const schMult      = getScheduleWtMult(nozzle.schedule);
  const csFlangeBase = interpolate(CS_FLANGE_BASE_150, nps);
  const flangeRate   = getMocRatePerKg(nozzle.mocFlange);
  const flangeMatMult = flangeRate != null ? flangeRate / 92 : 1.0;
  const flangeCost   = Math.round(csFlangeBase * classMult * flangeMatMult);
  const pipeKgPerM   = interpolate(PIPE_KG_PER_M_SCH40, nps) * schMult;
  const neckWeightKg = pipeKgPerM * 0.25;
  const neckRate     = getMocRatePerKg(nozzle.mocNeck) ?? getMocRatePerKg(nozzle.mocFlange) ?? 92;
  const neckCost     = Math.round(neckWeightKg * neckRate * 1.45);
  const assemblyCost = nozzleAssemblyCost(nps);
  const totalCost    = flangeCost + neckCost + assemblyCost;
  const flangeDesc   = nozzle.mocFlange ? mocLabel(nozzle.mocFlange) : 'CS';
  const basis        = `${nps}" ${cls}# ${flangeDesc} flange + ${Math.round(neckWeightKg * 10) / 10}kg neck + weld`;
  return { totalCost, costBasis: basis };
}

// ── Public: apply all costs to equipment array ────────────────────────────────
export function applyEquipmentCosts(equipment: IEquipmentBom[]): IEquipmentBom[] {
  return equipment.map(eq => {
    const pricedBom = eq.bom.map(comp => {
      const c = estimateComponentCost(comp, eq);
      return { ...comp, ...c };
    });

    const pricedNozzles = eq.nozzleSchedule.map(n => {
      const c = estimateNozzleCost(n);
      return { ...n, totalCost: c.totalCost, costBasis: c.costBasis };
    });

    const totalMaterialCost    = pricedBom.reduce((s, c) => s + ((c as IBomComponent & { materialCost?: number | null }).materialCost ?? 0), 0);
    const totalFabricationCost = pricedBom.reduce((s, c) => s + ((c as IBomComponent & { fabricationCost?: number | null }).fabricationCost ?? 0), 0);
    const bomTotalCost         = pricedBom.reduce((s, c) => s + ((c as IBomComponent & { totalCost?: number | null }).totalCost ?? 0), 0);
    const totalNozzleCost      = pricedNozzles.reduce((s, n) => s + (n.totalCost ?? 0), 0);
    const base                 = bomTotalCost + totalNozzleCost;
    const factors              = getEquipmentFactors(eq);
    const specialCost          = Math.round(base * factors.special);
    const inspectionCost       = Math.round(base * factors.inspection);

    return {
      ...eq,
      bom:                  pricedBom as IBomComponent[],
      nozzleSchedule:       pricedNozzles as INozzle[],
      totalMaterialCost:    Math.round(totalMaterialCost),
      totalFabricationCost: Math.round(totalFabricationCost),
      totalNozzleCost:      Math.round(totalNozzleCost),
      specialCost,
      inspectionCost,
      totalEquipCost:       Math.round(base + specialCost + inspectionCost),
    };
  });
}
