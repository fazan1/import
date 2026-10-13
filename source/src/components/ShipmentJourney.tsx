import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';

/* "Where is each shipment?" — one line per open shipment:
   Billed → Paid → Packed → Shipped → Arrived → Cleared. Reads the current book. */

const STEPS = ['Billed', 'Paid', 'Packed', 'Shipped', 'Arrived', 'Cleared'] as const;
const cny = (v: number) => '¥' + Math.round(v).toLocaleString('en-US');

interface Bill { id: string; batch: string; bal: number }
interface Ship { no: string; status: string; eta: string | null }
interface PL { bill: string | null; batch: string; received: boolean }

export default function ShipmentJourney({ onNavigate, limit = 8 }: { onNavigate?: (view: string) => void; limit?: number }) {
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState<Bill[]>([]);
  const [ships, setShips] = useState<Ship[]>([]);
  const [pls, setPls] = useState<PL[]>([]);

  useEffect(() => {
    (async () => {
      const [b, s, p] = await Promise.all([
        supabase.from('purchase_bills').select('id, batch_number, amount_paid, purchase_bill_items(quantity_received, unit_price_cny)'),
        supabase.from('shipments').select('shipment_no, status, eta, created_at').order('created_at', { ascending: false }),
        supabase.from('pl_input').select('purchase_bill_id, batch_number, received'),
      ]);
      type BRaw = { id: string; batch_number: string | null; amount_paid: number | null; purchase_bill_items: { quantity_received: number; unit_price_cny: number }[] | null };
      setBills(((b.data ?? []) as unknown as BRaw[]).map((x) => {
        const total = (x.purchase_bill_items ?? []).reduce((t, i) => t + (Number(i.quantity_received) || 0) * (Number(i.unit_price_cny) || 0), 0);
        return { id: x.id, batch: x.batch_number || '', bal: total - (Number(x.amount_paid) || 0) };
      }));
      setShips(((s.data ?? []) as { shipment_no: string; status: string; eta: string | null }[]).map((x) => ({ no: x.shipment_no, status: x.status, eta: x.eta })));
      setPls(((p.data ?? []) as { purchase_bill_id: string | null; batch_number: string | null; received: boolean }[]).map((x) => ({ bill: x.purchase_bill_id, batch: x.batch_number || '', received: !!x.received })));
      setLoading(false);
    })();
  }, []);

  const open = ships.filter((s) => s.status !== 'Cleared');
  const rows = open.slice(0, limit).map((s) => {
    const bs = bills.filter((b) => b.batch === s.no);
    const billed = bs.length > 0;
    const paid = billed && bs.every((b) => b.bal <= 0.5);
    const mine = pls.filter((p) => p.batch === s.no || bs.some((b) => b.id === p.bill));
    const packed = mine.length > 0 && mine.every((p) => p.received);
    const order = ['Booked', 'Shipped', 'Arrived', 'Cleared'].indexOf(s.status);
    return { s, n: bs.length, due: bs.reduce((t, b) => t + Math.max(0, b.bal), 0), done: [billed, paid, packed, order >= 1, order >= 2, order >= 3] };
  });

  return (
    <div className="rounded-3xl bg-white border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">Where is each shipment?</h3>
        {onNavigate && <button onClick={() => onNavigate('shipping')} className="text-xs text-teal-700 flex items-center gap-1">All <ArrowRight className="w-3.5 h-3.5" /></button>}
      </div>
      {loading ? <p className="text-sm text-gray-500">Loading…</p> : rows.length === 0 ? <p className="text-sm text-gray-500">No open shipments. Book one under Shipping when cargo is ready.</p> : (
        <div className="grid lg:grid-cols-2 gap-x-10 gap-y-5">
          {rows.map(({ s, n, due, done }) => (
            <div key={s.no}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <span className="font-mono font-semibold text-gray-900 text-sm">{s.no}</span>
                <span className="text-[11px] text-gray-500">{n} bill{n === 1 ? '' : 's'}{due > 0.5 ? ` · ${cny(due)} to pay` : n ? ' · all paid' : ''}{s.eta ? ` · ETA ${s.eta}` : ''}</span>
              </div>
              <div className="flex items-center">
                {STEPS.map((st, i) => (
                  <div key={st} className="flex-1 flex items-center last:flex-none">
                    <div className="flex flex-col items-center">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${done[i] ? 'bg-teal-500 text-white' : 'bg-gray-100 text-gray-300'}`}>{done[i] ? <CheckCircle2 className="w-4 h-4" /> : <Clock className="w-3.5 h-3.5" />}</div>
                      <span className={`text-[10px] mt-1 ${done[i] ? 'text-teal-700 font-medium' : 'text-gray-400'}`}>{st}</span>
                    </div>
                    {i < STEPS.length - 1 && <div className={`flex-1 h-1 mx-1 -mt-4 rounded-full ${done[i] && done[i + 1] ? 'bg-teal-400' : 'bg-gray-100'}`} />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
