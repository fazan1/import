import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { moveToRecycleBin } from '../lib/recycleBin';
import { esc } from '../lib/html';
import { companyFor } from '../lib/company';
import { Plus, Trash2, Calendar, Printer, TrendingUp, Wallet, Building2, Scale, Banknote, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Sparkles, Landmark } from 'lucide-react';
import FinancialTargets from './FinancialTargets';

/* CEO Network (v121) — one record per month of the whole business.
   We own: stock (factory, shop, import), customers (shop, import), cheques, bank, property deposit.
   We owe: investor + suppliers + clearing agent + bank loan + cheques issued.
   Net capital = what we own − what we owe. Gross profit = sales − cost of sales; when cost of sales is not known it is
   estimated as sales × the usual margin % (shown as "estimate"). Net profit = gross profit − monthly expenses. */

interface FinancialRecord {
  id: string;
  date: string;
  month: string;
  total_factory_inventory: number;
  shop_stock_value: number;
  lc_stock_value: number;
  shop_receivable: number;
  cheques_in_hand: number;
  import_goods_value: number;
  factory_deposits: number;
  import_receivable: number;
  bank_balance: number;
  cash_in_hand: number;
  investor_liability: number;
  factory_investor_liability: number;
  lcl_investor_liability: number;
  supplier_payable: number;
  agent_payable: number;
  bank_loan: number;
  cheques_issued: number;
  monthly_sales: number;
  cost_of_sales: number;
  margin_percent: number;
  gross_profit: number;
  monthly_expenses: number;
  property_deposit: number;
}

const NUM_FIELDS = ['total_factory_inventory', 'shop_stock_value', 'lc_stock_value', 'shop_receivable', 'cheques_in_hand', 'import_goods_value', 'factory_deposits', 'import_receivable', 'bank_balance', 'cash_in_hand', 'investor_liability', 'factory_investor_liability', 'lcl_investor_liability', 'supplier_payable', 'agent_payable', 'bank_loan', 'cheques_issued', 'monthly_sales', 'cost_of_sales', 'margin_percent', 'gross_profit', 'monthly_expenses', 'property_deposit'] as const;
const NEW_COLS = ['supplier_payable', 'agent_payable', 'bank_loan', 'cheques_issued', 'margin_percent', 'monthly_expenses'];

function norm(row: Record<string, unknown>): FinancialRecord {
  const r = { ...row } as Record<string, unknown>;
  NUM_FIELDS.forEach((f) => { r[f] = Number(r[f]) || 0; });
  return r as unknown as FinancialRecord;
}

function formatNumber(num: number) {
  return new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}
const m = (v: number) => `Rs.${formatNumber(v)}`;
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const monthName = (date: string) => new Date(date + 'T00:00:00').toLocaleString('en-GB', { month: 'long' });
const shortDate = (date: string) => new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function calculateTotalAssets(r: FinancialRecord) {
  return r.total_factory_inventory + r.shop_stock_value + (r.lc_stock_value || 0) + r.shop_receivable + r.cheques_in_hand +
    r.import_goods_value + (r.factory_deposits || 0) + r.import_receivable + r.bank_balance + (r.cash_in_hand || 0) + r.property_deposit;
}
export function calculateTotalLiabilities(r: FinancialRecord) {
  return r.investor_liability + (r.factory_investor_liability || 0) + (r.lcl_investor_liability || 0) + (r.supplier_payable || 0) + (r.agent_payable || 0) + (r.bank_loan || 0) + (r.cheques_issued || 0);
}
function calculateNetBusinessCapital(r: FinancialRecord) { return calculateTotalAssets(r) - calculateTotalLiabilities(r); }
function calculateAssetLiabilityRatio(r: FinancialRecord) { const l = calculateTotalLiabilities(r); return l === 0 ? 0 : calculateTotalAssets(r) / l; }
function calculateReceivableDays(r: FinancialRecord) { return r.monthly_sales === 0 ? 0 : (r.shop_receivable / r.monthly_sales) * 30; }
/** gross profit: from cost of sales when typed, else sales x usual margin % (an estimate) */
function grossProfitOf(r: FinancialRecord) {
  if (r.cost_of_sales > 0) return r.monthly_sales - r.cost_of_sales;
  if (r.margin_percent > 0) return r.monthly_sales * r.margin_percent / 100;
  return 0;
}
const gpIsEstimate = (r: FinancialRecord) => !(r.cost_of_sales > 0) && r.margin_percent > 0 && r.monthly_sales > 0;
function calculateGPPercent(r: FinancialRecord) { return r.monthly_sales === 0 ? 0 : (grossProfitOf(r) / r.monthly_sales) * 100; }
function netProfitOf(r: FinancialRecord) { return grossProfitOf(r) - (r.monthly_expenses || 0); }
function calculateLiquidCash(r: FinancialRecord) { return r.bank_balance + (r.cash_in_hand || 0) + r.cheques_in_hand; }
function stockOf(r: FinancialRecord) { return r.total_factory_inventory + r.shop_stock_value + (r.lc_stock_value || 0) + r.import_goods_value; }
/** whole months between two record dates (at least 1) */
function monthsBetween(a: string, b: string) {
  const da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
  return Math.max(1, Math.round(((da.getFullYear() - db.getFullYear()) * 12 + (da.getMonth() - db.getMonth()) + (da.getDate() - db.getDate()) / 30)));
}

