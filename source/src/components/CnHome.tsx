import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Receipt, DollarSign, Landmark, ListChecks, Container, BarChart3, Ship, Package, CheckCircle2, Clock, Sun, Moon, CloudSun, ArrowRight, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getBook, BOOK_ALL, BOOK_BRO } from '../lib/book';
import { companyFor } from '../lib/company';

/* A friendly home page for the CN side: what we owe, where each shipment is,
   and what needs doing today. Reads only the current book. */

interface Bill { id: string; no: string; date: string; batch: string; supplier: string; total: number; paid: number; bal: number }
interface Ship { no: string; status: string; eta: string | null; mode: string; created: string }
interface PL { bill: string | null; batch: string; received: boolean }
interface Pay { date: string; rmb: number }

const cny = (v: number) => '¥' + Math.round(v).toLocaleString('en-US');
const lkr = (v: number) => 'Rs ' + Math.round(v).toLocaleString('en-US');
const days = (d: string) => Math.floor((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86400000);
const STEPS = ['Billed', 'Paid', 'Packed', 'Shipped', 'Arrived', 'Cleared'] as const;

export default function CnHome({ name, onNavigate }: { name?: string | null; onNavigate: (view: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [bills, setBills] = useState<Bill[]>([]);
  const [ships, setShips] = useState<Ship[]>([]);
  const [pls, setPls] = useState<PL[]>([]);
  const [pays, setPays] = useState<Pay[]>([]);
  const [investorBal, setInvestorBal] = useState(0);
  const [poCount, setPoCount] = useState(0);

  useEffect(() => {
    (async () => {
      const [b, s, p, pp, l, po] = await Promise.all([
        supabase.from('purchase_bills').select('id, bill_number, cnv_invoice_number, bill_date, batch_number, amount_paid, purchase_orders(suppliers(name)), purchase_bill_items(quantity_received, unit_price_cny)'),
        supabase.from('shipments').select('shipment_no, status, eta, mode, created_at').order('created_at', { ascending: false }),
        supabase.from('pl_input').select('purchase_bill_id, batch_number, received'),
        supabase.from('purchase_payments').select('payment_date, amount'),
        supabase.from('investor_ledger').select('direction, lkr'),
        supabase.from('purchase_orders').select('id', { count: 'exact', head: true }),
      ]);
      type BRaw = { id: string; bill_number: string | null; cnv_invoice_number: string | null; bill_date: string; batch_number: string | null; amount_paid: number | null; purchase_orders: { suppliers: { name: string } | null } | null; purchase_bill_items: { quantity_received: number; unit_price_cny: number }[] | null };
      setBills(((b.data ?? []) as unknown as BRaw[]).map((x) => {
        const total = (x.purchase_bill_items ?? []).reduce((t, i) => t + (Number(i.quantity_received) || 0) * (Number(i.unit_price_cny) || 0), 0);
        const paid = Number(x.amount_paid) || 0;
        return { id: x.id, no: x.bill_number || x.cnv_invoice_number || '—', date: x.bill_date, batch: x.batch_number || '', supplier: x.purchase_orders?.suppliers?.name || '—', total, paid, bal: total - paid };
      }));
      setShips(((s.data ?? []) as { shipment_no: string; status: string; eta: string | null; mode: string; created_at: string }[]).map((x) => ({ no: x.shipment_no, status: x.status, eta: x.eta, mode: x.mode, created: x.created_at.slice(0, 10) })));
      setPls(((p.data ?? []) as { purchase_bill_id: string | null; batch_number: string | null; received: boolean }[]).map((x) => ({ bill: x.purchase_bill_id, batch: x.batch_number || '', received: !!x.received })));
      setPays(((pp.data ?? []) as { payment_date: string; amount: number }[]).map((x) => ({ date: x.payment_date, rmb: Number(x.amount) || 0 })));
      setInvestorBal(((l.data ?? []) as { direction: string; lkr: number }[]).reduce((t, x) => t + (x.direction === 'owe' ? 1 : -1) * (Number(x.lkr) || 0), 0));
      setPoCount(po.count ?? 0);
      setLoading(false);
    })();
  }, []);

  const unpaid = useMemo(() => bills.filter((b) => b.bal > 0.5).sort((a, b) => a.date.localeCompare(b.date)), [bills]);
  const oweSuppliers = unpaid.reduce((t, b) => t + b.bal, 0);
  const openShips = ships.filter((s) => s.status !== 'Cleared');
  const looseBills = bills.filter((b) => !b.batch || !ships.some((s) => s.no === b.batch));
  const plWaiting = pls.filter((p) => !p.received);

  // journey of each open shipment
  const journeys = openShips.slice(0, 6).map((s) => {
    const bs = bills.filter((b) => b.batch === s.no);
    const billed = bs.length > 0;
    const paid = billed && bs.every((b) => b.bal <= 0.5);
    const myPls = pls.filter((p) => p.batch === s.no || bs.some((b) => b.id === p.bill));
    const packed = myPls.length > 0 && myPls.every((p) => p.received);
    const order = ['Booked', 'Shipped', 'Arrived', 'Cleared'].indexOf(s.status);
    const done = [billed, paid, packed, order >= 1, order >= 2, order >= 3];
    const due = bs.reduce((t, b) => t + Math.max(0, b.bal), 0);
    return { s, done, bills: bs.length, due };
  });

  // to-do list
  const todo: { tone: string; text: string; sub: string; view: string }[] = [];
  unpaid.slice(0, 3).forEach((b) => todo.push({ tone: days(b.date) > 30 ? 'rose' : 'amber', text: `Pay ${b.supplier} — ${cny(b.bal)}`, sub: `Bill ${b.no} · ${days(b.date)} days old`, view: 'outstanding-payments' }));
  openShips.filter((s) => s.eta && s.status !== 'Arrived').forEach((s) => {
    const d = -days(s.eta!);
    if (d <= 7) todo.push({ tone: d < 0 ? 'rose' : 'sky', text: d < 0 ? `${s.no} was due ${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? `${s.no} arrives today` : `${s.no} arrives in ${d} day${d === 1 ? '' : 's'}`, sub: `${s.mode} · ${s.status}`, view: 'shipping' });
  });
  if (plWaiting.length) todo.push({ tone: 'violet', text: `${plWaiting.length} packing list${plWaiting.length > 1 ? 's' : ''} still to receive`, sub: 'Ask the supplier, then tick received in PL Input', view: 'pl-input' });
  if (looseBills.length) todo.push({ tone: 'sky', text: `${looseBills.length} bill${looseBills.length > 1 ? 's' : ''} not in a shipment yet`, sub: 'Add them to a shipment when cargo is booked', view: 'shipping' });

  // payments in the last 6 months
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - i)); return d.toISOString().slice(0, 7); });
  const perMonth = months.map((m) => ({ m, v: pays.filter((p) => p.date.startsWith(m)).reduce((t, p) => t + p.rmb, 0) }));
  const maxM = Math.max(1, ...perMonth.map((x) => x.v));

  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const GreetIcon = h < 12 ? Sun : h < 17 ? CloudSun : Moon;
  const first = (name || '').split(/[\s@.]/)[0];
  const book = getBook() === BOOK_ALL ? 'All books' : getBook();
  const fresh = !loading && bills.length === 0 && poCount === 0 && ships.length === 0;

  const tiles = [
    { label: 'We owe suppliers', value: cny(oweSuppliers), sub: `${unpaid.length} bill${unpaid.length === 1 ? '' : 's'} open`, icon: DollarSign, bg: 'bg-rose-50', ic: 'text-rose-500 bg-white', view: 'outstanding-payments' },
    { label: 'We owe the investor', value: lkr(investorBal), sub: 'Investor ledger balance', icon: Landmark, bg: 'bg-amber-50', ic: 'text-amber-500 bg-white', view: 'investor' },
    { label: 'Shipments on the way', value: String(openShips.length), sub: `${ships.length - openShips.length} cleared so far`, icon: Ship, bg: 'bg-sky-50', ic: 'text-sky-500 bg-white', view: 'shipping' },
    { label: 'Packing lists waiting', value: String(plWaiting.length), sub: `${pls.length - plWaiting.length} received`, icon: ListChecks, bg: 'bg-violet-50', ic: 'text-violet-500 bg-white', view: 'pl-input' },
  ];
  const actions = [
    { label: 'New PO', icon: ClipboardList, view: 'purchase-orders' },
    { label: 'Bills', icon: Receipt, view: 'purchase-bills' },
    { label: 'Pay supplier', icon: DollarSign, view: 'outstanding-payments' },
    { label: 'Packing list', icon: Package, view: 'packing-list' },
    { label: 'Shipping', icon: Container, view: 'shipping' },
    { label: 'Reports', icon: BarChart3, view: 'cn-reports' },
  ];
  const toneCls: Record<string, string> = { rose: 'bg-rose-400', amber: 'bg-amber-400', sky: 'bg-sky-400', violet: 'bg-violet-400' };

  return (
    <div className="space-y-5">
      {/* hello */}
      <div className="rounded-3xl bg-gradient-to-br from-teal-50 via-white to-sky-50 border border-teal-100 p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center"><GreetIcon className="w-6 h-6 text-amber-400" /></div>
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900">{greet}{first ? `, ${first.charAt(0).toUpperCase() + first.slice(1)}` : ''}</h2>
            <p className="text-sm text-gray-500 flex flex-wrap items-center gap-2">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              {/* which book this home page is for, so the shop's home is never mistaken for yours */}
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getBook() === BOOK_BRO ? 'bg-violet-100 text-violet-800' : 'bg-teal-100 text-teal-800'}`}>{book} · {companyFor().name}</span></p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button key={a.label} onClick={() => onNavigate(a.view)} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white border border-gray-200 text-sm text-gray-700 hover:border-teal-400 hover:text-teal-700 shadow-sm">
              <a.icon className="w-4 h-4" />{a.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <p className="text-sm text-gray-500 px-1">Loading…</p> : fresh ? (
        <div className="rounded-3xl border border-dashed border-teal-300 bg-white p-6 sm:p-8 text-center">
          <Sparkles className="w-8 h-8 text-teal-500 mx-auto mb-2" />
          <h3 className="text-lg font-bold text-gray-900">A fresh, empty book</h3>
          <p className="text-sm text-gray-500 mb-5">Everything you enter here stays in {book}. Start in this order:</p>
          <div className="grid sm:grid-cols-4 gap-3 text-left max-w-3xl mx-auto">
            {[['1', 'Make a PO', 'Pick the supplier and items', 'purchase-orders'], ['2', 'Enter the bill', 'When the supplier invoices', 'purchase-bills'], ['3', 'Pay the supplier', 'Investor ledger updates by itself', 'outstanding-payments'], ['4', 'Packing list & ship', 'Receive the PL, book the cargo', 'pl-input']].map(([n, t, d, v]) => (
              <button key={n} onClick={() => onNavigate(v)} className="rounded-2xl bg-teal-50 hover:bg-teal-100 p-4 text-left">
                <span className="w-7 h-7 rounded-full bg-white text-teal-700 font-bold text-sm flex items-center justify-center mb-2">{n}</span>
                <div className="font-semibold text-gray-900 text-sm">{t}</div>
                <div className="text-xs text-gray-500">{d}</div>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* the four numbers */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {tiles.map((t) => (
              <button key={t.label} onClick={() => onNavigate(t.view)} className={`${t.bg} rounded-3xl p-4 text-left hover:shadow-md transition-shadow`}>
                <div className={`w-9 h-9 rounded-xl ${t.ic} flex items-center justify-center shadow-sm mb-3`}><t.icon className="w-5 h-5" /></div>
                <div className="text-xs text-gray-500">{t.label}</div>
                <div className="text-lg sm:text-2xl font-bold text-gray-900 tabular-nums truncate">{t.value}</div>
                <div className="text-[11px] text-gray-500">{t.sub}</div>
              </button>
            ))}
          </div>

          <div className="grid lg:grid-cols-5 gap-4">
            {/* journeys */}
            <div className="lg:col-span-3 rounded-3xl bg-white border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Where is each shipment?</h3>
                <button onClick={() => onNavigate('shipping')} className="text-xs text-teal-700 flex items-center gap-1">All <ArrowRight className="w-3.5 h-3.5" /></button>
              </div>
              {journeys.length === 0 ? <p className="text-sm text-gray-500">No open shipments. Book one under Shipping when cargo is ready.</p> : (
                <div className="space-y-5">
                  {journeys.map(({ s, done, bills: n, due }) => (
                    <div key={s.no}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                        <span className="font-mono font-semibold text-gray-900 text-sm">{s.no}</span>
                        <span className="text-[11px] text-gray-500">{n} bill{n === 1 ? '' : 's'}{due > 0.5 ? ` · ${cny(due)} to pay` : ' · all paid'}{s.eta ? ` · ETA ${s.eta}` : ''}</span>
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

            {/* to do */}
            <div className="lg:col-span-2 rounded-3xl bg-white border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Today's to-do</h3>
              {todo.length === 0 ? (
                <div className="text-center py-6"><CheckCircle2 className="w-8 h-8 text-teal-400 mx-auto mb-1" /><p className="text-sm text-gray-500">Nothing waiting. All clear!</p></div>
              ) : (
                <ul className="space-y-2">
                  {todo.slice(0, 7).map((t, i) => (
                    <li key={i}>
                      <button onClick={() => onNavigate(t.view)} className="w-full flex items-start gap-3 text-left rounded-2xl px-3 py-2 hover:bg-gray-50">
                        <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${toneCls[t.tone]}`} />
                        <span className="min-w-0"><span className="block text-sm text-gray-900 truncate">{t.text}</span><span className="block text-[11px] text-gray-500">{t.sub}</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* payments per month */}
          <div className="rounded-3xl bg-white border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Paid to suppliers — last 6 months</h3>
              <span className="text-xs text-gray-500">{cny(perMonth.reduce((t, x) => t + x.v, 0))} total</span>
            </div>
            <div className="flex items-end gap-2 sm:gap-4 h-36">
              {perMonth.map((x) => (
                <div key={x.m} className="flex-1 flex flex-col items-center justify-end h-full">
                  <span className="text-[10px] text-gray-500 mb-1 tabular-nums">{x.v ? (x.v >= 1000 ? `¥${Math.round(x.v / 1000)}k` : cny(x.v)) : ''}</span>
                  <div className="w-full max-w-[48px] rounded-t-xl bg-gradient-to-t from-teal-400 to-teal-200" style={{ height: `${Math.max(x.v ? 6 : 2, (x.v / maxM) * 100)}%`, opacity: x.v ? 1 : 0.3 }} />
                  <span className="text-[11px] text-gray-500 mt-1">{new Date(x.m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short' })}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
