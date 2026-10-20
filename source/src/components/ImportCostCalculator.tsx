import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Download, RotateCcw, Save, FolderOpen, Loader as Loader2, ClipboardPaste, Scale, Box, Printer } from 'lucide-react';
import ImportCostTables, { type ProductLine, type LineCalc, type ColumnLabels, DEFAULT_COLUMN_LABELS } from './ImportCostTables';
import ImportCostPrint from './ImportCostPrint';
import SavedCalculations from './SavedCalculations';
import { type BoostedSettings } from './BoostedMeanCost';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

function createEmptyLine(): ProductLine {
  return {
    id: crypto.randomUUID(),
    code: '',
    buyPrice: null,
    dutyRate: null,
    unit: '',
    qty: null,
    weight: null,
    totalWeight: null,
    cubic: null,
    marginPercent: null,
    marketPrice: null,
    sellPrice: null,

  };
}

const INITIAL_LINES = 12;

function createSampleLines(): ProductLine[] {
  const samples = [
    { code: 'Mesh 120', buyPrice: 800, qty: 5, weight: 12, cubic: null },
    { code: '20 Mesh', buyPrice: 900, qty: 3, weight: 25, cubic: null },
    { code: '50 Mesh', buyPrice: 990, qty: 3, weight: 25, cubic: null },
    { code: '100 Mesh', buyPrice: 800, qty: 3, weight: 15, cubic: null },
    { code: '5 Hole', buyPrice: 2080, qty: 2, weight: 45, cubic: null },
    { code: '8 Hole', buyPrice: 2380, qty: 2, weight: 53, cubic: null },
  ];
  const lines: ProductLine[] = samples.map((s) => ({
    id: crypto.randomUUID(),
    code: s.code,
    buyPrice: s.buyPrice,
    dutyRate: null,
    unit: '',
    qty: s.qty,
    weight: s.weight,
    totalWeight: s.weight * s.qty,
    cubic: s.cubic,
    marginPercent: null,
    marketPrice: null,
    sellPrice: null,

  }));
  const padCount = Math.max(0, INITIAL_LINES - lines.length);
  return [...lines, ...Array.from({ length: padCount }, createEmptyLine)];
}

