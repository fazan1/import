import { useEffect, useState } from 'react';
import { X, History } from 'lucide-react';
import { supabase } from '../lib/supabase';

/* History of one shipment / batch: every change to its packing list lines, shipping charges,
   agent account lines and costing lines — who, when, old -> new. Written by the database
   (sql/history-and-auto-charges.sql), so it cannot be edited from the app. */

interface Entry { id: number; changed_at: string; table_name: string; action: string; label: string | null; changes: Record<string, unknown> | null; user_email: string | null }

const WHERE: Record<string, string> = { packing_list_items: 'Packing list', shipment_item_charges: 'Shipping charge', agent_ledger: 'Agent account', costing_duty_sheet: 'Costing' };
const FIELD: Record<string, string> = {
  weight_kg: 'Kg', cbm: 'CBM', no_of_pkgs: 'Packages', quantity: 'Qty', qty: 'Qty', unit: 'Unit', item_name: 'Item', description: 'Item',
  packing_list_no: 'PL no', batch_number: 'Batch', basis: 'Type', rate: 'Rate', amount: 'Amount', kind: 'Kind', reference: 'Reference', note: 'Note',
  entry_date: 'Date', charge_per_unit: 'Shipping/unit', selling_price: 'Selling price', unit_price_cny: 'Price CNY', cny_rate: 'CNY rate',
  landed_cost_per_unit: 'Landed/unit', type: 'Type', status: 'Status', payment_mode: 'Paid by',
};
// worked-out or technical fields: not shown (they follow from the ones above)
const HIDE = /(^id$|_id$|^book$|^total_|^profit_per_unit$|^unit_price_lkr$|^duty_per_unit$|^duty_basis$|^duty_rate$|^charge_basis$|_at$)/;
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v));

export default function ChangeHistory({ batch, onClose }: { batch: string; onClose: () => void }) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('change_log').select('id, changed_at, table_name, action, label, changes, user_email').eq('batch', batch)
      .order('changed_at', { ascending: false }).limit(500)
      .then(({ data, error }) => {
        if (error) setErr(/change_log/.test(error.message) && /does not exist|schema cache/.test(error.message) ? 'Run history-and-auto-charges.sql in Supabase once — from then on every change is recorded here.' : `Could not load the history: ${error.message}`);
        else setRows((data ?? []) as Entry[]);
      });
  }, [batch]);

  return (
    <div className="fixed inset-0 bg-black/40 z-[80] flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white sm:rounded-xl shadow-xl w-full max-w-3xl h-[90dvh] sm:h-auto sm:max-h-[85vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div><h3 className="font-semibold text-gray-900 flex items-center gap-2"><History className="w-4 h-4" />History — {batch}</h3>
            <p className="text-xs text-gray-500">Every change to this shipment’s packing list, shipping charges, agent account and costing. Newest first.</p></div>
          <button onClick={onClose} className="text-gray-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {err ? <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">{err}</p>
            : rows === null ? <p className="text-sm text-gray-500">Loading…</p>
            : rows.length === 0 ? <p className="text-sm text-gray-500">No changes recorded yet for {batch}. Changes made from now on will appear here.</p>
            : (
              <ul className="divide-y divide-gray-100">
                {rows.map((r) => {
                  const ch = Object.entries(r.changes ?? {}).filter(([k]) => !HIDE.test(k));
                  return (
                    <li key={r.id} className="py-2 text-sm">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span><span className={`text-[11px] px-1.5 py-0.5 rounded mr-2 ${r.action === 'deleted' ? 'bg-red-50 text-red-700' : r.action === 'added' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-700'}`}>{r.action}</span>
                          <b>{r.label || '—'}</b> <span className="text-gray-500">· {WHERE[r.table_name] ?? r.table_name}</span></span>
                        <span className="text-[11px] text-gray-500">{new Date(r.changed_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {(r.user_email || 'unknown').split('@')[0]}</span>
                      </div>
                      {ch.length > 0 && (
                        <div className="mt-1 text-[12px] text-gray-700 flex flex-wrap gap-x-4 gap-y-0.5">
                          {ch.map(([k, v]) => r.action === 'changed' && Array.isArray(v)
                            ? <span key={k}>{FIELD[k] ?? k}: <span className="text-gray-400 line-through">{show(v[0])}</span> → <b>{show(v[1])}</b></span>
                            : <span key={k}>{FIELD[k] ?? k}: <b>{show(v)}</b></span>)}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      </div>
    </div>
  );
}
