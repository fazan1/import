import { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, RefreshCw, Copy, Printer } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAllPages } from '../lib/fetchAll';
import { expenseBoth } from './NigeriaExpenses';
import { landedCosts } from '../lib/ngLanded';
import { ngPrint } from '../lib/ngPrint';

/* NIGERIA — Overview NG: the whole picture on one page. Money in goods (orders / paid / outstanding), duty & expenses,
   stock left at landed cost, sales, cost of sales, profit — all time and by month. Same landed-cost rule as Sales NG. */

interface NgItem { id: string; name: string; specification: string | null; finish: string | null; unit: string; pcs_per_ton: number | null; cost_rmb: number; is_active: boolean }
interface NgMove { id: string; item_id: string; kind: 'in' | 'out' | 'adjust'; entry_date: string; quantity: number; cost_rmb: number | null; sale_naira: number | null; rate: number | null; reference: string | null }
interface NgExpense { entry_date: string; category: string; amount: number; currency: string; rate: number | null; reference: string | null; item_id?: string | null }
interface NgPurchase { id: string; number: string; status: string; total_rmb: number; order_date: string }
interface NgPayment { purchase_id: string | null; amount_rmb: number; pay_date: string; paid_amount: number | null; paid_currency: string | null }

const n0 = (v: number) => (isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
const n2 = (v: number) => (isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—');
const monthName = (ym: string) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
const label = (i: NgItem) => [i.name, i.specification, i.finish].filter(Boolean).join(' ');

export default function NigeriaOverview() {
  const [items, setItems] = useState<NgItem[]>([]);
  const [moves, setMoves] = useState<NgMove[]>([]);
  const [expenses, setExpenses] = useState<NgExpense[]>([]);
  const [purchases, setPurchases] = useState<NgPurchase[]>([]);
  const [payments, setPayments] = useState<NgPayment[]>([]);
  const [defRate, setDefRate] = useState(0);
  const [share, setShare] = useState(0);
  const [shareBox, setShareBox] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [it, mv, ex, pu, pa, se, sp] = await Promise.all([
      fetchAllPages<NgItem>(() => supabase.from('ng_items').select('id, name, specification, finish, unit, pcs_per_ton, cost_rmb, is_active').order('name')),
      fetchAllPages<NgMove>(() => supabase.from('ng_stock').select('id, item_id, kind, entry_date, quantity, cost_rmb, sale_naira, rate, reference').order('entry_date', { ascending: false }).order('created_at', { ascending: false })),
      fetchAllPages<NgExpense>(() => supabase.from('ng_expenses').select('entry_date, category, amount, currency, rate, reference, item_id')),
      fetchAllPages<NgPurchase>(() => supabase.from('ng_purchases').select('id, number, status, total_rmb, order_date')),
      fetchAllPages<NgPayment>(() => supabase.from('ng_payments').select('purchase_id, amount_rmb, pay_date, paid_amount, paid_currency')),
      supabase.from('ng_settings').select('value').eq('key', 'rate').maybeSingle(),
      supabase.from('ng_settings').select('value').eq('key', 'partner').maybeSingle(),
    ]);
    setItems((it.data || []).map((r) => ({ ...r, cost_rmb: Number(r.cost_rmb) || 0, pcs_per_ton: r.pcs_per_ton == null ? null : Number(r.pcs_per_ton) })));
    setMoves((mv.data || []).map((m) => ({ ...m, quantity: Number(m.quantity) || 0, cost_rmb: m.cost_rmb == null ? null : Number(m.cost_rmb), sale_naira: m.sale_naira == null ? null : Number(m.sale_naira), rate: m.rate == null ? null : Number(m.rate) })));
    setExpenses((ex.data || []).map((e) => ({ ...e, amount: Number(e.amount) || 0, rate: e.rate == null ? null : Number(e.rate) })));
    setPurchases((pu.data || []).map((p) => ({ ...p, total_rmb: Number(p.total_rmb) || 0 })));
    setPayments((pa.data || []).map((p) => ({ ...p, amount_rmb: Number(p.amount_rmb) || 0, paid_amount: p.paid_amount == null ? null : Number(p.paid_amount) })));
    setDefRate(Number((se.data?.value as { naira_per_rmb?: number } | undefined)?.naira_per_rmb) || 0);
    const sh = Number((sp.data?.value as { share_pct?: number } | undefined)?.share_pct) || 0; setShare(sh); setShareBox(sh ? String(sh) : '');
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const D = useMemo(() => {
    const rate = defRate || 0;
    const goodsByRef: Record<string, number> = {}, exByRef: Record<string, number> = {};
    moves.filter((m) => m.kind === 'in' && m.reference).forEach((m) => { goodsByRef[m.reference!] = (goodsByRef[m.reference!] || 0) + (m.cost_rmb || 0); });
    let exShipRmb = 0, exGenRmb = 0, exShipNgn = 0, exGenNgn = 0;
    expenses.forEach((e) => { const b = expenseBoth(e, rate); const r = isFinite(b.rmb) ? b.rmb : 0, n = isFinite(b.ngn) ? b.ngn : 0; if (e.reference) { exByRef[e.reference] = (exByRef[e.reference] || 0) + r; exShipRmb += r; exShipNgn += n; } else { exGenRmb += r; exGenNgn += n; } });
    const L = landedCosts(items, moves, expenses, rate); const landed: Record<string, number> = {}; items.forEach((i) => { landed[i.id] = L[i.id]?.cost ?? i.cost_rmb; });
    const onHand: Record<string, number> = {}; moves.forEach((m) => { onHand[m.item_id] = (onHand[m.item_id] || 0) + (m.kind === 'out' ? -m.quantity : m.quantity); });
    const goodsIn = moves.filter((m) => m.kind === 'in').reduce((t, m) => t + (m.cost_rmb || 0), 0);
    const stockChina = items.reduce((t, i) => t + Math.max(0, onHand[i.id] || 0) * i.cost_rmb, 0);
    const stockLanded = items.reduce((t, i) => t + Math.max(0, onHand[i.id] || 0) * landed[i.id], 0);
    const live = purchases.filter((p) => p.status !== 'cancelled' && p.status !== 'draft');
    const ordered = live.reduce((t, p) => t + p.total_rmb, 0), paid = payments.reduce((t, p) => t + p.amount_rmb, 0);
    const sales = moves.filter((m) => m.kind === 'out');
    const saleOf = (s: NgMove) => { const r = s.rate || rate; const cost = r ? s.quantity * landed[s.item_id] * r : NaN; return { ngn: s.sale_naira || 0, cost, profit: isFinite(cost) ? (s.sale_naira || 0) - cost : NaN, rmb: r ? (s.sale_naira || 0) / r : NaN }; };
    const tot = sales.reduce((t, s) => { const x = saleOf(s); return { ngn: t.ngn + x.ngn, cost: t.cost + (isFinite(x.cost) ? x.cost : 0), profit: t.profit + (isFinite(x.profit) ? x.profit : 0), rmb: t.rmb + (isFinite(x.rmb) ? x.rmb : 0) }; }, { ngn: 0, cost: 0, profit: 0, rmb: 0 });
    const months: Record<string, { sales: number; cost: number; profit: number; gen: number; qty: number }> = {};
    sales.forEach((s) => { const k = s.entry_date.slice(0, 7); const r = (months[k] ||= { sales: 0, cost: 0, profit: 0, gen: 0, qty: 0 }); const x = saleOf(s); r.sales += x.ngn; r.cost += isFinite(x.cost) ? x.cost : 0; r.profit += isFinite(x.profit) ? x.profit : 0; r.qty += s.quantity; });
    expenses.filter((e) => !e.reference && e.category !== 'Partner payout' && e.category !== 'Owner withdrawal').forEach((e) => { const k = e.entry_date.slice(0, 7); const r = (months[k] ||= { sales: 0, cost: 0, profit: 0, gen: 0, qty: 0 }); const b = expenseBoth(e, rate); r.gen += isFinite(b.ngn) ? b.ngn : 0; });
    const stockRows = items.filter((i) => (onHand[i.id] || 0) !== 0).map((i) => ({ i, qty: onHand[i.id] || 0, landed: landed[i.id], value: (onHand[i.id] || 0) * landed[i.id] }));
    // profit per shipment: a sale belongs to the shipment of the item's last IN (same rule as the landed cost)
    const shipOf: Record<string, string> = {}; items.forEach((i) => { const li = moves.find((m) => m.item_id === i.id && m.kind === 'in'); shipOf[i.id] = li?.reference || '(no shipment)'; });
    const ships: Record<string, { goods: number; ex: number; pcsIn: number; pcsSold: number; sales: number; cost: number; profit: number; left: number }> = {};
    moves.filter((m) => m.kind === 'in').forEach((m) => { const k = m.reference || '(no shipment)'; const r2 = (ships[k] ||= { goods: 0, ex: 0, pcsIn: 0, pcsSold: 0, sales: 0, cost: 0, profit: 0, left: 0 }); r2.goods += m.cost_rmb || 0; r2.pcsIn += m.quantity; });
    Object.keys(exByRef).forEach((k) => { const r2 = (ships[k] ||= { goods: 0, ex: 0, pcsIn: 0, pcsSold: 0, sales: 0, cost: 0, profit: 0, left: 0 }); r2.ex += exByRef[k]; });
    sales.forEach((s) => { const k = shipOf[s.item_id]; const r2 = (ships[k] ||= { goods: 0, ex: 0, pcsIn: 0, pcsSold: 0, sales: 0, cost: 0, profit: 0, left: 0 }); const x = saleOf(s); r2.pcsSold += s.quantity; r2.sales += x.ngn; r2.cost += isFinite(x.cost) ? x.cost : 0; r2.profit += isFinite(x.profit) ? x.profit : 0; });
    stockRows.forEach((sr) => { const k = shipOf[sr.i.id]; const r2 = (ships[k] ||= { goods: 0, ex: 0, pcsIn: 0, pcsSold: 0, sales: 0, cost: 0, profit: 0, left: 0 }); r2.left += sr.value; });
    const shipRows = Object.entries(ships).sort((a, b) => a[0].localeCompare(b[0]));
    // partner: share of GROSS profit; payouts = expenses in category 'Partner payout' (general)
    const sumCat = (c: string) => expenses.filter((e) => e.category === c).reduce((t, e) => { const b = expenseBoth(e, rate); return t + (isFinite(b.ngn) ? b.ngn : 0); }, 0);
    const payouts = sumCat('Partner payout'), ownerOut = sumCat('Owner withdrawal');
    const partnerDue = tot.profit * (share / 100);
    const exGenNoPayout = exGenNgn - payouts - ownerOut;
    const distributable = tot.profit - exGenNoPayout;           // profit made so far, after running costs
    const partnerShare = distributable * (share / 100), ownerShare = distributable - partnerShare;
    return { rate, goodsIn, stockChina, stockLanded, ordered, paid, outstanding: Math.max(0, ordered - paid), exShipRmb, exShipNgn, exGenRmb, exGenNgn: exGenNoPayout, tot, months: Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])), stockRows, salesCount: sales.length, net: tot.profit - exGenNoPayout, shipRows, payouts, partnerDue, partnerBalance: partnerDue - payouts, ownerOut, distributable, partnerShare, ownerShare, inStockProfit: stockRows.reduce((t, sr) => t + sr.value, 0) };
  }, [items, moves, expenses, purchases, payments, defRate, share]);

  const lines = () => {
    const r = D.rate;
    return [
      `*NG — NIGERIA · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}*`,
      r ? `Rate: ₦${r} per RMB` : 'Rate: not set',
      '',
      '*Money in goods (RMB)*',
      `Ordered from China: ${n0(D.ordered)} · paid ${n0(D.paid)} · outstanding ${n0(D.outstanding)}`,
      `Goods received into stock: ${n0(D.goodsIn)}`,
      `Duty & clearing on shipments: ₦${n0(D.exShipNgn)} = ${n0(D.exShipRmb)} RMB`,
      '',
      '*Stock in Nigeria*',
      `At China cost: ${n0(D.stockChina)} RMB · at landed cost: ${n0(D.stockLanded)} RMB = ₦${n0(D.stockLanded * r)}`,
      '',
      '*Sales & profit (all time)*',
      `Sold: ₦${n0(D.tot.ngn)} = ${n0(D.tot.rmb)} RMB (${D.salesCount} sales)`,
      `Cost of goods (landed): ₦${n0(D.tot.cost)}`,
      `Gross profit: ₦${n0(D.tot.profit)} = ${n0(r ? D.tot.profit / r : NaN)} RMB${D.tot.ngn ? ` (${((D.tot.profit / D.tot.ngn) * 100).toFixed(0)}% of sales)` : ''}`,
      `General expenses (rent, salary…): ₦${n0(D.exGenNgn)}`,
      `Net: ₦${n0(D.net)} = ${n0(r ? D.net / r : NaN)} RMB`,
      '',
      '*By month*',
      ...D.months.map(([k, m]) => `${monthName(k)}: sold ₦${n0(m.sales)}, profit ₦${n0(m.profit)}${m.gen ? `, expenses ₦${n0(m.gen)}` : ''}`),
      '',
      '*By shipment*',
      ...D.shipRows.map(([k, sh]) => `${k}: goods ${n0(sh.goods)} RMB + duty ${n0(sh.ex)} RMB · sold ${n0(sh.pcsSold)} of ${n0(sh.pcsIn)} pcs for ₦${n0(sh.sales)} · profit so far ₦${n0(sh.profit)} · left in stock ${n0(sh.left)} RMB`),
      '',
      '*Profit portfolio*',
      `Profit made so far (after running costs): ₦${n0(D.distributable)} = ${n0(r ? D.distributable / r : NaN)} RMB`,
      share ? `Partner ${share}%: share ₦${n0(D.partnerShare)} · pulled out ₦${n0(D.payouts)} · can pull out ₦${n0(D.partnerShare - D.payouts)}` : 'Partner share % not set yet',
      share ? `Owner ${100 - share}%: share ₦${n0(D.ownerShare)} · pulled out ₦${n0(D.ownerOut)} · can pull out ₦${n0(D.ownerShare - D.ownerOut)}` : '',
      `Still in stock (landed): ${n0(D.stockLanded)} RMB — profit on it comes when sold`,
    ];
  };
  async function saveShare() {
    const v = parseFloat(shareBox); if (!isFinite(v) || v < 0 || v > 100) { alert("Type the partner's share of the profit as a percentage, e.g. 50."); return; }
    const { error } = await supabase.from('ng_settings').upsert({ key: 'partner', value: { share_pct: v }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) { alert('Could not save: ' + error.message); return; }
    setShare(v); alert(`Partner share saved: ${v}% of the gross profit.`);
  }
  async function copySummary() { const t = lines().join('\n'); try { await navigator.clipboard.writeText(t); alert('Summary copied — paste it into WhatsApp.'); } catch { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); alert('Summary copied — paste it into WhatsApp.'); } }
  function printPage() {
    ngPrint('Overview NG', `as at ${new Date().toLocaleDateString('en-GB')} · rate ₦${D.rate || '—'} / RMB`, [
      { title: 'Money', head: ['', 'Amount'], right: [1], rows: [['Ordered from China (RMB)', n2(D.ordered)], ['Paid to China (RMB)', n2(D.paid)], ['Outstanding to China (RMB)', n2(D.outstanding)], ['Goods received into stock (RMB)', n2(D.goodsIn)], ['Duty & clearing on shipments (₦)', n2(D.exShipNgn)], ['Stock in Nigeria at landed cost (RMB)', n2(D.stockLanded)], ['Sold (₦)', n2(D.tot.ngn)], ['Cost of goods sold, landed (₦)', n2(D.tot.cost)], ['Gross profit (₦)', n2(D.tot.profit)], ['General expenses (₦)', n2(D.exGenNgn)], ['Net (₦)', n2(D.net)]] },
      { title: 'By month', head: ['Month', 'Pcs sold', 'Sold ₦', 'Cost ₦', 'Profit ₦', 'General expenses ₦', 'Net ₦'], right: [1, 2, 3, 4, 5, 6], rows: D.months.map(([k, m]) => [monthName(k), n0(m.qty), n0(m.sales), n0(m.cost), n0(m.profit), n0(m.gen), n0(m.profit - m.gen)]) },
      { title: 'By shipment', head: ['Shipment', 'Goods RMB', 'Duty & clearing RMB', 'Pcs in', 'Pcs sold', 'Sold ₦', 'Cost ₦', 'Profit so far ₦', 'Left in stock RMB'], right: [1, 2, 3, 4, 5, 6, 7, 8], rows: D.shipRows.map(([k, sh]) => [k, n0(sh.goods), n0(sh.ex), n0(sh.pcsIn), n0(sh.pcsSold), n0(sh.sales), n0(sh.cost), n0(sh.profit), n0(sh.left)]) },
      { title: 'Profit portfolio', head: ['', 'Share ₦', 'Pulled out ₦', 'Can pull out ₦'], right: [1, 2, 3], rows: [[`Partner (${share}%)`, n0(D.partnerShare), n0(D.payouts), n0(D.partnerShare - D.payouts)], [`Owner (${100 - share}%)`, n0(D.ownerShare), n0(D.ownerOut), n0(D.ownerShare - D.ownerOut)]], total: ['Profit made so far (after running costs)', n0(D.distributable), n0(D.payouts + D.ownerOut), n0(D.distributable - D.payouts - D.ownerOut)] },
      { title: 'Stock left', head: ['Item', 'On hand', 'Landed cost (RMB)', 'Value (RMB)'], right: [1, 2, 3], rows: D.stockRows.map((s) => [label(s.i), `${n0(s.qty)} ${s.i.unit}`, s.landed.toLocaleString('en-US', { maximumFractionDigits: 4 }), n2(s.value)]), total: ['Total', '', '', n2(D.stockLanded)] },
    ]);
  }

  if (loading) return <div className="p-8 text-center text-gray-500">Loading…</div>;
  const Tile = ({ l, v, s, tone }: { l: string; v: string; s?: string; tone?: string }) => <div className="bg-white rounded-xl border border-gray-200 p-4"><div className="text-xs text-gray-500 uppercase tracking-wide">{l}</div><div className={`text-lg font-semibold font-mono ${tone || 'text-gray-900'}`}>{v}</div>{s && <div className="text-xs text-gray-500">{s}</div>}</div>;
  const r = D.rate;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><LayoutDashboard className="w-6 h-6 text-[#e8552a]" /> Nigeria — Overview NG</h1>
          <p className="text-sm text-gray-500">The whole picture: money in goods, duty, stock, sales and profit. {r ? `Rate ₦${r} per RMB.` : 'Save the rate in Expenses NG to see Naira values.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button onClick={printPage} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50"><Printer className="w-4 h-4" /> Print / PDF</button>
          <button onClick={copySummary} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-[#111] rounded-lg hover:opacity-90"><Copy className="w-4 h-4" /> Copy summary</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile l="Ordered from China" v={`${n0(D.ordered)} RMB`} s={`paid ${n0(D.paid)} · outstanding ${n0(D.outstanding)}`} />
        <Tile l="Duty & clearing" v={`₦${n0(D.exShipNgn)}`} s={`${n0(D.exShipRmb)} RMB on shipments`} />
        <Tile l="Stock in Nigeria (landed)" v={`${n0(D.stockLanded)} RMB`} s={r ? `₦${n0(D.stockLanded * r)} · China cost ${n0(D.stockChina)} RMB` : `China cost ${n0(D.stockChina)} RMB`} />
        <Tile l="Sold (all time)" v={`₦${n0(D.tot.ngn)}`} s={`${D.salesCount} sales · ${n0(D.tot.rmb)} RMB`} />
        <Tile l="Cost of goods sold" v={`₦${n0(D.tot.cost)}`} s="at landed cost" />
        <Tile l="Gross profit" v={`₦${n0(D.tot.profit)}`} s={`${D.tot.ngn ? ((D.tot.profit / D.tot.ngn) * 100).toFixed(0) + '% of sales · ' : ''}${n0(r ? D.tot.profit / r : NaN)} RMB`} tone={D.tot.profit >= 0 ? 'text-green-700' : 'text-red-600'} />
        <Tile l="General expenses" v={`₦${n0(D.exGenNgn)}`} s="rent, salary, bank… (not on a shipment)" />
        <Tile l="Net" v={`₦${n0(D.net)}`} s={`${n0(r ? D.net / r : NaN)} RMB`} tone={D.net >= 0 ? 'text-green-700' : 'text-red-600'} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide mb-2">Money flow — all time</h3>
        <div className="text-sm space-y-1 max-w-lg">
          <div className="flex justify-between"><span className="text-gray-600">Goods received into stock (China cost)</span><span className="font-mono">{n0(D.goodsIn)} RMB</span></div>
          <div className="flex justify-between"><span className="text-gray-600">+ duty & clearing on shipments</span><span className="font-mono">{n0(D.exShipRmb)} RMB</span></div>
          <div className="flex justify-between border-t border-gray-200 pt-1"><span className="text-gray-600">= landed cost of all goods</span><span className="font-mono">{n0(D.goodsIn + D.exShipRmb)} RMB</span></div>
          <div className="flex justify-between"><span className="text-gray-600">− still in stock (landed)</span><span className="font-mono">{n0(D.stockLanded)} RMB</span></div>
          <div className="flex justify-between"><span className="text-gray-600">= cost of what was sold</span><span className="font-mono">{n0(r ? D.tot.cost / r : NaN)} RMB</span></div>
          <div className="flex justify-between"><span className="text-gray-600">Sold for</span><span className="font-mono">{n0(D.tot.rmb)} RMB</span></div>
          <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold"><span>Gross profit</span><span className={`font-mono ${D.tot.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n0(r ? D.tot.profit / r : NaN)} RMB = ₦{n0(D.tot.profit)}</span></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <div className="px-4 py-2 border-b border-gray-200 text-xs font-semibold text-gray-800 uppercase tracking-wide">Profit by shipment</div>
        <table className="w-full text-sm min-w-[820px]">
          <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase"><th className="text-left px-4 py-2">Shipment</th><th className="text-right px-4 py-2">Goods RMB</th><th className="text-right px-4 py-2">Duty & clearing RMB</th><th className="text-right px-4 py-2">Sold / in (pcs)</th><th className="text-right px-4 py-2">Sold ₦</th><th className="text-right px-4 py-2">Cost ₦</th><th className="text-right px-4 py-2">Profit so far ₦</th><th className="text-right px-4 py-2">Left in stock RMB</th></tr></thead>
          <tbody>
            {D.shipRows.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-500">No shipments yet.</td></tr>}
            {D.shipRows.map(([k, sh]) => <tr key={k} className="border-t border-gray-100"><td className="px-4 py-2 font-medium">{k}</td><td className="px-4 py-2 text-right font-mono">{n0(sh.goods)}</td><td className="px-4 py-2 text-right font-mono">{n0(sh.ex)}</td><td className="px-4 py-2 text-right font-mono">{n0(sh.pcsSold)} / {n0(sh.pcsIn)}</td><td className="px-4 py-2 text-right font-mono">{n0(sh.sales)}</td><td className="px-4 py-2 text-right font-mono">{n0(sh.cost)}</td><td className={`px-4 py-2 text-right font-mono font-semibold ${sh.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n0(sh.profit)}</td><td className="px-4 py-2 text-right font-mono">{n0(sh.left)}</td></tr>)}
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-gray-500">Profit so far = sales of that shipment's items − their landed cost. The rest of the profit is still in "Left in stock".</p>
      </div>

      <p className="text-xs text-gray-500">Profit of each sale and what each partner can pull out: see <b>Profit NG</b>.</p>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase"><th className="text-left px-4 py-2">Month</th><th className="text-right px-4 py-2">Pcs sold</th><th className="text-right px-4 py-2">Sold ₦</th><th className="text-right px-4 py-2">Cost ₦</th><th className="text-right px-4 py-2">Profit ₦</th><th className="text-right px-4 py-2">General expenses ₦</th><th className="text-right px-4 py-2">Net ₦</th></tr></thead>
          <tbody>
            {D.months.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No sales yet.</td></tr>}
            {D.months.map(([k, m]) => <tr key={k} className="border-t border-gray-100"><td className="px-4 py-2 font-medium">{monthName(k)}</td><td className="px-4 py-2 text-right font-mono">{n0(m.qty)}</td><td className="px-4 py-2 text-right font-mono">{n0(m.sales)}</td><td className="px-4 py-2 text-right font-mono">{n0(m.cost)}</td><td className={`px-4 py-2 text-right font-mono ${m.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n0(m.profit)}</td><td className="px-4 py-2 text-right font-mono">{n0(m.gen)}</td><td className={`px-4 py-2 text-right font-mono font-semibold ${m.profit - m.gen >= 0 ? 'text-green-700' : 'text-red-600'}`}>{n0(m.profit - m.gen)}</td></tr>)}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase"><th className="text-left px-4 py-2">Stock left</th><th className="text-right px-4 py-2">On hand</th><th className="text-right px-4 py-2">Landed cost (RMB)</th><th className="text-right px-4 py-2">Value (RMB)</th><th className="text-right px-4 py-2">Value (₦)</th></tr></thead>
          <tbody>
            {D.stockRows.map((s) => <tr key={s.i.id} className="border-t border-gray-100"><td className="px-4 py-2">{label(s.i)}</td><td className="px-4 py-2 text-right font-mono">{n0(s.qty)} <span className="text-xs text-gray-400">{s.i.unit}</span></td><td className="px-4 py-2 text-right font-mono">{s.landed.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td><td className="px-4 py-2 text-right font-mono">{n2(s.value)}</td><td className="px-4 py-2 text-right font-mono">{r ? n0(s.value * r) : '—'}</td></tr>)}
            {D.stockRows.length > 0 && <tr className="border-t-2 border-gray-900 font-semibold"><td className="px-4 py-2" colSpan={3}>Total</td><td className="px-4 py-2 text-right font-mono">{n2(D.stockLanded)}</td><td className="px-4 py-2 text-right font-mono">{r ? n0(D.stockLanded * r) : '—'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