export default function CEONetwork() {
  const [records, setRecords] = useState<FinancialRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [needsSql, setNeedsSql] = useState(false);
  // owner's own names for the typed columns (shared across devices; empty = the default name)
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    supabase.from('capital_settings').select('value').eq('key', 'ceo_column_labels').maybeSingle()
      .then(({ data }) => { if (data?.value && typeof data.value === 'object') setLabels(data.value as Record<string, string>); });
  }, []);
  async function renameColumn(key: string, current: string, fallback: string) {
    const v = prompt(`Name for this column (leave empty to go back to "${fallback}")`, current);
    if (v === null) return;
    const next = { ...labels }; if (v.trim()) next[key] = v.trim(); else delete next[key];
    setLabels(next);
    const { error } = await supabase.from('capital_settings').upsert({ key: 'ceo_column_labels', value: next, updated_at: new Date().toISOString() });
    if (error) alert('Could not save the column name: ' + error.message + '\n(run charity-setup.sql once if the capital_settings table is missing)');
  }

  useEffect(() => {
    loadFinancialRecords();
  }, []);

  async function loadFinancialRecords() {
    setLoading(true);
    const { data, error } = await supabase.from('financial_records').select('*').order('date', { ascending: false });
    if (error) alert('Could not load the records: ' + error.message);
    else if (data) {
      setRecords(data.map((r) => norm(r as Record<string, unknown>)));
      // the new columns (ceo-network-upgrade.sql) are missing until the SQL is run
      setNeedsSql(data.length > 0 && !('supplier_payable' in (data[0] as Record<string, unknown>)));
    }
    setLoading(false);
  }

  async function updateDate(id: string, newDate: string) {
    const { error } = await supabase.from('financial_records').update({ date: newDate, month: monthName(newDate), updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { alert('Could not save the date: ' + error.message); return; }
    setRecords(records.map((r) => r.id === id ? { ...r, date: newDate, month: monthName(newDate) } : r).sort((a, b) => b.date.localeCompare(a.date)));
    setEditingDate(null);
  }

  async function addNewRecord() {
    const dateStr = localToday();
    const latest = records[0];
    if (latest && latest.date.slice(0, 7) === dateStr.slice(0, 7) && !confirm(`There is already a record for ${monthName(dateStr)}. Add another one anyway?\n\n(One record per month keeps the month-to-month comparison right — usually you just update this month's record.)`)) return;
    // start from last month's balances (stock, customers, debts move a little each month); sales and expenses start empty
    const carry: Record<string, number> = {};
    NUM_FIELDS.forEach((f) => { carry[f] = 0; });
    if (latest) ['total_factory_inventory', 'shop_stock_value', 'lc_stock_value', 'shop_receivable', 'cheques_in_hand', 'import_goods_value', 'factory_deposits', 'import_receivable', 'bank_balance', 'cash_in_hand', 'investor_liability', 'factory_investor_liability', 'lcl_investor_liability', 'property_deposit', 'supplier_payable', 'agent_payable', 'bank_loan', 'cheques_issued', 'margin_percent'].forEach((f) => { carry[f] = (latest as unknown as Record<string, number>)[f] || 0; });
    if (needsSql) NEW_COLS.forEach((f) => { delete carry[f]; });
    const { data, error } = await supabase.from('financial_records').insert([{ date: dateStr, month: monthName(dateStr), ...carry }]).select();
    if (error) { alert('Could not add the record: ' + error.message); return; }
    if (data) setRecords([norm(data[0] as Record<string, unknown>), ...records]);
  }

  async function updateCell(id: string, field: string, value: number) {
    const record = records.find((r) => r.id === id);
    if (!record) return;
    if (needsSql && NEW_COLS.includes(field)) { alert('Run ceo-network-upgrade.sql in Supabase first (MAIN project) — it adds this column.'); return; }
    const next = { ...record, [field]: value } as FinancialRecord;
    const updates: Record<string, number | string> = { [field]: value, updated_at: new Date().toISOString() };
    if (['monthly_sales', 'cost_of_sales', 'margin_percent'].includes(field)) { next.gross_profit = Math.round(grossProfitOf(next) * 100) / 100; updates.gross_profit = next.gross_profit; }
    const { error } = await supabase.from('financial_records').update(updates).eq('id', id);
    if (error) { alert('Could not save: ' + error.message); return; }
    setRecords(records.map((r) => (r.id === id ? next : r)));
  }

  async function deleteRecord(id: string) {
    const rec = records.find((r) => r.id === id);
    if (!rec || !confirm(`Delete the record of ${shortDate(rec.date)}? (A copy goes to the Recycle Bin.)`)) return;
    const bin = await moveToRecycleBin({ source_table: 'financial_records', source_id: id, record_data: rec as unknown as Record<string, unknown>, display_name: `CEO Network ${shortDate(rec.date)}`, portal: 'cn' });
    if (!bin.success) { alert('Could not copy it to the Recycle Bin, so it was not deleted: ' + (bin.error || '')); return; }
    const { error } = await supabase.from('financial_records').delete().eq('id', id);
    if (error) { alert('Could not delete: ' + error.message); return; }
    setRecords(records.filter((r) => r.id !== id));
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-[3px] border-gray-200 border-t-teal-600"></div>
        <p className="mt-4 text-sm text-gray-500">Loading records...</p>
      </div>
    );
  }

  const latest = records.length > 0 ? records[0] : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Financial Overview</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {records.length} record{records.length !== 1 ? 's' : ''} tracked{latest ? ` — latest: ${shortDate(latest.date)}` : ''} · one record per month
          </p>
        </div>
        <div className="flex items-center gap-2">
          {latest && <button onClick={() => printMonthReport(latest, records[1] || null, labels)} className="flex items-center gap-2 border border-gray-300 bg-white text-gray-800 px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50" title="One page for this month — print or save as PDF and forward">
            <Printer className="w-4 h-4" />Month report
          </button>}
          <button onClick={addNewRecord} className="flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800">
            <Plus className="w-4 h-4" />New month
          </button>
        </div>
      </div>

      {needsSql && <div className="text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-2.5">Run <b>ceo-network-upgrade.sql</b> in Supabase once (MAIN project) to turn on “We owe”, margin %, expenses and net profit.</div>}

      {latest && <SummaryCards record={latest} />}

      {latest && records.length >= 2 && <AIInsights records={records.slice(0, 6)} />}

      <FinancialTargets records={records} />

      <RecordsTable
        records={records}
        editingCell={editingCell}
        editingDate={editingDate}
        setEditingCell={setEditingCell}
        setEditingDate={setEditingDate}
        updateCell={updateCell}
        updateDate={updateDate}
        deleteRecord={deleteRecord}
        addNewRecord={addNewRecord}
        labels={labels}
        renameColumn={renameColumn}
      />
    </div>
  );
}

