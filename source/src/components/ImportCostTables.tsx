import { useState } from 'react';
import { Trash2, Plus, TrendingUp, TrendingDown, Minus, Pencil, Check, X } from 'lucide-react';

export interface ColumnLabels {
  code: string;
  dutyRate: string;
  unit: string;
  buyPrice: string;
  qty: string;
  weight: string;
  weightTotal: string;
  cubic: string;
  cubicTotal: string;
  buyLocal: string;
  dutyCost: string;
  totalAlloc: string;
  landedEx: string;
  landedTotal: string;
  marginPercent: string;
  sellPerUnit: string;
  suggested: string;
  sellTotal: string;
  profitTotal: string;
}

export const DEFAULT_COLUMN_LABELS: ColumnLabels = {
  code: 'Code / Desc.',
  dutyRate: 'Duty Rate (%)',
  unit: 'Unit',
  buyPrice: 'Buy Price',
  qty: 'Qty',
  weight: 'Weight (Kg)',
  weightTotal: 'Weight Total',
  cubic: 'Total CBM (item)',
  cubicTotal: 'Cubic Total',
  buyLocal: 'Buy',
  dutyCost: 'Ship Cost/Unit',
  totalAlloc: 'Total Alloc',
  landedEx: 'Landed (Ex)',
  landedTotal: 'Landed Total',
  marginPercent: '%',
  sellPerUnit: 'Sell / Unit',
  suggested: 'Suggested',
  sellTotal: 'Sell Total',
  profitTotal: 'Profit Total',
};

export interface ProductLine {
  id: string;
  code: string;
  buyPrice: number | null;
  dutyRate: number | null;
  unit: string;
  qty: number | null;
  weight: number | null;
  totalWeight: number | null;
  cubic: number | null;
  marginPercent: number | null;
  marketPrice: number | null;
  sellPrice: number | null;
}

export interface LineCalc {
  buyPriceLocal: number;
  extraCosts: number;
  dutyAmount: number;
  totalAlloc: number;
  landedCostEx: number;
  importCostPerUnit: number;
  landedTotal: number;
  importCostTotal: number;
  margin: number;
  sellPerUnit: number;
  sellTotal: number;
  profitPerUnit: number;
  profitTotal: number;
  suggestedMarginPercent: number;
  suggestedSellPerUnit: number;
  maxMarginPercent: number;
}

interface Props {
  lines: ProductLine[];
  calcs: LineCalc[];
  buyCurrency: string;
  localCurrency: string;
  onUpdate: (id: string, field: keyof ProductLine, value: string | number | null) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  fmt: (v: number) => string;
  totals: { extraCosts: number; totalLanded: number; importCost: number; sell: number; profit: number };
  columnLabels: ColumnLabels;
  onColumnLabelChange: (key: keyof ColumnLabels, value: string) => void;
  allocMode: 'kg' | 'cbm';
}