export default function ImportCostCalculator() {
  const { user } = useAuth();
  const [buyCurrency, setBuyCurrency] = useState('CNY');
  const [localCurrency] = useState('LKR');
  const [exchangeRate, setExchangeRate] = useState<number | null>(45);
  const [seafreight, setSeafreight] = useState<number | null>(60000);
  const [totalImportCost, setTotalImportCost] = useState<number | null>(198000);
  const [importTaxPercent, setImportTaxPercent] = useState<number | null>(null);
  const [lines, setLines] = useState<ProductLine[]>(createSampleLines);

  const [customerName, setCustomerName] = useState('');
  const [reference, setReference] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const [columnLabels, setColumnLabels] = useState<ColumnLabels>(DEFAULT_COLUMN_LABELS);
  const [boostedSettings, setBoostedSettings] = useState<BoostedSettings>({
    customsDutyLKR: null,
    otherChargesLKR: null,
    oceanFreightUSD: null,
    usdToLkrRate: null,
    cnyToLkrRate: null,
  });
  const [allocMode, setAllocMode] = useState<'kg' | 'cbm' | null>(null);
  const [showAllocModal, setShowAllocModal] = useState(false);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [pasteData, setPasteData] = useState('');
  const [showPrint, setShowPrint] = useState(false);
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    async function loadSettings() {
      const { data } = await supabase
        .from('import_settings')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        // a saved CNY rate pre-fills the Exchange Rate box (the box is what the calculation uses)
        if (Number(data.cny_to_lkr_rate) > 0) setExchangeRate(Number(data.cny_to_lkr_rate));
        setBoostedSettings({
          customsDutyLKR: data.customs_duty_lkr,
          otherChargesLKR: data.other_charges_lkr,
          oceanFreightUSD: data.ocean_freight_usd,
          usdToLkrRate: data.usd_to_lkr_rate,
          cnyToLkrRate: data.cny_to_lkr_rate,
        });
      }
    }
    loadSettings();
  }, []);

  const updateColumnLabel = useCallback((key: keyof ColumnLabels, value: string) => {
    setColumnLabels((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handlePasteData = useCallback(() => {
    if (!pasteData.trim()) return;

    const rows = pasteData.trim().split('\n');
    const parsedLines: ProductLine[] = [];

    for (const row of rows) {
      const cols = row.split('\t');
      if (cols.length === 0 || (cols.length === 1 && !cols[0].trim())) continue;

      const code = cols[0]?.trim() || '';
      const buyPrice = cols[1] ? parseFloat(cols[1].replace(/,/g, '')) || null : null;
      const qty = cols[2] ? parseInt(cols[2].replace(/,/g, ''), 10) || null : null;
      const weight = cols[3] ? parseFloat(cols[3].replace(/,/g, '')) || null : null;
      const cubic = cols[4] ? parseFloat(cols[4].replace(/,/g, '')) || null : null;

      if (code || buyPrice || qty) {
        parsedLines.push({
          id: crypto.randomUUID(),
          code,
          buyPrice,
          dutyRate: null,
          unit: '',
          qty,
          weight,
          totalWeight: weight && qty ? weight * qty : null,
          cubic,
          marginPercent: null,
          marketPrice: null,
          sellPrice: null,
      
        });
      }
    }

    if (parsedLines.length > 0) {
      const padCount = Math.max(0, INITIAL_LINES - parsedLines.length);
      setLines([...parsedLines, ...Array.from({ length: padCount }, createEmptyLine)]);
    }

    setShowPasteArea(false);
    setPasteData('');
  }, [pasteData]);

  const handlePasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPasteData(text);
      setTimeout(() => {
        if (pasteRef.current) {
          pasteRef.current.focus();
        }
      }, 100);
    } catch {
      setShowPasteArea(true);
      setTimeout(() => {
        if (pasteRef.current) {
          pasteRef.current.focus();
        }
      }, 100);
    }
  }, []);

  // the Exchange Rate box (before: a rate saved in settings silently overrode what was typed here)
  const rate = exchangeRate ?? 0;
  const sfVal = seafreight ?? 0;
  const ticVal = totalImportCost ?? 0;

  const updateLine = useCallback(
    (id: string, field: keyof ProductLine, value: string | number | null) => {
      setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
    },
    []
  );

  const removeLine = useCallback((id: string) => {
    setLines((prev) => {
      const filtered = prev.filter((l) => l.id !== id);
      return filtered.length === 0 ? [createEmptyLine()] : filtered;
    });
  }, []);

  const addLine = useCallback(() => setLines((prev) => [...prev, createEmptyLine()]), []);

  const resetAll = useCallback(() => {
    setBuyCurrency('CNY');
    setExchangeRate(45);
    setSeafreight(null);
    setTotalImportCost(null);
    setImportTaxPercent(null);
    setLines(Array.from({ length: INITIAL_LINES }, createEmptyLine));
    setCustomerName('');
    setReference('');
    setLoadedId(null);
    setSaveMsg('');
    setBoostedSettings({
      customsDutyLKR: null,
      otherChargesLKR: null,
      oceanFreightUSD: null,
      usdToLkrRate: null,
      cnyToLkrRate: null,
    });
    setAllocMode(null);
    setShowAllocModal(true);
  }, []);

  const totalProductLocal = useMemo(
    () => lines.reduce((s, l) => s + (l.buyPrice ?? 0) * rate * (l.qty ?? 0), 0),
    [lines, rate]
  );

  const grandTotalWeight = useMemo(
    () => lines.reduce((s, l) => s + (l.weight ?? 0) * (l.qty ?? 0), 0),
    [lines]
  );

  // Cubic = the item's TOTAL CBM (the whole row), not per piece
  const grandTotalCbm = useMemo(
    () => lines.reduce((s, l) => s + (l.cubic ?? 0), 0),
    [lines]
  );

  const calcs: LineCalc[] = useMemo(
    () =>
      lines.map((l) => {
        const bp = l.buyPrice ?? 0;
        const q = l.qty ?? 0;
        const w = l.weight ?? 0;
        const cbm = l.cubic ?? 0;

        const bpLocal = bp * rate;

        let dutyCostPerUnit = 0;

        const totalExtraCosts = sfVal + ticVal;
        if (allocMode === 'cbm') {
          if (grandTotalCbm > 0) {
            // item's share = cost per CBM x its total CBM, then / its qty = per piece
            const cbmAllocation = (totalExtraCosts / grandTotalCbm) * cbm;
            dutyCostPerUnit = q > 0 ? cbmAllocation / q : 0;
          }
        } else {
          if (grandTotalWeight > 0) {
            const costPerKg = totalExtraCosts / grandTotalWeight;
            dutyCostPerUnit = costPerKg * w;
          }
        }

        // Duty Rate (%) per line: duty on the item's buy price in LKR (before: typed but never counted)
        const dutyPerUnit = bpLocal * ((l.dutyRate ?? 0) / 100);
        const landed = bpLocal + dutyCostPerUnit + dutyPerUnit;

        let sell: number;
        let margin: number;
        const hasSellInput = (l.sellPrice !== null && l.sellPrice > 0) || (l.marginPercent !== null && l.marginPercent > 0);

        if (l.sellPrice !== null && l.sellPrice > 0) {
          sell = l.sellPrice;
          margin = sell - landed;
        } else {
          const mp = l.marginPercent ?? 0;
          margin = landed * (mp / 100);
          sell = landed + margin;
        }

        let suggestedMarginPercent = 0;
        if (landed > 0) {
          if (landed < 1000) suggestedMarginPercent = 40;
          else if (landed < 5000) suggestedMarginPercent = 35;
          else if (landed < 20000) suggestedMarginPercent = 30;
          else if (landed < 50000) suggestedMarginPercent = 25;
          else suggestedMarginPercent = 20;
        }
        const suggestedSellPerUnit = landed * (1 + suggestedMarginPercent / 100);

        const mktPrice = l.marketPrice ?? 0;
        const maxMarginPercent = landed > 0 && mktPrice > 0
          ? ((mktPrice - landed) / landed) * 100
          : 0;

        const totalAlloc = dutyCostPerUnit * q;

        return {
          buyPriceLocal: bpLocal,
          extraCosts: dutyCostPerUnit,
          dutyAmount: dutyPerUnit,
          totalAlloc,
          landedCostEx: landed,
          importCostPerUnit: 0,
          landedTotal: landed * q,
          importCostTotal: (dutyCostPerUnit + dutyPerUnit) * q,
          margin,
          sellPerUnit: sell,
          sellTotal: hasSellInput ? sell * q : 0,
          profitPerUnit: hasSellInput ? margin : 0,
          profitTotal: hasSellInput ? margin * q : 0,
          suggestedMarginPercent,
          suggestedSellPerUnit,
          maxMarginPercent,
        };
      }),
    [lines, rate, sfVal, ticVal, grandTotalWeight, grandTotalCbm, allocMode]
  );

  const totals = useMemo(() => ({
    extraCosts: sfVal + ticVal,
    totalLanded: calcs.reduce((s, c) => s + c.landedTotal, 0),
    importCost: calcs.reduce((s, c) => s + c.importCostTotal, 0),
    sell: calcs.reduce((s, c) => s + c.sellTotal, 0),
    profit: calcs.reduce((s, c) => s + c.profitTotal, 0),
  }), [calcs, sfVal, ticVal]);

  const fmt = (v: number) =>
    v === 0
      ? '-'
      : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtLKR = (v: number) =>
    `LKR ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function handleSave() {
    if (!user) return;
    if (!customerName.trim()) {
      setSaveMsg('Enter a customer name first');
      setTimeout(() => setSaveMsg(''), 3000);
      return;
    }

    setSaving(true);
    setSaveMsg('');

    const activeLines = lines.filter(
      (l) => l.code.trim() !== '' || (l.buyPrice ?? 0) > 0
    );
    const payload = {
      user_id: user.id,
      customer_name: customerName.trim(),
      reference: reference.trim(),
      config: { buyCurrency, localCurrency, exchangeRate, seafreight, totalImportCost, importTaxPercent, boostedSettings, allocMode },
      lines: activeLines.length > 0 ? activeLines : lines,
      total_landed: totals.totalLanded,
      total_sell: totals.sell,
      total_profit: totals.profit,
    };

    let error;
    if (loadedId) {
      ({ error } = await supabase
        .from('import_calculations')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', loadedId));
    } else {
      ({ error } = await supabase.from('import_calculations').insert(payload));
    }

    setSaving(false);
    if (error) {
      setSaveMsg('Failed to save');
      alert('Could not save the calculation: ' + error.message + (/import_calculations|schema cache|does not exist/i.test(error.message) ? '\n\nThe calculator tables are missing — run import-calculator-setup.sql in Supabase (MAIN project) once.' : ''));
    } else {
      setSaveMsg(loadedId ? 'Updated' : 'Saved');
    }
    setTimeout(() => setSaveMsg(''), 3000);
  }

  function handleLoad(calc: {
    id: string;
    customer_name: string;
    reference: string;
    config: Record<string, unknown>;
    lines: Record<string, unknown>[];
  }) {
    // older saves can have no config / no lines at all — open them as a blank sheet instead of failing silently
    const cfg = (calc.config || {}) as {
      buyCurrency?: string;
      exchangeRate?: number | null;
      seafreight?: number | null;
      totalImportCost?: number | null;
      importTax?: number | null;
      importTaxPercent?: number | null;
      boostedSettings?: BoostedSettings;
      allocMode?: 'kg' | 'cbm';
    };
    setBuyCurrency(cfg.buyCurrency ?? 'CNY');
    setExchangeRate(cfg.exchangeRate ?? 45);
    setSeafreight(cfg.seafreight ?? null);
    setTotalImportCost(cfg.totalImportCost ?? cfg.importTax ?? null);
    setImportTaxPercent(cfg.importTaxPercent ?? null);
    if (cfg.boostedSettings) {
      setBoostedSettings(cfg.boostedSettings);
    }
    setAllocMode(cfg.allocMode ?? 'kg');
    setShowAllocModal(false);
    setCustomerName(calc.customer_name);
    setReference(calc.reference);
    setLoadedId(calc.id);

    const loadedLines = ((Array.isArray(calc.lines) ? calc.lines : []) as unknown as ProductLine[]).map((l) => ({
      ...l,
      id: crypto.randomUUID(),
      cubic: l.cubic ?? null,
      marketPrice: l.marketPrice ?? null,
      sellPrice: l.sellPrice ?? null,

    }));
    const padCount = Math.max(0, INITIAL_LINES - loadedLines.length);
    setLines([...loadedLines, ...Array.from({ length: padCount }, createEmptyLine)]);
    setShowSaved(false);
    setSaveMsg(loadedLines.length ? 'Loaded' : 'Loaded — this file was saved with no items');
    setTimeout(() => setSaveMsg(''), 3000);
  }

  function handleExport() {
    const activeLines = lines.filter(
      (l) => l.code.trim() !== '' || (l.buyPrice ?? 0) > 0
    );

    const header = [
      'Code/Desc',
      'Duty Rate (%)',
      'Unit',
      `Buy Price (${buyCurrency})`,
      'Qty',
      'Weight (Kg)',
      'Weight Total',
      'Cubic (M3)',
      'Cubic Total',
      'Buy Price (LKR)',
      'Extra Costs',
      'Duty',
      'Import Cost',
      'Landed Cost (Ex)',
      'Landed Total',
      'Margin %',
      'Sell/Unit',
      'Sell Total',
      'Profit Total',
    ];

    const rows = activeLines.map((l) => {
      const c = calcs[lines.indexOf(l)];
      const weightTotal = (l.weight ?? 0) * (l.qty ?? 0);
      const cubicTotal = l.cubic ?? 0;
      return [
        l.code,
        l.dutyRate ?? '',
        l.unit,
        l.buyPrice ?? '',
        l.qty ?? '',
        l.weight ?? '',
        weightTotal,
        l.cubic ?? '',
        cubicTotal,
        c.buyPriceLocal.toFixed(2),
        c.extraCosts.toFixed(2),
        c.dutyAmount.toFixed(2),
        c.importCostPerUnit.toFixed(2),
        c.landedCostEx.toFixed(2),
        c.landedTotal.toFixed(2),
        l.marginPercent ?? '',
        c.sellPerUnit.toFixed(2),
        c.sellTotal.toFixed(2),
        c.profitTotal.toFixed(2),
      ];
    });

    const config = [
      ['Import Cost Calculator'],
      [`Customer: ${customerName}`, `Ref: ${reference}`],
      [],
      ['Buy Currency', buyCurrency, '', 'Local Currency', 'LKR'],
      ['Exchange Rate', rate, '', 'Seafreight (LKR)', sfVal.toFixed(2)],
      ['Total Import Costs (LKR)', ticVal.toFixed(2), '', 'Total Extra Costs (LKR)', totals.extraCosts.toFixed(2)],
      ['Import Tax %', importTaxPercent ?? ''],
      [],
    ];

    const csvContent = [...config, header, ...rows]
      .map((row) => row.map((v) => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-cost-${customerName.trim() || 'calc'}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cfgInputCls =
    'w-full px-3 py-1.5 bg-teal-50 border border-blue-200 rounded text-center font-medium text-teal-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Import Cost Calculator</h2>
          <p className="text-sm text-gray-500 mt-1">
            All values in LKR &middot; Calculate landed costs, margins, and profit
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {saveMsg && (
            <span
              className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                saveMsg === 'Failed to save' || saveMsg === 'Enter a customer name first'
                  ? 'bg-red-100 text-red-700'
                  : 'bg-teal-100 text-teal-700'
              }`}
            >
              {saveMsg}
            </span>
          )}
          <button
            onClick={() => setShowSaved(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            Load Saved
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {loadedId ? 'Update' : 'Save'}
          </button>
          <button
            onClick={resetAll}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            New
          </button>
          <button
            onClick={() => {
              setShowPasteArea(true);
              handlePasteFromClipboard();
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
          >
            <ClipboardPaste className="w-4 h-4" />
            Paste
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            CSV
          </button>
          <button
            onClick={() => setShowPrint(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>
      </div>

      {showPasteArea && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-bold text-amber-900">Paste Spreadsheet Data</h3>
              <p className="text-xs text-amber-700 mt-0.5">
                Copy rows from Excel/Sheets with columns: Code, Buy Price, Qty, Weight per unit (kg), Total CBM of the item (M3)
              </p>
            </div>
            <button
              onClick={() => {
                setShowPasteArea(false);
                setPasteData('');
              }}
              className="text-amber-600 hover:text-amber-800 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
          <textarea
            ref={pasteRef}
            value={pasteData}
            onChange={(e) => setPasteData(e.target.value)}
            placeholder="Paste your spreadsheet data here (Ctrl+V / Cmd+V)&#10;&#10;Example:&#10;Product A&#9;800&#9;5&#9;12&#9;0.2&#10;Product B&#9;900&#9;3&#9;25&#9;"
            className="w-full h-40 px-3 py-2 border border-amber-300 rounded-lg text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 resize-none"
          />
          <div className="flex items-center justify-between mt-3">
            <div className="text-xs text-amber-600">
              {pasteData.trim().split('\n').filter(r => r.trim()).length} rows detected
            </div>
            <button
              onClick={handlePasteData}
              disabled={!pasteData.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Import Data
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
              Customer Name
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Enter customer name..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
              Reference / Description
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional reference..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-2.5 font-semibold text-gray-800 bg-gray-50 w-36">
                  Buy Currency
                  <div className="text-[10px] font-normal text-teal-600">Supplier's Sell Currency</div>
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="text"
                    value={buyCurrency}
                    onChange={(e) => setBuyCurrency(e.target.value.toUpperCase())}
                    className={cfgInputCls}
                  />
                </td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-2.5 font-semibold text-gray-800 bg-gray-50">
                  Local Currency
                  <div className="text-[10px] font-normal text-teal-600">Your Local Currency</div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="px-3 py-1.5 bg-gray-100 border border-gray-200 rounded text-center font-bold text-gray-800">
                    LKR
                  </div>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-gray-800 bg-gray-50">
                  Exchange Rate
                </td>
                <td className="px-4 py-2.5">
                  <input
                    type="number"
                    value={exchangeRate ?? ''}
                    onChange={(e) =>
                      setExchangeRate(e.target.value ? Number(e.target.value) : null)
                    }
                    placeholder="0"
                    className={cfgInputCls}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-2.5 font-semibold text-gray-800 bg-gray-50 w-44">
                  Seafreight
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={seafreight ?? ''}
                      onChange={(e) =>
                        setSeafreight(e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="0.00"
                      className="w-full px-3 py-1.5 bg-teal-50 border border-blue-200 rounded text-right font-medium text-teal-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <span className="text-xs text-gray-500 font-medium">LKR</span>
                  </div>
                </td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-2.5 font-semibold text-gray-800 bg-gray-50">
                  Total Import Costs
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={totalImportCost ?? ''}
                      onChange={(e) =>
                        setTotalImportCost(e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="0.00"
                      className="w-full px-3 py-1.5 bg-teal-50 border border-blue-200 rounded text-right font-medium text-teal-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <span className="text-xs text-gray-500 font-medium">LKR</span>
                  </div>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-gray-800 bg-gray-50">
                  Total Extra Costs
                </td>
                <td className="px-4 py-2.5">
                  <div className="px-3 py-1.5 bg-amber-50 border border-amber-200 rounded text-right font-bold text-amber-800">
                    {fmtLKR(totals.extraCosts)}
                  </div>
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-gray-800 bg-gray-50">
                  Allocating By
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-between">
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                      allocMode === 'cbm'
                        ? 'bg-sky-100 text-sky-700 border border-sky-300'
                        : 'bg-teal-100 text-teal-700 border border-teal-300'
                    }`}>
                      {allocMode === 'cbm'
                        ? <><Box className="w-3 h-3" /> CBM (Cubic)</>
                        : <><Scale className="w-3 h-3" /> KG (Weight)</>
                      }
                    </div>
                    <button
                      onClick={() => setShowAllocModal(true)}
                      className="text-xs text-gray-400 hover:text-gray-600 underline transition-colors"
                    >
                      Change
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex items-start">
          <table className="w-full text-sm">
            <tbody>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-gray-800 bg-gray-50 w-28">
                  Import Tax
                  <div className="text-[10px] font-normal text-gray-500">Note only — not added to costs</div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={importTaxPercent ?? ''}
                      onChange={(e) =>
                        setImportTaxPercent(e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="0"
                      className="w-full px-3 py-1.5 bg-slate-100 border border-slate-300 rounded text-center font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    />
                    <span className="text-sm font-bold text-gray-600">%</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <ImportCostTables
        lines={lines}
        calcs={calcs}
        buyCurrency={buyCurrency}
        localCurrency={localCurrency}
        onUpdate={updateLine}
        onRemove={removeLine}
        onAdd={addLine}
        fmt={fmt}
        totals={totals}
        columnLabels={columnLabels}
        onColumnLabelChange={updateColumnLabel}
        allocMode={allocMode ?? 'kg'}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
            Product Cost
          </div>
          <div className="text-lg font-bold text-gray-900">{fmtLKR(totalProductLocal)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Before freight & duty</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
            Total Landed
          </div>
          <div className="text-lg font-bold text-amber-700">{fmtLKR(totals.totalLanded)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Inc. freight + duty</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
            Total Sell Value
          </div>
          <div className="text-lg font-bold text-emerald-700">{fmtLKR(totals.sell)}</div>
          <div className="text-xs text-gray-500 mt-0.5">Ex Tax</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
            Total Profit
          </div>
          <div className="text-lg font-bold text-emerald-700">{fmtLKR(totals.profit)}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {totals.sell > 0
              ? `${((totals.profit / totals.sell) * 100).toFixed(1)}% of sell`
              : '-'}
          </div>
        </div>
      </div>

      {showSaved && (
        <SavedCalculations onLoad={handleLoad} onClose={() => setShowSaved(false)} />
      )}

      {showAllocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 pt-6 pb-4 bg-slate-700 text-center">
              <h2 className="text-lg font-bold text-white">New Calculation</h2>
              <p className="text-sm text-slate-300 mt-1">
                How should import costs be allocated across products?
              </p>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <button
                onClick={() => { setAllocMode('kg'); setShowAllocModal(false); }}
                className="group flex flex-col items-center gap-3 p-5 border-2 border-gray-200 rounded-xl hover:border-teal-400 hover:bg-teal-50 transition-all"
              >
                <div className="w-12 h-12 rounded-full bg-teal-100 group-hover:bg-teal-200 flex items-center justify-center transition-colors">
                  <Scale className="w-6 h-6 text-teal-700" />
                </div>
                <div className="text-center">
                  <div className="font-bold text-gray-900 text-sm">By Weight</div>
                  <div className="text-xs text-teal-600 font-semibold mt-0.5">KG</div>
                  <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                    Spread costs by<br />weight × qty per row
                  </div>
                </div>
              </button>
              <button
                onClick={() => { setAllocMode('cbm'); setShowAllocModal(false); }}
                className="group flex flex-col items-center gap-3 p-5 border-2 border-gray-200 rounded-xl hover:border-sky-400 hover:bg-sky-50 transition-all"
              >
                <div className="w-12 h-12 rounded-full bg-sky-100 group-hover:bg-sky-200 flex items-center justify-center transition-colors">
                  <Box className="w-6 h-6 text-sky-700" />
                </div>
                <div className="text-center">
                  <div className="font-bold text-gray-900 text-sm">By Cubic</div>
                  <div className="text-xs text-sky-600 font-semibold mt-0.5">CBM</div>
                  <div className="text-xs text-gray-500 mt-1 leading-relaxed">
                    Spread costs by<br />each item's total CBM
                  </div>
                </div>
              </button>
            </div>
            <div className="px-6 pb-5 text-center text-xs text-gray-400">
              You can change this at any time during the calculation
            </div>
          </div>
        </div>
      )}

      {showPrint && (
        <ImportCostPrint
          show={showPrint}
          onClose={() => setShowPrint(false)}
          lines={lines}
          calcs={calcs}
          buyCurrency={buyCurrency}
          exchangeRate={rate}
          seafreight={sfVal}
          totalImportCost={ticVal}
          importTaxPercent={importTaxPercent}
          allocMode={allocMode ?? 'kg'}
          customerName={customerName}
          reference={reference}
          totals={totals}
        />
      )}
    </div>
  );
}