function SummaryCards({ record }: { record: FinancialRecord }) {
  const est = gpIsEstimate(record);
  const cards = [
    { label: 'We own', value: formatNumber(calculateTotalAssets(record)), icon: Building2, color: 'text-gray-900' },
    { label: 'We owe', value: formatNumber(calculateTotalLiabilities(record)), icon: Landmark, color: 'text-rose-700' },
    { label: 'Net capital', value: formatNumber(calculateNetBusinessCapital(record)), icon: Wallet, color: calculateNetBusinessCapital(record) >= 0 ? 'text-gray-900' : 'text-rose-700' },
    { label: 'Ready cash', value: formatNumber(calculateLiquidCash(record)), icon: Banknote, color: 'text-green-700' },
    { label: 'Monthly sales', value: formatNumber(record.monthly_sales), icon: TrendingUp, color: 'text-gray-900' },
    { label: est ? 'Gross profit (est.)' : 'Gross profit', value: formatNumber(grossProfitOf(record)), icon: TrendingUp, color: 'text-green-700' },
    { label: 'Net profit', value: formatNumber(netProfitOf(record)), icon: TrendingUp, color: netProfitOf(record) >= 0 ? 'text-green-700' : 'text-rose-700' },
    { label: 'Own ÷ owe', value: calculateAssetLiabilityRatio(record).toFixed(2), icon: Scale, color: 'text-amber-700' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="bg-white border border-gray-200 rounded-xl p-3.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{card.label}</span>
            </div>
            <p className={`text-base font-bold ${card.color} truncate`}>{card.value}</p>
          </div>
        );
      })}
    </div>
  );
}

