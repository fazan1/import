import { useMemo } from 'react';

export type CostMode = 'NO' | 'CAPPED' | 'BOOSTED';

export interface BoostedLineData {
  id: string;
  code: string;
  cbm: number;
  landedCostLKR: number;
  mode: CostMode;
  cappedValue: number | null;
  boostedValue: number | null;
}

export interface BoostedSettings {
  customsDutyLKR: number | null;
  otherChargesLKR: number | null;
  oceanFreightUSD: number | null;
  usdToLkrRate: number | null;
  cnyToLkrRate: number | null;
}

interface BoostedSummary {
  oceanFreightLKR: number;
  totalLandedCostLKR: number;
  totalCappedPoolLKR: number;
  totalBoostedPoolLKR: number;
  freePoolLKR: number;
  totalNoCBM: number;
}

interface Props {
  settings: BoostedSettings;
  onSettingsChange: (settings: BoostedSettings) => void;
  lines: BoostedLineData[];
}

function computeSummary(settings: BoostedSettings, lines: BoostedLineData[]): BoostedSummary {
  const usdRate = settings.usdToLkrRate ?? 0;
  const oceanFreightLKR = (settings.oceanFreightUSD ?? 0) * usdRate;

  const totalLandedCostLKR =
    (settings.customsDutyLKR ?? 0) +
    (settings.otherChargesLKR ?? 0) +
    oceanFreightLKR;

  const totalCappedPoolLKR = lines
    .filter((l) => l.mode === 'CAPPED' && l.cappedValue !== null)
    .reduce((sum, l) => sum + (l.cappedValue ?? 0), 0);

  const totalBoostedPoolLKR = lines
    .filter((l) => l.mode === 'BOOSTED' && l.boostedValue !== null)
    .reduce((sum, l) => sum + (l.boostedValue ?? 0), 0);

  const freePoolLKR = Math.max(0, totalLandedCostLKR - totalCappedPoolLKR - totalBoostedPoolLKR);

  const totalNoCBM = lines
    .filter((l) => l.mode === 'NO')
    .reduce((sum, l) => sum + l.cbm, 0);

  return {
    oceanFreightLKR,
    totalLandedCostLKR,
    totalCappedPoolLKR,
    totalBoostedPoolLKR,
    freePoolLKR,
    totalNoCBM,
  };
}

const fmtNum = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

const fmtCbm = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