function EditableHeader({
  label,
  labelKey,
  onSave,
  className = '',
  subtext,
}: {
  label: string;
  labelKey: keyof ColumnLabels;
  onSave: (key: keyof ColumnLabels, value: string) => void;
  className?: string;
  subtext?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [tempValue, setTempValue] = useState(label);

  const handleSave = () => {
    onSave(labelKey, tempValue);
    setEditing(false);
  };

  const handleCancel = () => {
    setTempValue(label);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          className="w-full px-1 py-0.5 text-xs bg-white border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
        />
        <button onClick={handleSave} className="p-0.5 text-green-600 hover:text-green-800">
          <Check className="w-3 h-3" />
        </button>
        <button onClick={handleCancel} className="p-0.5 text-red-500 hover:text-red-700">
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className={`group flex items-center gap-1 ${className}`}>
      <div>
        <div>{label}</div>
        {subtext && <div className="text-[9px] font-normal text-gray-500">{subtext}</div>}
      </div>
      <button
        onClick={() => setEditing(true)}
        className="p-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"
        title="Edit column name"
      >
        <Pencil className="w-2.5 h-2.5" />
      </button>
    </div>
  );
}

const inputCls =
  'w-full px-2.5 py-1.5 bg-teal-50 border border-blue-200 rounded text-sm font-medium text-teal-800 focus:outline-none focus:ring-1 focus:ring-blue-400';
const calcCls = 'px-2.5 py-1.5 bg-gray-50 rounded text-right text-sm font-medium text-gray-700';

export default function ImportCostTables({
  lines,
  calcs,
  buyCurrency,
  localCurrency,
  onUpdate,
  onRemove,
  onAdd,
  fmt,
  totals,
  columnLabels,
  onColumnLabelChange,
  allocMode,
}: Props) {
  const grandTotalWeight = lines.reduce((s, l) => s + (l.weight ?? 0) * (l.qty ?? 0), 0);
  const grandTotalCubic = lines.reduce((s, l) => s + (l.cubic ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-2.5 bg-[#111111] flex items-center justify-between rounded-t-lg">
          <h3 className="font-bold text-white text-sm tracking-wide uppercase">
            Enter Product Details (Delete The Lines That Are Not Needed.)
          </h3>
          <button
            onClick={onAdd}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-[#e8552a] rounded hover:bg-[#cf4a22] transition-colors"
          >
            <Plus className="w-3 h-3" /> Add Line
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-100 border-b-2 border-gray-300">
                <th className="px-2 py-2 text-left font-bold text-gray-700 uppercase tracking-wider w-44">
                  <EditableHeader label={columnLabels.code} labelKey="code" onSave={onColumnLabelChange} />
                </th>
                <th className="px-2 py-2 text-center font-bold text-gray-700 uppercase tracking-wider w-20">
                  <EditableHeader label={columnLabels.dutyRate} labelKey="dutyRate" onSave={onColumnLabelChange} className="justify-center" />
                </th>
                <th className="px-2 py-2 text-center font-bold text-gray-700 uppercase tracking-wider w-16">
                  <EditableHeader label={columnLabels.unit} labelKey="unit" onSave={onColumnLabelChange} className="justify-center" />
                </th>
                <th className="px-2 py-2 text-right font-bold text-gray-700 uppercase tracking-wider w-24">
                  <EditableHeader label={columnLabels.buyPrice} labelKey="buyPrice" onSave={onColumnLabelChange} className="justify-end" subtext={buyCurrency} />
                </th>
                <th className="px-2 py-2 text-center font-bold text-gray-700 uppercase tracking-wider w-24">
                  <EditableHeader label={columnLabels.qty} labelKey="qty" onSave={onColumnLabelChange} className="justify-center" />
                </th>
                {allocMode === 'kg' && (
                  <>
                    <th className="px-2 py-2 text-right font-bold text-white uppercase tracking-wider bg-teal-600 w-24">
                      <EditableHeader label={columnLabels.weight} labelKey="weight" onSave={onColumnLabelChange} className="justify-end" />
                    </th>
                    <th className="px-2 py-2 text-right font-bold text-gray-700 uppercase tracking-wider w-24">
                      <EditableHeader label={columnLabels.weightTotal} labelKey="weightTotal" onSave={onColumnLabelChange} className="justify-end" />
                    </th>
                  </>
                )}
                {allocMode === 'cbm' && (
                  <>
                    <th className="px-2 py-2 text-right font-bold text-white uppercase tracking-wider bg-sky-600 w-24">
                      <EditableHeader label={columnLabels.cubic} labelKey="cubic" onSave={onColumnLabelChange} className="justify-end" />
                    </th>
                    <th className="px-2 py-2 text-right font-bold text-gray-700 uppercase tracking-wider w-24">
                      <EditableHeader label={columnLabels.cubicTotal} labelKey="cubicTotal" onSave={onColumnLabelChange} className="justify-end" />
                    </th>
                  </>
                )}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const weightTotal = (line.weight ?? 0) * (line.qty ?? 0);
                const cubicTotal = line.cubic ?? 0;
                return (
                  <tr
                    key={line.id}
                    className="border-b border-gray-100 hover:bg-teal-50/30 transition-colors"
                  >
                    <td className="px-1.5 py-1">
                      <input
                        type="text"
                        value={line.code}
                        onChange={(e) => onUpdate(line.id, 'code', e.target.value)}
                        className={inputCls}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <input
                        type="number"
                        value={line.dutyRate ?? ''}
                        onChange={(e) =>
                          onUpdate(line.id, 'dutyRate', e.target.value ? Number(e.target.value) : null)
                        }
                        className={`${inputCls} text-center`}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <input
                        type="text"
                        value={line.unit}
                        onChange={(e) => onUpdate(line.id, 'unit', e.target.value)}
                        className={`${inputCls} text-center`}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <input
                        type="number"
                        value={line.buyPrice ?? ''}
                        onChange={(e) =>
                          onUpdate(line.id, 'buyPrice', e.target.value ? Number(e.target.value) : null)
                        }
                        placeholder="0.00"
                        className={`${inputCls} text-right`}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      <input
                        type="number"
                        value={line.qty ?? ''}
                        onChange={(e) =>
                          onUpdate(line.id, 'qty', e.target.value ? Number(e.target.value) : null)
                        }
                        className={`${inputCls} text-center`}
                      />
                    </td>
                    {allocMode === 'kg' && (
                      <>
                        <td className="px-1.5 py-1">
                          <input
                            type="number"
                            value={line.weight ?? ''}
                            onChange={(e) =>
                              onUpdate(line.id, 'weight', e.target.value ? Number(e.target.value) : null)
                            }
                            placeholder="0"
                            className={`${inputCls} text-right`}
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <div className={calcCls}>
                            {weightTotal > 0 ? weightTotal.toLocaleString('en-US') : '0'}
                          </div>
                        </td>
                      </>
                    )}
                    {allocMode === 'cbm' && (
                      <>
                        <td className="px-1.5 py-1">
                          <input
                            type="number"
                            value={line.cubic ?? ''}
                            onChange={(e) =>
                              onUpdate(line.id, 'cubic', e.target.value ? Number(e.target.value) : null)
                            }
                            placeholder="0"
                            className={`${inputCls} text-right`}
                            step="0.01"
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <div className={calcCls}>
                            {cubicTotal > 0
                              ? cubicTotal.toLocaleString('en-US', {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 2,
                                })
                              : '0'}
                          </div>
                        </td>
                      </>
                    )}
                    <td className="px-1.5 py-1">
                      <button
                        onClick={() => onRemove(line.id)}
                        className="p-0.5 text-gray-300 hover:text-red-500 rounded transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2 border-gray-400">
                <td
                  colSpan={6}
                  className="px-3 py-2 text-right font-bold text-gray-800 text-xs uppercase"
                >
                  Totals
                </td>
                {allocMode === 'kg' && (
                  <>
                    <td className="px-2 py-2">
                      <div className="text-right font-bold text-teal-700 text-xs">
                        {grandTotalWeight.toLocaleString('en-US')}{' '}
                        <span className="text-teal-500 font-semibold">KGS</span>
                      </div>
                    </td>
                    <td className="px-2 py-2" />
                  </>
                )}
                {allocMode === 'cbm' && (
                  <>
                    <td className="px-2 py-2">
                      <div className="text-right font-bold text-sky-700 text-xs">
                        {grandTotalCubic.toLocaleString('en-US', {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 2,
                        })}{' '}
                        <span className="text-sky-500 font-semibold">M3</span>
                      </div>
                    </td>
                    <td className="px-2 py-2" />
                  </>
                )}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-4 py-2.5 bg-[#111111] rounded-t-lg">
          <h3 className="font-bold text-white text-sm tracking-wide uppercase">
            Landed Cost, Sell & Profit Calculation
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-100 border-b-2 border-gray-300">
                <th className="px-2 py-2 text-left font-bold text-gray-700 uppercase tracking-wider w-36">
                  <EditableHeader label={columnLabels.code} labelKey="code" onSave={onColumnLabelChange} />
                </th>
                <th className="px-2 py-2 text-right font-bold text-gray-700 uppercase tracking-wider w-24">
                  <EditableHeader label={columnLabels.buyLocal} labelKey="buyLocal" onSave={onColumnLabelChange} className="justify-end" subtext={localCurrency} />
                </th>
                <th className="px-2 py-2 text-right font-bold text-gray-700 uppercase tracking-wider w-28">
                  <EditableHeader label={columnLabels.dutyCost} labelKey="dutyCost" onSave={onColumnLabelChange} className="justify-end" />
                </th>
                <th className="px-2 py-2 text-right font-bold text-white uppercase tracking-wider bg-[#111111] w-28">
                  <EditableHeader label={columnLabels.totalAlloc} labelKey="totalAlloc" onSave={onColumnLabelChange} className="justify-end" subtext="(LKR)" />
                </th>
                <th className="px-2 py-2 text-right font-bold text-gray-700 uppercase tracking-wider bg-teal-50 w-28">
                  <EditableHeader label={columnLabels.landedEx} labelKey="landedEx" onSave={onColumnLabelChange} className="justify-end" />
                </th>
                <th className="px-2 py-2 text-center font-bold text-gray-700 uppercase tracking-wider w-14">
                  <EditableHeader label={columnLabels.qty} labelKey="qty" onSave={onColumnLabelChange} className="justify-center" />
                </th>
                <th className="px-2 py-2 text-right font-bold text-gray-700 uppercase tracking-wider bg-amber-50 w-28">
                  <EditableHeader label={columnLabels.landedTotal} labelKey="landedTotal" onSave={onColumnLabelChange} className="justify-end" />
                </th>
                <th className="px-2 py-2 text-center font-bold text-gray-700 uppercase tracking-wider w-20">
                  <EditableHeader label={columnLabels.marginPercent} labelKey="marginPercent" onSave={onColumnLabelChange} className="justify-center" />
                </th>
                <th className="px-2 py-2 text-right font-bold text-white uppercase tracking-wider bg-teal-600 w-36">
                  <EditableHeader label={columnLabels.sellPerUnit} labelKey="sellPerUnit" onSave={onColumnLabelChange} className="justify-end" subtext="Type to override" />
                </th>
                <th className="px-2 py-2 text-right font-bold text-gray-700 uppercase tracking-wider bg-sky-50 w-36">
                  <EditableHeader label={columnLabels.suggested} labelKey="suggested" onSave={onColumnLabelChange} className="justify-end" subtext="Auto Price" />
                </th>
                <th className="px-2 py-2 text-right font-bold text-gray-700 uppercase tracking-wider w-28">
                  <EditableHeader label={columnLabels.sellTotal} labelKey="sellTotal" onSave={onColumnLabelChange} className="justify-end" />
                </th>
                <th className="px-2 py-2 text-right font-bold text-gray-700 uppercase tracking-wider bg-emerald-50 w-28">
                  <EditableHeader label={columnLabels.profitTotal} labelKey="profitTotal" onSave={onColumnLabelChange} className="justify-end" />
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => {
                const c = calcs[i];
                return (
                  <tr
                    key={line.id}
                    className="border-b border-gray-100 hover:bg-emerald-50/20 transition-colors"
                  >
                    <td className="px-2 py-1.5 text-sm font-medium text-gray-700 truncate max-w-[160px]">
                      {line.code || '-'}
                    </td>
                    <td className="px-1.5 py-1">
                      <div className={calcCls}>{fmt(c.buyPriceLocal)}</div>
                    </td>
                    <td className="px-1.5 py-1">
                      <div className={calcCls}>{fmt(c.extraCosts + c.dutyAmount + c.importCostPerUnit)}</div>
                    </td>
                    <td className="px-1.5 py-1">
                      <div className="px-2 py-1 rounded text-right text-sm font-bold bg-slate-100 border border-slate-300 text-slate-700">
                        {fmt(c.totalAlloc)}
                      </div>
                    </td>
                    <td className="px-1.5 py-1">
                      <div className="px-2 py-1 bg-teal-50 rounded text-right text-sm font-bold text-teal-800">
                        {fmt(c.landedCostEx)}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-center text-sm text-gray-600">
                      {line.qty ?? '-'}
                    </td>
                    <td className="px-1.5 py-1">
                      <div className="px-2 py-1 bg-amber-50 rounded text-right text-sm font-bold text-amber-800">
                        {fmt(c.landedTotal)}
                      </div>
                    </td>
                    <td className="px-1.5 py-1">
                      <input
                        type="number"
                        value={line.marginPercent ?? ''}
                        onChange={(e) =>
                          onUpdate(
                            line.id,
                            'marginPercent',
                            e.target.value ? Number(e.target.value) : null
                          )
                        }
                        placeholder="0"
                        className={`${inputCls} text-center`}
                      />
                    </td>
                    <td className="px-1.5 py-1">
                      {line.sellPrice === null && line.marginPercent !== null && line.marginPercent > 0 && c.sellPerUnit > 0 ? (
                        <div className="px-2 py-1 rounded text-right text-sm font-bold bg-teal-100 border border-teal-300 text-blue-900">
                          {fmt(c.sellPerUnit)}
                          <div className="text-[9px] font-medium text-blue-500 mt-0.5">from {line.marginPercent}% margin</div>
                        </div>
                      ) : (
                        <input
                          type="number"
                          value={line.sellPrice ?? ''}
                          onChange={(e) =>
                            onUpdate(
                              line.id,
                              'sellPrice',
                              e.target.value ? Number(e.target.value) : null
                            )
                          }
                          placeholder={c.sellPerUnit > 0 ? String(Math.round(c.sellPerUnit)) : '0'}
                          className="w-36 px-2 py-1.5 rounded text-right text-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-400 bg-teal-50 text-blue-900 border border-teal-300 placeholder:text-blue-400/70"
                        />
                      )}
                    </td>
                    <td className="px-1.5 py-1">
                      {c.suggestedSellPerUnit > 0 ? (
                        <div className="px-2 py-1 rounded text-right bg-sky-50 border border-sky-200">
                          <div className="text-sm font-bold text-sky-800">
                            {fmt(c.suggestedSellPerUnit)}
                          </div>
                          <div className="flex items-center justify-end gap-1 mt-0.5">
                            <span className="text-[9px] font-medium text-sky-600">
                              {c.suggestedMarginPercent}%
                            </span>
                            {c.sellPerUnit > 0 && (
                              (() => {
                                const diff = c.sellPerUnit - c.suggestedSellPerUnit;
                                const pct = (diff / c.suggestedSellPerUnit) * 100;
                                if (Math.abs(pct) < 1) return (
                                  <span className="flex items-center text-[9px] text-gray-500 font-medium">
                                    <Minus className="w-2.5 h-2.5 mr-0.5" />match
                                  </span>
                                );
                                if (diff > 0) return (
                                  <span className="flex items-center text-[9px] text-emerald-600 font-medium">
                                    <TrendingUp className="w-2.5 h-2.5 mr-0.5" />+{pct.toFixed(0)}%
                                  </span>
                                );
                                return (
                                  <span className="flex items-center text-[9px] text-red-500 font-medium">
                                    <TrendingDown className="w-2.5 h-2.5 mr-0.5" />{pct.toFixed(0)}%
                                  </span>
                                );
                              })()
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="px-2 py-1 text-right text-sm text-gray-400">-</div>
                      )}
                    </td>
                    <td className="px-1.5 py-1">
                      <div className="px-2 py-1 bg-emerald-50 rounded text-right text-sm font-bold text-emerald-800">
                        {c.sellTotal > 0 ? fmt(c.sellTotal) : '-'}
                      </div>
                    </td>
                    <td className="px-1.5 py-1">
                      {(() => {
                        const profitPct = c.landedCostEx > 0 ? (c.profitTotal / c.landedTotal) * 100 : 0;
                        return (
                          <div className={`px-2 py-1 rounded text-right text-sm font-bold ${c.profitTotal >= 0 ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-700'}`}>
                            {c.sellTotal > 0 ? fmt(c.profitTotal) : '-'}
                            {c.sellTotal > 0 && (
                              <div className={`text-[9px] font-medium ${profitPct >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                {profitPct >= 0 ? '+' : ''}{profitPct.toFixed(1)}%
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2 border-gray-400">
                <td colSpan={2} className="px-3 py-2 text-right font-bold text-gray-800 text-xs uppercase">
                  Totals
                </td>
                <td />
                <td className="px-2 py-2">
                  <div className="text-right font-bold text-slate-700 text-xs">
                    {fmt(calcs.reduce((sum, c) => sum + c.totalAlloc, 0))}
                  </div>
                </td>
                <td />
                <td />
                <td className="px-2 py-2">
                  <div className="text-right font-bold text-amber-900 text-xs">
                    {fmt(totals.totalLanded)}
                  </div>
                </td>
                <td />
                <td className="px-2 py-2">
                  <div className="text-right font-bold text-emerald-900 text-xs">
                    {fmt(totals.sell)}
                  </div>
                </td>
                <td colSpan={2} className="px-2 py-2">
                  <div className={`text-right font-bold text-xs ${totals.profit >= 0 ? 'text-emerald-900' : 'text-red-700'}`}>
                    {fmt(totals.profit)}
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