function AIInsights({ records }: { records: FinancialRecord[] }) {
  if (records.length < 2) return null;
  const current = records[0];
  const previous = records[1];
  const gap = monthsBetween(current.date, previous.date);
  const since = `since ${shortDate(previous.date)}${gap > 1 ? ` (${gap} months)` : ''}`;

  const assetsNow = calculateTotalAssets(current), assetsBefore = calculateTotalAssets(previous);
  const owesNow = calculateTotalLiabilities(current), owesBefore = calculateTotalLiabilities(previous);
  const capNow = assetsNow - owesNow, capBefore = assetsBefore - owesBefore;
  const cashNow = calculateLiquidCash(current), cashBefore = calculateLiquidCash(previous);
  const stockNow = stockOf(current), stockBefore = stockOf(previous);
  const dAssets = assetsNow - assetsBefore, dOwes = owesNow - owesBefore, dCap = capNow - capBefore, dStock = stockNow - stockBefore;
  const stockShare = assetsNow > 0 ? (stockNow / assetsNow) * 100 : 0;
  const cashShare = assetsNow > 0 ? (cashNow / assetsNow) * 100 : 0;
  const alRatio = calculateAssetLiabilityRatio(current);
  const recvDays = calculateReceivableDays(current);
  const gpPct = calculateGPPercent(current);
  const salesGrowth = previous.monthly_sales > 0 ? ((current.monthly_sales - previous.monthly_sales) / previous.monthly_sales) * 100 : 0;
  const customersOwe = current.shop_receivable + current.import_receivable;

  const insights = { growth: [] as string[], risk: [] as string[], stock: [] as string[], liquidity: [] as string[], actions: [] as string[] };

  // --- GROWTH ---
  if (current.monthly_sales <= 0) insights.growth.push('No sales figure for this month yet — type your monthly sales so profit, margin and customer days can be worked out');
  else if (previous.monthly_sales > 0) insights.growth.push(salesGrowth > 5 ? `Sales went up ${salesGrowth.toFixed(1)}% ${since}` : salesGrowth < -5 ? `Sales went down ${Math.abs(salesGrowth).toFixed(1)}% ${since} — find out which customers or items dropped` : `Sales are about the same as before (${salesGrowth >= 0 ? '+' : ''}${salesGrowth.toFixed(1)}%)`);
  if (current.monthly_sales > 0 && grossProfitOf(current) > 0) insights.growth.push(`${gpIsEstimate(current) ? 'Estimated g' : 'G'}ross profit ${m(grossProfitOf(current))} (${gpPct.toFixed(0)}% margin)${current.monthly_expenses > 0 ? ` − expenses ${m(current.monthly_expenses)} = net profit ${m(netProfitOf(current))}` : ' — add your monthly expenses to see the net profit'}`);
  if (dAssets !== 0) {
    insights.growth.push(`What you own went ${dAssets > 0 ? 'up' : 'down'} ${m(Math.abs(dAssets))} ${since} (${m(assetsBefore)} → ${m(assetsNow)})`);
    if (dAssets > 0 && dOwes > 0) insights.growth.push(`${m(Math.min(dOwes, dAssets))} of that growth (${Math.min(100, (dOwes / dAssets) * 100).toFixed(0)}%) is borrowed money (investor, suppliers, agent, bank) — only ${m(Math.max(0, dCap))} is your own gain`);
  }
  insights.growth.push(dCap >= 0 ? `Your own capital went up ${m(dCap)} ${since}${gap > 1 ? ` — about ${m(dCap / gap)} a month` : ''}` : `Your own capital went down ${m(Math.abs(dCap))} ${since} — debts grew faster than what you own`);

  // --- RISK ---
  if (owesNow > 0) insights.risk.push(alRatio >= 2 ? `You own Rs.${alRatio.toFixed(2)} for every Rs.1 you owe — strong` : alRatio >= 1.5 ? `You own Rs.${alRatio.toFixed(2)} for every Rs.1 you owe — okay, keep it above 2` : alRatio >= 1 ? `You own only Rs.${alRatio.toFixed(2)} for every Rs.1 you owe — risky` : `WARNING: you owe more than you own (Rs.${alRatio.toFixed(2)} per Rs.1)`);
  if (current.investor_liability > 0) insights.risk.push(`Investor money: ${m(current.investor_liability)}${previous.investor_liability > 0 && current.investor_liability > previous.investor_liability * 1.2 ? ` — up from ${m(previous.investor_liability)} ${since}` : ''}`);
  if (!(current.supplier_payable || current.agent_payable || current.bank_loan || current.cheques_issued)) insights.risk.push('Only the investor is counted as a debt — add what you owe suppliers, the clearing agent, the bank and cheques you issued');
  if (cashNow > 0 && owesNow > 0) insights.risk.push(`Ready cash ${m(cashNow)} covers ${((cashNow / owesNow) * 100).toFixed(0)}% of what you owe`);
  if (current.monthly_sales > 0 && current.shop_receivable > 0) insights.risk.push(recvDays > 45 ? `Shop customers take about ${recvDays.toFixed(0)} days to pay — too long (${m(current.shop_receivable)} outstanding)` : recvDays > 30 ? `Shop customers take about ${recvDays.toFixed(0)} days to pay — aim for under 30` : `Shop customers pay in about ${recvDays.toFixed(0)} days — good`);

  // --- STOCK ---
  if (current.shop_stock_value > 0) insights.stock.push('Shop stock is counted at selling price, so “We own” and Net capital include the profit you will make when it sells — the real cost value is lower');
  insights.stock.push(`${stockShare.toFixed(0)}% of everything you own is stock (${m(stockNow)})${stockShare > 60 ? ' — most of your wealth is on shelves; if sales slow down this becomes a problem' : stockShare > 40 ? ' — a balanced level' : ' — lean, good for cash'}`);
  if (dStock > 0 && dAssets > 0 && dStock / dAssets > 0.7) insights.stock.push(`${((dStock / dAssets) * 100).toFixed(0)}% of the growth ${since} is more stock (+${m(dStock)}) — the business looks bigger, but it has not turned into money yet`);
  if (current.import_goods_value > 0) insights.stock.push(`${m(current.import_goods_value)} in import goods${previous.import_goods_value > 0 && current.import_goods_value > previous.import_goods_value * 1.5 ? ` (was ${m(previous.import_goods_value)})` : ''} — locked until sold`);
  if (current.import_receivable > 0) insights.stock.push(previous.import_receivable > 0 && Math.abs(current.import_receivable - previous.import_receivable) <= previous.import_receivable * 0.05 ? `Import customers still owe ${m(current.import_receivable)} — almost the same as ${since}: this money is not coming in` : `Import customers owe ${m(current.import_receivable)} — follow up to collect`);
  if (current.total_factory_inventory > 0 && current.total_factory_inventory > current.shop_stock_value * 2) insights.stock.push('The factory holds much more stock than the shop — move goods to where they sell');

  // --- CASH ---
  const dCash = cashNow - cashBefore;
  if (dCash !== 0) insights.liquidity.push(`Ready cash went ${dCash > 0 ? 'up' : 'down'} ${m(Math.abs(dCash))} ${since}`);
  insights.liquidity.push(`You have ${m(cashNow)} in bank, cash and cheques — ${cashShare.toFixed(0)}% of the business${cashShare < 5 ? ' — dangerously low' : cashShare < 10 ? ' — keep more for emergencies' : ' — a healthy cushion'}`);
  if (current.monthly_expenses > 0) insights.liquidity.push(`At ${m(current.monthly_expenses)} expenses a month, your cash lasts about ${(cashNow / current.monthly_expenses).toFixed(1)} months without sales`);
  else insights.liquidity.push('Add your monthly expenses (rent, salaries, transport…) to see how many months your cash lasts');

  // --- ACTIONS ---
  if (stockShare > 70 && cashShare < 5) insights.actions.push(`Slow down buying new stock: ${stockShare.toFixed(0)}% of the business is stock and only ${cashShare.toFixed(0)}% is cash. Sell what you have before the next big order`);
  if (customersOwe > 0 && cashShare < 10) {
    const target = Math.max(0, assetsNow * 0.1 - cashNow);
    insights.actions.push(`Collect from customers: ${m(customersOwe)} is outstanding (shop ${m(current.shop_receivable)}, import ${m(current.import_receivable)}). Collecting ${m(Math.min(customersOwe, target || customersOwe * 0.3))} would bring cash up to ${m(cashNow + Math.min(customersOwe, target || customersOwe * 0.3))}`);
  }
  if (current.import_goods_value > 0 && stockShare > 50) insights.actions.push(`Turn import stock into cash: push the slow-moving part of ${m(current.import_goods_value)}, even at a small discount`);
  if (current.investor_liability > 0 && dOwes > 0 && dCap < dOwes) insights.actions.push('Check the investor\'s cost: the profit on the stock you bought with investor money must be more than what you pay the investor');
  if (current.monthly_sales <= 0) insights.actions.push('Next month: type the monthly sales (and your usual margin % once) — then this page can tell you your profit and how fast stock turns');
  else if (gpPct > 0 && gpPct < 20) insights.actions.push(`Margin is ${gpPct.toFixed(0)}% — raising it to 20% would add about ${m(current.monthly_sales * 0.2 - grossProfitOf(current))} a month`);
  if (insights.actions.length === 0) insights.actions.push('Your business is in a stable position. Update next month\'s record and compare again');

  const riskLevel = (owesNow > 0 && alRatio < 1) || cashShare < 3 || recvDays > 60 ? 'high' : (owesNow > 0 && alRatio < 1.5) || cashShare < 5 || recvDays > 45 || (gpPct > 0 && gpPct < 10) ? 'medium' : 'low';
  const riskConfig = {
    low: { color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200', icon: CheckCircle, label: 'Healthy' },
    medium: { color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', icon: AlertTriangle, label: 'Needs Attention' },
    high: { color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: AlertCircle, label: 'Action Needed' },
  } as const;
  const risk = riskConfig[riskLevel];
  const RiskIcon = risk.icon;
  const Section = ({ title, icon: Icon, items, dot }: { title: string; icon: typeof TrendingUp; items: string[]; dot: string }) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-gray-900 border-b border-gray-200 pb-2"><Icon className="w-4 h-4 text-[#e8552a]" /><span className="text-sm font-semibold">{title}</span></div>
      <ul className="space-y-2.5">{items.map((item, i) => <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700 leading-relaxed"><span className={`w-1.5 h-1.5 rounded-full ${dot} mt-2 shrink-0`}></span><span>{item}</span></li>)}</ul>
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="bg-[#111111] px-5 py-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5"><Sparkles className="w-5 h-5 text-[#e8552a]" /><h3 className="text-base font-semibold text-white">What your numbers say</h3></div>
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full ${risk.bg} ${risk.border} border`}><RiskIcon className={`w-4 h-4 ${risk.color}`} /><span className={`text-xs font-semibold ${risk.color} uppercase`}>{risk.label}</span></div>
        </div>
        <p className="text-sm text-gray-300 mt-1.5">{shortDate(current.date)} compared with {shortDate(previous.date)}{gap > 1 ? ` — ${gap} months apart` : ''}</p>
      </div>
      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="How your business is growing" icon={TrendingUp} items={insights.growth} dot="bg-green-500" />
        <Section title="Things to watch" icon={AlertTriangle} items={insights.risk} dot="bg-amber-500" />
        <Section title="Where your money is sitting" icon={Building2} items={insights.stock} dot="bg-[#e8552a]" />
        <Section title="Cash you have ready" icon={Banknote} items={insights.liquidity} dot="bg-gray-500" />
      </div>
      <div className="bg-[#fafaf9] border-t border-gray-200 px-5 py-5">
        <div className="flex items-center gap-2 text-gray-900 mb-4"><Sparkles className="w-4 h-4 text-[#e8552a]" /><span className="text-sm font-bold">What to do next</span></div>
        <div className="space-y-3">
          {insights.actions.map((action, i) => (
            <div key={i} className="flex items-start gap-3 bg-white rounded-lg border border-gray-200 px-4 py-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[#111111] text-white text-xs font-bold shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-sm text-gray-700 leading-relaxed">{action}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EditableCell({ record, field, value, editingCell, setEditingCell, updateCell, estimate }: {
  record: FinancialRecord;
  field: string;
  value: number;
  editingCell: { id: string; field: string } | null;
  setEditingCell: (v: { id: string; field: string } | null) => void;
  updateCell: (id: string, field: string, value: number) => void;
  estimate?: number;   // shown (grey, with *) while nothing is typed — e.g. cost of sales from the margin %
}) {
  const [localValue, setLocalValue] = useState(value.toString());
  const isEditing = editingCell?.id === record.id && editingCell?.field === field;

  const handleBlur = () => {
    const numValue = parseFloat(localValue) || 0;
    updateCell(record.id, field, numValue);
    setEditingCell(null);
  };

  if (isEditing) {
    return (
      <input
        type="number"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleBlur();
          if (e.key === 'Escape') {
            setLocalValue(value.toString());
            setEditingCell(null);
          }
        }}
        className="w-full min-w-[100px] px-2 py-1 text-xs text-right border border-teal-400 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        autoFocus
      />
    );
  }

  return (
    <div
      onClick={() => setEditingCell({ id: record.id, field })}
      className="w-full px-2 py-1 text-right cursor-pointer hover:bg-teal-50 rounded-md text-xs tabular-nums transition-colors"
    >
      {value === 0 && estimate && estimate > 0
        ? <span className="text-gray-400 italic" title="Worked out from Sales and Margin % — type a figure to replace it">{formatNumber(estimate)}*</span>
        : formatNumber(value)}
    </div>
  );
}

interface RecordsTableProps {
  records: FinancialRecord[];
  editingCell: { id: string; field: string } | null;
  editingDate: string | null;
  setEditingCell: (v: { id: string; field: string } | null) => void;
  setEditingDate: (v: string | null) => void;
  updateCell: (id: string, field: string, value: number) => void;
  updateDate: (id: string, newDate: string) => void;
  deleteRecord: (id: string) => void;
  addNewRecord: () => void;
  labels: Record<string, string>;
  renameColumn: (key: string, current: string, fallback: string) => void;
}

const columnGroups: { label: string; color: string; columns: { key: string; label: string; computed?: (r: FinancialRecord) => number }[] }[] = [
  {
    label: 'We own',
    color: 'bg-[#e8552a]',
    columns: [
      { key: 'total_factory_inventory', label: 'Factory stock' },
      { key: 'shop_stock_value', label: 'Shop stock (sell. price)' },
      { key: 'lc_stock_value', label: 'LC-2026 stock' },
      { key: 'shop_receivable', label: 'Shop customers' },
      { key: 'cheques_in_hand', label: 'Cheques in hand' },
      { key: 'import_goods_value', label: 'Import goods' },
      { key: 'factory_deposits', label: 'Factory deposits' },
      { key: 'import_receivable', label: 'Import customers' },
      { key: 'bank_balance', label: 'Bank' },
      { key: 'cash_in_hand', label: 'Cash in hand' },
      { key: 'property_deposit', label: 'Property dep.' },
    ],
  },
  {
    label: 'We owe',
    color: 'bg-rose-600',
    columns: [
      { key: 'investor_liability', label: 'Investor' },
      { key: 'factory_investor_liability', label: 'Factory investor' },
      { key: 'lcl_investor_liability', label: 'LCL investor' },
      { key: 'supplier_payable', label: 'Suppliers' },
      { key: 'agent_payable', label: 'Clearing agent' },
      { key: 'bank_loan', label: 'Bank loan' },
      { key: 'cheques_issued', label: 'Cheques issued' },
    ],
  },
  {
    label: 'This month',
    color: 'bg-green-700',
    columns: [
      { key: 'monthly_sales', label: 'Sales' },
      { key: 'margin_percent', label: 'Margin % (20–25)' },
      { key: 'cost_of_sales', label: 'Cost of sales' },
      { key: 'gross_profit', label: 'Gross profit', computed: grossProfitOf },
      { key: 'monthly_expenses', label: 'Expenses' },
      { key: 'net_profit', label: 'Net profit', computed: netProfitOf },
    ],
  },
];

const calculatedColumns = [
  { label: 'We own', fn: calculateTotalAssets, color: 'text-gray-900 bg-gray-50' },
  { label: 'We owe', fn: calculateTotalLiabilities, color: 'text-rose-700 bg-rose-50/60' },
  { label: 'Net capital', fn: calculateNetBusinessCapital, color: 'text-gray-900 bg-gray-50' },
  { label: 'Own ÷ owe', fn: (r: FinancialRecord) => calculateAssetLiabilityRatio(r), format: (v: number) => v.toFixed(2), color: 'text-amber-700 bg-amber-50/60' },
  { label: 'Cust. days', fn: (r: FinancialRecord) => calculateReceivableDays(r), format: (v: number) => v.toFixed(0), color: 'text-amber-700 bg-amber-50/60' },
  { label: 'GP %', fn: (r: FinancialRecord) => calculateGPPercent(r), format: (v: number) => `${v.toFixed(1)}%`, color: 'text-green-700 bg-green-50/60' },
];

/** Month report: one A4 page the owner can print / save as PDF and forward (WhatsApp group). */
function printMonthReport(cur: FinancialRecord, prev: FinancialRecord | null, labels: Record<string, string>) {
  const co = companyFor();
  const n = (v: number) => formatNumber(v);
  const monthTitle = new Date(cur.date + 'T00:00:00').toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  const since = prev ? `vs ${new Date(prev.date + 'T00:00:00').toLocaleString('en-GB', { month: 'short', year: 'numeric' })}` : '';
  const chg = (a: number, b: number | null) => b === null ? '' : (a - b === 0 ? '<span class="muted">same</span>' : `<span class="${a - b > 0 ? 'up' : 'down'}">${a - b > 0 ? '+' : '−'}${n(Math.abs(a - b))}</span>`);
  const val = (r: FinancialRecord | null, k: string) => r ? (Number((r as unknown as Record<string, number>)[k]) || 0) : 0;
  const rows = (cols: { key: string; label: string }[]) => cols
    .filter((c) => val(cur, c.key) !== 0 || val(prev, c.key) !== 0)
    .map((c) => `<tr><td>${esc(labels[c.key] || c.label)}</td><td class="r">${n(val(cur, c.key))}</td>${prev ? `<td class="r">${n(val(prev, c.key))}</td><td class="r">${chg(val(cur, c.key), val(prev, c.key))}</td>` : ''}</tr>`).join('');
  const own = columnGroups.find((g) => g.label === 'We own')!.columns, owe = columnGroups.find((g) => g.label === 'We owe')!.columns;
  const assets = calculateTotalAssets(cur), liab = calculateTotalLiabilities(cur), cap = calculateNetBusinessCapital(cur), cash = calculateLiquidCash(cur);
  const pAssets = prev ? calculateTotalAssets(prev) : null, pLiab = prev ? calculateTotalLiabilities(prev) : null, pCap = prev ? calculateNetBusinessCapital(prev) : null;
  const gp = grossProfitOf(cur), np = netProfitOf(cur), est = gpIsEstimate(cur);
  const hdr = prev ? `<th class="r">${esc(monthTitle)}</th><th class="r">${esc(since.replace('vs ', ''))}</th><th class="r">Change</th>` : `<th class="r">${esc(monthTitle)}</th>`;
  const tile = (l: string, v: string, c = '') => `<div class="tile"><div class="tl">${l}</div><div class="tv ${c}">${v}</div></div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(co.short)} — ${esc(monthTitle)} report</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"><style>
body{font-family:'IBM Plex Sans',Arial,sans-serif;font-size:13px;color:#111;margin:24px;max-width:800px}
h1{font-size:22px;margin:0}h2{font-size:13px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.12em;color:#555}.muted{color:#777}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.tile{border:1px solid #ddd;border-radius:8px;padding:8px 10px}.tl{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#666}.tv{font-size:16px;font-weight:700;margin-top:2px;font-family:'IBM Plex Mono',monospace}
table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:5px 8px;text-align:left}td:first-child{text-transform:uppercase}th{background:#111;color:#fff;font-weight:600;font-size:11px}.r{text-align:right;font-family:'IBM Plex Mono',monospace}
tr.total td{font-weight:700;border-top:2px solid #111;background:#f4f3f1}.up{color:#15803d}.down{color:#b91c1c}.orange{color:#e8552a}.red{color:#b91c1c}.green{color:#15803d}
.note{font-size:11px;color:#777;margin-top:16px}.btn{position:fixed;top:10px;right:10px;background:#111;color:#fff;border:0;padding:8px 14px;border-radius:6px;cursor:pointer;font-family:inherit}
@media print{body{margin:12mm}.btn{display:none}}
</style></head><body>
<button class="btn" onclick="window.print()">Print / Save PDF</button>
<div class="hdr"><div><h1>${esc(co.name)}</h1><div class="muted">${esc(co.address)}${co.phone ? ' · ' + esc(co.phone) : ''}</div></div>
<div style="text-align:right"><div style="font-size:18px;font-weight:bold">MONTHLY REPORT</div><div style="font-size:16px">${esc(monthTitle)}</div><div class="muted">as at ${esc(shortDate(cur.date))}</div></div></div>
<div class="tiles">${tile('We own', 'Rs ' + n(assets))}${tile('We owe', 'Rs ' + n(liab), 'red')}${tile('Net capital', 'Rs ' + n(cap), cap >= 0 ? '' : 'red')}${tile('Ready cash', 'Rs ' + n(cash), 'green')}</div>
<h2>What we own</h2><table><thead><tr><th>Item</th>${hdr}</tr></thead><tbody>${rows(own)}<tr class="total"><td>Total we own</td><td class="r">${n(assets)}</td>${prev ? `<td class="r">${n(pAssets!)}</td><td class="r">${chg(assets, pAssets)}</td>` : ''}</tr></tbody></table>
<h2>What we owe</h2><table><thead><tr><th>Item</th>${hdr}</tr></thead><tbody>${rows(owe) || `<tr><td colspan="4" class="muted">Nothing owed</td></tr>`}<tr class="total"><td>Total we owe</td><td class="r">${n(liab)}</td>${prev ? `<td class="r">${n(pLiab!)}</td><td class="r">${chg(liab, pLiab)}</td>` : ''}</tr>
<tr class="total"><td>NET CAPITAL (own − owe)</td><td class="r ${cap >= 0 ? '' : 'red'}">${n(cap)}</td>${prev ? `<td class="r">${n(pCap!)}</td><td class="r">${chg(cap, pCap)}</td>` : ''}</tr></tbody></table>
<h2>This month</h2><table><thead><tr><th>Item</th>${hdr}</tr></thead><tbody>
<tr><td>Sales</td><td class="r">${n(cur.monthly_sales)}</td>${prev ? `<td class="r">${n(prev.monthly_sales)}</td><td class="r">${chg(cur.monthly_sales, prev.monthly_sales)}</td>` : ''}</tr>
${cur.cost_of_sales > 0 ? `<tr><td>Cost of sales</td><td class="r">${n(cur.cost_of_sales)}</td>${prev ? `<td class="r">${n(prev.cost_of_sales)}</td><td class="r"></td>` : ''}</tr>` : `<tr><td>Margin used</td><td class="r">${n(cur.margin_percent)}%</td>${prev ? `<td class="r">${n(prev.margin_percent)}%</td><td class="r"></td>` : ''}</tr>`}
<tr><td>Gross profit${est ? ' (estimate: sales × margin %)' : ''}</td><td class="r green">${n(gp)}</td>${prev ? `<td class="r">${n(grossProfitOf(prev))}</td><td class="r">${chg(gp, grossProfitOf(prev))}</td>` : ''}</tr>
<tr><td>Expenses</td><td class="r">${n(cur.monthly_expenses || 0)}</td>${prev ? `<td class="r">${n(prev.monthly_expenses || 0)}</td><td class="r">${chg(cur.monthly_expenses || 0, prev.monthly_expenses || 0)}</td>` : ''}</tr>
<tr class="total"><td>NET PROFIT</td><td class="r ${np >= 0 ? 'green' : 'red'}">${n(np)}</td>${prev ? `<td class="r">${n(netProfitOf(prev))}</td><td class="r">${chg(np, netProfitOf(prev))}</td>` : ''}</tr>
<tr><td>Own ÷ owe</td><td class="r">${calculateAssetLiabilityRatio(cur).toFixed(2)}</td>${prev ? `<td class="r">${calculateAssetLiabilityRatio(prev).toFixed(2)}</td><td class="r"></td>` : ''}</tr>
<tr><td>Gross profit %</td><td class="r">${calculateGPPercent(cur).toFixed(1)}%</td>${prev ? `<td class="r">${calculateGPPercent(prev).toFixed(1)}%</td><td class="r"></td>` : ''}</tr>
</tbody></table>
<p class="note">Figures typed by the owner in CEO Network. Shop stock is at selling price. ${est ? 'Gross profit is an estimate from the margin % until the cost of sales is typed. ' : ''}Printed ${esc(new Date().toLocaleDateString('en-GB'))}.</p>
</body></html>`;
  const w = window.open('', '_blank'); if (!w) { alert('Allow pop-ups to open the report'); return; }
  w.document.write(html); w.document.close();
}

function RecordsTable({
  records, editingCell, editingDate, setEditingCell, setEditingDate,
  updateCell, updateDate, deleteRecord, addNewRecord, labels, renameColumn,
}: RecordsTableProps) {
  const nameOf = (col: { key: string; label: string }) => labels[col.key] || col.label;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[#111111] text-white">
              <th rowSpan={2} className="sticky left-0 z-10 bg-[#111111] px-3 py-2 text-left font-semibold uppercase tracking-wide whitespace-nowrap border-r border-gray-700 w-28">
                Date
              </th>
              {columnGroups.map((group) => (
                <th
                  key={group.label}
                  colSpan={group.columns.length}
                  className="px-2 py-1.5 text-center font-semibold whitespace-nowrap border-r border-gray-700 text-[10px] uppercase tracking-wider"
                >
                  <span className={`inline-block px-2 py-0.5 rounded text-white text-[9px] ${group.color}`}>
                    {group.label}
                  </span>
                </th>
              ))}
              <th
                colSpan={calculatedColumns.length}
                className="px-2 py-1.5 text-center font-semibold whitespace-nowrap border-r border-gray-700 text-[10px] uppercase tracking-wider"
              >
                <span className="inline-block px-2 py-0.5 rounded bg-gray-600 text-white text-[9px]">
                  Calculated
                </span>
              </th>
              <th rowSpan={2} className="w-10"></th>
            </tr>
            <tr className="bg-gray-800 text-gray-300">
              {columnGroups.map((group) =>
                group.columns.map((col, colIdx) => (
                  <th
                    key={col.key}
                    className={`px-2 py-1.5 text-right font-medium whitespace-nowrap text-[10px] uppercase tracking-wide ${
                      colIdx === group.columns.length - 1 ? 'border-r border-gray-700' : ''
                    }`}
                  >
                    {col.computed ? nameOf(col) : <button type="button" onClick={() => renameColumn(col.key, nameOf(col), col.label)} className="uppercase tracking-wide hover:text-white hover:underline decoration-dotted underline-offset-2" title="Tap to rename this column">{nameOf(col)}</button>}
                  </th>
                ))
              )}
              {calculatedColumns.map((col, idx) => (
                <th
                  key={col.label}
                  className={`px-2 py-1.5 text-right font-medium whitespace-nowrap text-[10px] uppercase tracking-wide ${
                    idx === calculatedColumns.length - 1 ? 'border-r border-gray-700' : ''
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {records.map((record) => (
              <tr key={record.id} className="group hover:bg-gray-50/80 transition-colors">
                <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50/80 px-3 py-1.5 border-r border-gray-100 transition-colors">
                  {editingDate === record.id ? (
                    <input
                      type="date"
                      value={record.date}
                      onChange={(e) => updateDate(record.id, e.target.value)}
                      onBlur={() => setEditingDate(null)}
                      className="text-xs px-1.5 py-0.5 border border-teal-400 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500/30 w-full"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => setEditingDate(record.id)}
                      className="flex items-center gap-1.5 text-gray-800 hover:text-teal-700 font-medium text-xs transition-colors"
                    >
                      <Calendar className="w-3 h-3 text-gray-400 group-hover:text-teal-500 transition-colors" />
                      {new Date(record.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </button>
                  )}
                </td>
                {columnGroups.map((group) =>
                  group.columns.map((col, colIdx) => (
                    <td
                      key={col.key}
                      className={`px-0.5 py-0.5 ${
                        colIdx === group.columns.length - 1 ? 'border-r border-gray-100' : ''
                      }`}
                    >
                      {col.computed ? (
                        <div className="w-full px-2 py-1 text-right text-xs tabular-nums font-semibold text-green-700 bg-green-50/60 rounded-md" title={col.key === 'gross_profit' && gpIsEstimate(record) ? 'Estimate: sales × margin %' : undefined}>
                          {formatNumber(col.computed(record))}{col.key === 'gross_profit' && gpIsEstimate(record) ? '*' : ''}
                        </div>
                      ) : (
                        <EditableCell
                          record={record}
                          field={col.key}
                          value={(record as unknown as Record<string, number>)[col.key] || 0}
                          editingCell={editingCell}
                          setEditingCell={setEditingCell}
                          updateCell={updateCell}
                          estimate={col.key === 'cost_of_sales' && record.margin_percent > 0 ? record.monthly_sales * (1 - record.margin_percent / 100) : undefined}
                        />
                      )}
                    </td>
                  ))
                )}
                {calculatedColumns.map((col) => {
                  const val = col.fn(record);
                  const display = col.format ? col.format(val) : formatNumber(val);
                  return (
                    <td key={col.label} className={`px-2 py-1.5 text-right font-semibold text-xs tabular-nums ${col.color}`}>
                      {display}
                    </td>
                  );
                })}
                <td className="px-1.5 py-1.5 text-center">
                  <button
                    onClick={() => deleteRecord(record.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-md transition-all"
                    title="Delete record"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {records.length > 0 && <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">Tap a column name in the header to rename it (same name on every device). Tap a figure to change it.</p>}

      {records.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-6">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <Building2 className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-gray-600 font-medium mb-1">No financial records yet</p>
          <p className="text-sm text-gray-400 mb-5">Start tracking by adding your first record</p>
          <button
            onClick={addNewRecord}
            className="flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add First Record
          </button>
        </div>
      )}
    </div>
  );
}