export default function BoostedMeanCost({ settings, onSettingsChange, lines }: Props) {
  const summary = useMemo(() => computeSummary(settings, lines), [settings, lines]);

  const update = (field: keyof BoostedSettings, value: string) => {
    onSettingsChange({
      ...settings,
      [field]: value === '' ? null : Number(value),
    });
  };

  const yellowInputCls =
    'w-full px-3 py-2 text-right font-bold text-gray-900 bg-yellow-300 border-0 focus:outline-none focus:ring-2 focus:ring-yellow-500';
  const readonlyCls = 'px-3 py-2 text-right font-semibold';

  return (
    <div className="bg-white border border-gray-300 overflow-hidden shadow-sm">
      <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-5 py-3">
        <h3 className="text-sm font-bold text-white uppercase tracking-widest text-center">
          Settings — Update yellow cells
        </h3>
      </div>

      <div className="divide-y divide-gray-200">
        <div className="bg-slate-600 px-4 py-1.5">
          <span className="text-xs font-bold text-white uppercase tracking-wider">Exchange Rates</span>
        </div>

        <div className="grid grid-cols-[1fr_160px_1fr] items-center border-b border-gray-200">
          <div className="px-4 py-2 bg-gray-50 border-r border-gray-200">
            <span className="text-sm font-medium text-gray-700">USD &rarr; LKR Rate</span>
          </div>
          <div className="bg-yellow-300">
            <input
              type="number"
              value={settings.usdToLkrRate ?? ''}
              onChange={(e) => update('usdToLkrRate', e.target.value)}
              placeholder="0.00"
              step="0.01"
              className={yellowInputCls}
            />
          </div>
          <div className="px-4 py-2">
            <span className="text-xs text-gray-500 italic">&larr; Update this</span>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_160px_1fr] items-center border-b border-gray-200">
          <div className="px-4 py-2 bg-gray-50 border-r border-gray-200">
            <span className="text-sm font-medium text-gray-700">CNY &rarr; LKR Rate</span>
          </div>
          <div className="bg-yellow-300">
            <input
              type="number"
              value={settings.cnyToLkrRate ?? ''}
              onChange={(e) => update('cnyToLkrRate', e.target.value)}
              placeholder="0.00"
              step="0.01"
              className={yellowInputCls}
            />
          </div>
          <div className="px-4 py-2">
            <span className="text-xs text-gray-500 italic">&larr; Update this</span>
          </div>
        </div>

        <div className="bg-slate-600 px-4 py-1.5">
          <span className="text-xs font-bold text-white uppercase tracking-wider">Shipment Charges</span>
        </div>

        <div className="grid grid-cols-[1fr_160px_1fr] items-center border-b border-gray-200">
          <div className="px-4 py-2 bg-gray-50 border-r border-gray-200">
            <span className="text-sm font-medium text-gray-700">Customs Duty (LKR)</span>
          </div>
          <div className="bg-yellow-300">
            <input
              type="number"
              value={settings.customsDutyLKR ?? ''}
              onChange={(e) => update('customsDutyLKR', e.target.value)}
              placeholder="0"
              className={yellowInputCls}
            />
          </div>
          <div className="px-4 py-2" />
        </div>

        <div className="grid grid-cols-[1fr_160px_1fr] items-center border-b border-gray-200">
          <div className="px-4 py-2 bg-gray-50 border-r border-gray-200">
            <span className="text-sm font-medium text-gray-700">Other Charges (LKR)</span>
          </div>
          <div className="bg-yellow-300">
            <input
              type="number"
              value={settings.otherChargesLKR ?? ''}
              onChange={(e) => update('otherChargesLKR', e.target.value)}
              placeholder="0"
              className={yellowInputCls}
            />
          </div>
          <div className="px-4 py-2" />
        </div>

        <div className="grid grid-cols-[1fr_160px_1fr] items-center border-b border-gray-200">
          <div className="px-4 py-2 bg-gray-50 border-r border-gray-200">
            <span className="text-sm font-medium text-gray-700">Ocean Freight (USD)</span>
          </div>
          <div className="bg-yellow-300">
            <input
              type="number"
              value={settings.oceanFreightUSD ?? ''}
              onChange={(e) => update('oceanFreightUSD', e.target.value)}
              placeholder="0"
              className={yellowInputCls}
            />
          </div>
          <div className="px-4 py-2" />
        </div>

        <div className="grid grid-cols-[1fr_160px_1fr] items-center border-b border-gray-200">
          <div className="px-4 py-2 bg-gray-50 border-r border-gray-200">
            <span className="text-sm font-medium text-gray-700">Ocean Freight (LKR)</span>
          </div>
          <div className={`${readonlyCls} bg-white text-gray-700 border-r border-gray-200`}>
            {fmtNum(summary.oceanFreightLKR)}
          </div>
          <div className="px-4 py-2">
            <span className="text-xs text-gray-400 italic">Auto calculated</span>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_160px_1fr] items-center border-b border-gray-200 bg-gray-100">
          <div className="px-4 py-2.5 border-r border-gray-200">
            <span className="text-sm font-bold text-gray-900 uppercase">Total Landed (LKR)</span>
          </div>
          <div className={`${readonlyCls} bg-gray-100 text-gray-900 font-bold border-r border-gray-200`}>
            {fmtNum(summary.totalLandedCostLKR)}
          </div>
          <div className="px-4 py-2">
            <span className="text-xs text-gray-400 italic">Auto calculated</span>
          </div>
        </div>

        <div className="bg-slate-600 px-4 py-1.5">
          <span className="text-xs font-bold text-white uppercase tracking-wider">Cost Pool Summary (auto — do not edit)</span>
        </div>

        <div className="grid grid-cols-[1fr_160px_1fr] items-center border-b border-gray-200 bg-red-50">
          <div className="px-4 py-2 border-r border-red-200">
            <span className="text-sm font-semibold text-red-800">Total CAPPED Pool (LKR)</span>
          </div>
          <div className={`${readonlyCls} bg-red-50 text-red-900 font-bold border-r border-red-200`}>
            {fmtNum(summary.totalCappedPoolLKR)}
          </div>
          <div className="px-4 py-2 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
            <span className="text-xs text-red-700">Cost locked for capped items</span>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_160px_1fr] items-center border-b border-gray-200 bg-teal-50">
          <div className="px-4 py-2 border-r border-blue-200">
            <span className="text-sm font-semibold text-teal-800">Total BOOSTED Pool (LKR)</span>
          </div>
          <div className={`${readonlyCls} bg-teal-50 text-blue-900 font-bold border-r border-blue-200`}>
            {fmtNum(summary.totalBoostedPoolLKR)}
          </div>
          <div className="px-4 py-2 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-500 flex-shrink-0" />
            <span className="text-xs text-teal-700">Extra cost added to boosted items</span>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_160px_1fr] items-center border-b border-gray-200 bg-green-50">
          <div className="px-4 py-2 border-r border-green-200">
            <span className="text-sm font-semibold text-green-800">FREE Pool for auto split (LKR)</span>
          </div>
          <div className={`${readonlyCls} bg-green-50 text-green-900 font-bold border-r border-green-200`}>
            {fmtNum(summary.freePoolLKR)}
          </div>
          <div className="px-4 py-2 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
            <span className="text-xs text-green-700">Split by CBM among NO items</span>
          </div>
        </div>

        <div className="grid grid-cols-[1fr_160px_1fr] items-center bg-gray-50">
          <div className="px-4 py-2 border-r border-gray-200">
            <span className="text-sm font-medium text-gray-700">Total CBM of NO items</span>
          </div>
          <div className={`${readonlyCls} bg-gray-50 text-gray-700 font-semibold border-r border-gray-200`}>
            {fmtCbm(summary.totalNoCBM)}
          </div>
          <div className="px-4 py-2">
            <span className="text-xs text-gray-500">Used to split free pool</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export { computeSummary };
export type { BoostedSummary };
