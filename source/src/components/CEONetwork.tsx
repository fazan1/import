import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Calendar, TrendingUp, Wallet, Building2, Scale, Clock, Percent, Banknote, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, CircleAlert as AlertCircle, Sparkles } from 'lucide-react';
import FinancialTargets from './FinancialTargets';

interface FinancialRecord {
  id: string;
  date: string;
  month: string;
  total_factory_inventory: number;
  shop_stock_value: number;
  shop_receivable: number;
  cheques_in_hand: number;
  import_goods_value: number;
  import_receivable: number;
  bank_balance: number;
  investor_liability: number;
  monthly_sales: number;
  cost_of_sales: number;
  gross_profit: number;
  property_deposit: number;
}

function formatNumber(num: number) {
  return new Intl.NumberFormat('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function calculateTotalAssets(record: FinancialRecord) {
  return record.total_factory_inventory + record.shop_stock_value +
    record.shop_receivable + record.cheques_in_hand +
    record.import_goods_value + record.import_receivable +
    record.bank_balance + record.property_deposit;
}

function calculateNetBusinessCapital(record: FinancialRecord) {
  return calculateTotalAssets(record) - record.investor_liability;
}

function calculateAssetLiabilityRatio(record: FinancialRecord) {
  if (record.investor_liability === 0) return 0;
  return calculateTotalAssets(record) / record.investor_liability;
}

function calculateReceivableDays(record: FinancialRecord) {
  if (record.monthly_sales === 0) return 0;
  return (record.shop_receivable / record.monthly_sales) * 30;
}

function calculateGPPercent(record: FinancialRecord) {
  if (record.monthly_sales === 0) return 0;
  return (record.gross_profit / record.monthly_sales) * 100;
}

function calculateLiquidCash(record: FinancialRecord) {
  return record.bank_balance + record.cheques_in_hand;
}

export default function CEONetwork() {
  const [records, setRecords] = useState<FinancialRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editingDate, setEditingDate] = useState<string | null>(null);

  useEffect(() => {
    loadFinancialRecords();
  }, []);

  async function loadFinancialRecords() {
    setLoading(true);
    const { data, error } = await supabase
      .from('financial_records')
      .select('*')
      .order('date', { ascending: false });

    if (error) {
      console.error('Error loading financial records:', error);
    } else if (data) {
      setRecords(data);
    }
    setLoading(false);
  }

  async function updateDate(id: string, newDate: string) {
    const monthStr = new Date(newDate + 'T00:00:00').toLocaleString('default', { month: 'long' });
    await supabase
      .from('financial_records')
      .update({ date: newDate, month: monthStr, updated_at: new Date().toISOString() })
      .eq('id', id);

    setRecords(records.map(r => r.id === id ? { ...r, date: newDate, month: monthStr } : r));
    setEditingDate(null);
  }

  async function addNewRecord() {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const monthStr = today.toLocaleString('default', { month: 'long' });

    const { data } = await supabase
      .from('financial_records')
      .insert([{
        date: dateStr,
        month: monthStr,
        total_factory_inventory: 0,
        shop_stock_value: 0,
        shop_receivable: 0,
        cheques_in_hand: 0,
        import_goods_value: 0,
        import_receivable: 0,
        bank_balance: 0,
        investor_liability: 0,
        monthly_sales: 0,
        cost_of_sales: 0,
        gross_profit: 0,
        property_deposit: 0,
      }])
      .select();

    if (data) {
      setRecords([data[0], ...records]);
    }
  }

  async function updateCell(id: string, field: string, value: number) {
    const record = records.find(r => r.id === id);
    const updates: Record<string, number | string> = { [field]: value, updated_at: new Date().toISOString() };

    if (field === 'monthly_sales' && record) {
      updates.gross_profit = value - record.cost_of_sales;
    } else if (field === 'cost_of_sales' && record) {
      updates.gross_profit = record.monthly_sales - value;
    }

    await supabase
      .from('financial_records')
      .update(updates)
      .eq('id', id);

    setRecords(records.map(r => {
      if (r.id !== id) return r;
      const updated = { ...r, [field]: value };
      if (field === 'monthly_sales' || field === 'cost_of_sales') {
        updated.gross_profit = updated.monthly_sales - updated.cost_of_sales;
      }
      return updated;
    }));
  }

  async function deleteRecord(id: string) {
    await supabase
      .from('financial_records')
      .delete()
      .eq('id', id);

    setRecords(records.filter(r => r.id !== id));
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Financial Overview</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {records.length} record{records.length !== 1 ? 's' : ''} tracked
            {latest ? ` -- Latest: ${new Date(latest.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
          </p>
        </div>
        <button
          onClick={addNewRecord}
          className="flex items-center gap-2 bg-gray-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 active:bg-gray-950 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          New Record
        </button>
      </div>

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
      />
    </div>
  );
}

function SummaryCards({ record }: { record: FinancialRecord }) {
  const totalAssets = calculateTotalAssets(record);
  const netCapital = calculateNetBusinessCapital(record);
  const liquidCash = calculateLiquidCash(record);
  const alRatio = calculateAssetLiabilityRatio(record);
  const recvDays = calculateReceivableDays(record);
  const gpPct = calculateGPPercent(record);

  const cards = [
    { label: 'Total Assets', value: formatNumber(totalAssets), icon: Building2, color: 'text-teal-700', bg: 'bg-teal-50', border: 'border-teal-100' },
    { label: 'Net Capital', value: formatNumber(netCapital), icon: Wallet, color: 'text-teal-700', bg: 'bg-teal-50', border: 'border-blue-100' },
    { label: 'Liquid Cash', value: formatNumber(liquidCash), icon: Banknote, color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-100' },
    { label: 'Monthly Sales', value: formatNumber(record.monthly_sales), icon: TrendingUp, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-100' },
    { label: 'Gross Profit', value: formatNumber(record.gross_profit), icon: TrendingUp, color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-100' },
    { label: 'A/L Ratio', value: alRatio.toFixed(2), icon: Scale, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-100' },
    { label: 'Recv. Days', value: `${recvDays.toFixed(0)}d`, icon: Clock, color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-100' },
    { label: 'GP %', value: `${gpPct.toFixed(1)}%`, icon: Percent, color: 'text-cyan-700', bg: 'bg-cyan-50', border: 'border-cyan-100' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className={`${card.bg} border ${card.border} rounded-xl p-3.5 transition-shadow hover:shadow-md`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className={`w-3.5 h-3.5 ${card.color}`} />
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

  const currentLiquidCash = calculateLiquidCash(current);
  const previousLiquidCash = calculateLiquidCash(previous);
  const currentTotalAssets = calculateTotalAssets(current);
  const previousTotalAssets = calculateTotalAssets(previous);
  const currentNetCapital = calculateNetBusinessCapital(current);
  const previousNetCapital = calculateNetBusinessCapital(previous);

  const salesGrowth = previous.monthly_sales > 0
    ? ((current.monthly_sales - previous.monthly_sales) / previous.monthly_sales) * 100
    : 0;
  const assetGrowth = previousTotalAssets > 0
    ? ((currentTotalAssets - previousTotalAssets) / previousTotalAssets) * 100
    : 0;
  const capitalGrowth = previousNetCapital > 0
    ? ((currentNetCapital - previousNetCapital) / previousNetCapital) * 100
    : 0;
  const liquidCashChange = currentLiquidCash - previousLiquidCash;

  const alRatio = calculateAssetLiabilityRatio(current);
  const recvDays = calculateReceivableDays(current);
  const gpPct = calculateGPPercent(current);

  const totalInventory = current.total_factory_inventory + current.shop_stock_value + current.import_goods_value;
  const inventoryToAssets = currentTotalAssets > 0 ? (totalInventory / currentTotalAssets) * 100 : 0;
  const liquidCashToAssets = currentTotalAssets > 0 ? (currentLiquidCash / currentTotalAssets) * 100 : 0;
  const investorLiabilityRatio = currentTotalAssets > 0 ? (current.investor_liability / currentTotalAssets) * 100 : 0;

  const insights = {
    growth: [] as string[],
    risk: [] as string[],
    stock: [] as string[],
    liquidity: [] as string[],
    actions: [] as string[],
  };

  // --- GROWTH (plain English) ---
  if (salesGrowth > 5) {
    insights.growth.push(`Your sales jumped ${salesGrowth.toFixed(1)}% compared to last month - great momentum, keep doing what is working`);
  } else if (salesGrowth < -5) {
    insights.growth.push(`Your sales dropped ${Math.abs(salesGrowth).toFixed(1)}% compared to last month - something changed and you need to find out why`);
  } else if (current.monthly_sales > 0) {
    insights.growth.push(`Sales stayed flat compared to last month (no significant change)`);
  } else {
    insights.growth.push(`No sales recorded this month yet - add your monthly sales figure to get insights`);
  }

  if (gpPct >= 20) {
    insights.growth.push(`For every Rs.100 you sell, you keep Rs.${gpPct.toFixed(0)} as profit - that is a healthy margin`);
  } else if (gpPct >= 10) {
    insights.growth.push(`For every Rs.100 you sell, you only keep Rs.${gpPct.toFixed(0)} as profit - you could be making more if you negotiate better costs or increase prices`);
  } else if (gpPct > 0) {
    insights.growth.push(`You are only keeping Rs.${gpPct.toFixed(0)} out of every Rs.100 sold - this is very thin and risky. You need to either raise prices or find cheaper suppliers`);
  }

  if (assetGrowth > 0) {
    insights.growth.push(`Your total assets grew ${assetGrowth.toFixed(1)}% - this means your business is accumulating more value (went from ${formatNumber(previousTotalAssets)} to ${formatNumber(currentTotalAssets)})`);
  } else if (assetGrowth < -5) {
    insights.growth.push(`Your total business value shrank by ${Math.abs(assetGrowth).toFixed(1)}% - you lost ${formatNumber(Math.abs(currentTotalAssets - previousTotalAssets))} in assets`);
  }

  if (capitalGrowth > 0) {
    insights.growth.push(`Net capital grew ${capitalGrowth.toFixed(1)}% - you are building equity and the business is getting stronger`);
  } else if (capitalGrowth < 0) {
    insights.growth.push(`Your net capital dropped ${Math.abs(capitalGrowth).toFixed(1)}% - this means your debts are growing faster than your assets`);
  }

  // --- RISK (plain English) ---
  if (alRatio >= 2.0) {
    insights.risk.push(`For every Rs.1 you owe, you own Rs.${alRatio.toFixed(2)} worth of assets - this is a strong and safe position`);
  } else if (alRatio >= 1.5) {
    insights.risk.push(`For every Rs.1 you owe, you own Rs.${alRatio.toFixed(2)} - this is okay but keep an eye on it. You want this number above 2.0`);
  } else if (alRatio > 1.0) {
    insights.risk.push(`For every Rs.1 you owe, you only own Rs.${alRatio.toFixed(2)} - this is risky because your assets barely cover what you owe`);
  } else {
    insights.risk.push(`WARNING: You owe more than you own. For every Rs.1 of debt, you only have Rs.${alRatio.toFixed(2)} in assets. This needs immediate attention`);
  }

  if (current.monthly_sales > 0) {
    if (recvDays > 45) {
      insights.risk.push(`Your customers are taking ${recvDays.toFixed(0)} days to pay you - that is way too long. You have Rs.${formatNumber(current.shop_receivable)} stuck with customers right now`);
    } else if (recvDays > 30) {
      insights.risk.push(`Your customers take about ${recvDays.toFixed(0)} days to pay you - ideally this should be under 30 days. Rs.${formatNumber(current.shop_receivable)} is waiting to be collected`);
    } else {
      insights.risk.push(`Your customers pay you within ${recvDays.toFixed(0)} days on average - that is good cash flow`);
    }
  }

  if (investorLiabilityRatio > 50) {
    insights.risk.push(`More than half (${investorLiabilityRatio.toFixed(0)}%) of your business value belongs to investors/lenders - you are heavily dependent on borrowed money`);
  } else if (current.investor_liability > 0) {
    insights.risk.push(`You owe Rs.${formatNumber(current.investor_liability)} to investors - that is ${investorLiabilityRatio.toFixed(0)}% of your total business value, which is manageable`);
  }

  // --- STOCK (plain English) ---
  if (inventoryToAssets > 60) {
    insights.stock.push(`${inventoryToAssets.toFixed(0)}% of your money is tied up in stock (Rs.${formatNumber(totalInventory)}) - most of your wealth is sitting on shelves. If sales slow down, this becomes a big problem`);
  } else if (inventoryToAssets > 40) {
    insights.stock.push(`${inventoryToAssets.toFixed(0)}% of your money is in stock (Rs.${formatNumber(totalInventory)}) - this is a balanced level for your type of business`);
  } else {
    insights.stock.push(`Only ${inventoryToAssets.toFixed(0)}% of your assets are in stock (Rs.${formatNumber(totalInventory)}) - you are running lean, which is good for cash flow`);
  }

  if (current.total_factory_inventory > 0 && current.total_factory_inventory > current.shop_stock_value * 2) {
    insights.stock.push(`Your factory has much more stock than your shop - move more goods to the shop so they can be sold faster`);
  }

  if (current.import_goods_value > 0) {
    insights.stock.push(`You have Rs.${formatNumber(current.import_goods_value)} worth of imported goods - this money is locked until these items are sold`);
  }

  if (current.import_receivable > 0) {
    insights.stock.push(`Rs.${formatNumber(current.import_receivable)} is owed to you from import sales - follow up to collect this`);
  }

  // --- LIQUIDITY (plain English) ---
  if (liquidCashChange > 0) {
    insights.liquidity.push(`Your ready cash went UP by Rs.${formatNumber(liquidCashChange)} compared to last month - you have more money available to spend`);
  } else if (liquidCashChange < 0) {
    insights.liquidity.push(`Your ready cash went DOWN by Rs.${formatNumber(Math.abs(liquidCashChange))} compared to last month - you spent more than you collected`);
  }

  insights.liquidity.push(`Right now you have Rs.${formatNumber(currentLiquidCash)} in cash and cheques that you can use immediately`);

  if (liquidCashToAssets < 5) {
    insights.liquidity.push(`Only ${liquidCashToAssets.toFixed(0)}% of your business value is in cash - this is dangerously low. If an unexpected bill comes, you might struggle to pay it`);
  } else if (liquidCashToAssets < 10) {
    insights.liquidity.push(`${liquidCashToAssets.toFixed(0)}% of your business is in cash - this is okay but try to keep more cash handy for emergencies`);
  } else {
    insights.liquidity.push(`${liquidCashToAssets.toFixed(0)}% of your business is in cash - you have a healthy safety cushion`);
  }

  const monthlyBurn = current.cost_of_sales;
  if (monthlyBurn > 0 && currentLiquidCash > 0) {
    const monthsCovered = currentLiquidCash / monthlyBurn;
    if (monthsCovered >= 2) {
      insights.liquidity.push(`If all sales stopped today, your cash would last about ${monthsCovered.toFixed(1)} months to pay bills - that is a good safety net`);
    } else {
      insights.liquidity.push(`If sales stopped today, your cash would only last ${monthsCovered.toFixed(1)} months - you need to build a bigger cash reserve`);
    }
  }

  // --- WHAT TO DO NEXT (actionable future ideas) ---
  if (current.shop_receivable > 0 && recvDays > 25) {
    const halfReceivable = current.shop_receivable / 2;
    insights.actions.push(`Chase your customers who owe you money. If you collect even half (Rs.${formatNumber(halfReceivable)}), your bank balance would more than double`);
  }

  if (gpPct > 0 && gpPct < 20 && current.monthly_sales > 0) {
    const targetGP = current.monthly_sales * 0.20;
    const extraProfit = targetGP - current.gross_profit;
    if (extraProfit > 0) {
      insights.actions.push(`If you can improve your profit margin to 20% (by negotiating 5-10% better prices from suppliers or raising your selling prices slightly), you would earn an extra Rs.${formatNumber(extraProfit)} per month`);
    }
  }

  if (inventoryToAssets > 50 && current.import_goods_value > 0) {
    insights.actions.push(`You have Rs.${formatNumber(current.import_goods_value)} in import stock. Focus on selling slow-moving items even at a small discount - getting cash back is better than stock sitting for months`);
  }

  if (liquidCashToAssets < 10 && current.shop_receivable > 0) {
    insights.actions.push(`Your cash is low but Rs.${formatNumber(current.shop_receivable)} is sitting with customers. Set a target: collect at least Rs.${formatNumber(current.shop_receivable * 0.3)} this week by following up on overdue payments`);
  }

  if (salesGrowth <= 0 && current.monthly_sales > 0) {
    insights.actions.push(`Your sales are not growing. Consider: offer small discounts for bulk orders, reach out to 5 old customers who have not bought recently, or add 1-2 new products your customers are asking for`);
  } else if (salesGrowth > 5) {
    insights.actions.push(`Sales are growing nicely. Now is the time to stock up on your best-selling items so you do not run out and lose orders`);
  }

  if (current.investor_liability > 0 && investorLiabilityRatio > 30) {
    const monthlyPayTarget = current.investor_liability * 0.05;
    insights.actions.push(`Try to pay back at least Rs.${formatNumber(monthlyPayTarget)} per month to your investors. Reducing debt by even 5% per month will save you money long-term and give you more control`);
  }

  if (currentLiquidCash > 0 && monthlyBurn > 0) {
    const targetReserve = monthlyBurn * 3;
    if (currentLiquidCash < targetReserve) {
      insights.actions.push(`Your safe cash target should be Rs.${formatNumber(targetReserve)} (3 months of expenses). You need Rs.${formatNumber(targetReserve - currentLiquidCash)} more to reach this. Set aside a small amount each week`);
    }
  }

  if (insights.actions.length === 0) {
    insights.actions.push(`Your business is in a stable position. Keep doing what you are doing and review again next month`);
  }

  const getRiskLevel = () => {
    if (alRatio < 1.0 || liquidCashToAssets < 3 || recvDays > 60) return 'high';
    if (alRatio < 1.5 || liquidCashToAssets < 5 || recvDays > 45 || gpPct < 10) return 'medium';
    return 'low';
  };

  const riskLevel = getRiskLevel();

  const riskConfig = {
    low: { color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', icon: CheckCircle, label: 'Healthy' },
    medium: { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', icon: AlertTriangle, label: 'Needs Attention' },
    high: { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', icon: AlertCircle, label: 'Action Needed' },
  };

  const risk = riskConfig[riskLevel];
  const RiskIcon = risk.icon;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h3 className="text-base font-semibold text-white">AI Financial Analysis</h3>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full ${risk.bg} ${risk.border} border`}>
            <RiskIcon className={`w-4 h-4 ${risk.color}`} />
            <span className={`text-xs font-semibold ${risk.color} uppercase`}>{risk.label}</span>
          </div>
        </div>
        <p className="text-sm text-gray-400 mt-1.5">Here is what the analysis is telling you about your business:</p>
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-700 border-b border-emerald-100 pb-2">
            <TrendingUp className="w-4 h-4" />
            <span className="text-sm font-semibold">How Your Business Is Growing</span>
          </div>
          <ul className="space-y-2.5">
            {insights.growth.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700 leading-relaxed">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-2 shrink-0"></span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-amber-700 border-b border-amber-100 pb-2">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-semibold">Things to Watch Out For</span>
          </div>
          <ul className="space-y-2.5">
            {insights.risk.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700 leading-relaxed">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-2 shrink-0"></span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-teal-700 border-b border-teal-100 pb-2">
            <Building2 className="w-4 h-4" />
            <span className="text-sm font-semibold">Where Your Money Is Sitting</span>
          </div>
          <ul className="space-y-2.5">
            {insights.stock.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700 leading-relaxed">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-2 shrink-0"></span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-teal-700 border-b border-blue-100 pb-2">
            <Banknote className="w-4 h-4" />
            <span className="text-sm font-semibold">How Much Cash You Have Ready</span>
          </div>
          <ul className="space-y-2.5">
            {insights.liquidity.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700 leading-relaxed">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 shrink-0"></span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border-t border-emerald-200 px-5 py-5">
        <div className="flex items-center gap-2 text-emerald-800 mb-4">
          <Sparkles className="w-4.5 h-4.5 text-emerald-600" />
          <span className="text-sm font-bold">What You Should Do Next to Make More Money</span>
        </div>
        <div className="space-y-3">
          {insights.actions.map((action, i) => (
            <div key={i} className="flex items-start gap-3 bg-white rounded-lg border border-emerald-200 px-4 py-3 shadow-sm">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold shrink-0 mt-0.5">{i + 1}</span>
              <p className="text-sm text-gray-700 leading-relaxed">{action}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EditableCell({ record, field, value, editingCell, setEditingCell, updateCell }: {
  record: FinancialRecord;
  field: string;
  value: number;
  editingCell: { id: string; field: string } | null;
  setEditingCell: (v: { id: string; field: string } | null) => void;
  updateCell: (id: string, field: string, value: number) => void;
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
      {formatNumber(value)}
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
}

const columnGroups = [
  {
    label: 'Assets',
    color: 'bg-teal-600',
    columns: [
      { key: 'total_factory_inventory', label: 'Factory Inv.' },
      { key: 'shop_stock_value', label: 'Shop Stock' },
      { key: 'shop_receivable', label: 'Shop Recv.' },
      { key: 'cheques_in_hand', label: 'Cheques' },
      { key: 'import_goods_value', label: 'Import Val.' },
      { key: 'import_receivable', label: 'Import Recv.' },
      { key: 'bank_balance', label: 'Bank Bal.' },
      { key: 'property_deposit', label: 'Property Dep.' },
    ],
  },
  {
    label: 'Liabilities',
    color: 'bg-rose-600',
    columns: [
      { key: 'investor_liability', label: 'Investor Liab.' },
    ],
  },
  {
    label: 'Income',
    color: 'bg-emerald-600',
    columns: [
      { key: 'monthly_sales', label: 'Sales' },
      { key: 'cost_of_sales', label: 'Cost of Sales' },
      { key: 'gross_profit', label: 'Gross Profit', computed: true },
    ],
  },
];

const calculatedColumns = [
  { label: 'Total Assets', fn: calculateTotalAssets, color: 'text-teal-700 bg-teal-50/60' },
  { label: 'Net Capital', fn: calculateNetBusinessCapital, color: 'text-teal-700 bg-teal-50/60' },
  { label: 'A/L Ratio', fn: (r: FinancialRecord) => calculateAssetLiabilityRatio(r), format: (v: number) => v.toFixed(2), color: 'text-amber-700 bg-amber-50/60' },
  { label: 'Recv. Days', fn: (r: FinancialRecord) => calculateReceivableDays(r), format: (v: number) => v.toFixed(0), color: 'text-amber-700 bg-amber-50/60' },
  { label: 'GP %', fn: (r: FinancialRecord) => calculateGPPercent(r), format: (v: number) => `${v.toFixed(1)}%`, color: 'text-cyan-700 bg-cyan-50/60' },
];

function RecordsTable({
  records, editingCell, editingDate, setEditingCell, setEditingDate,
  updateCell, updateDate, deleteRecord, addNewRecord,
}: RecordsTableProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-900 text-white">
              <th rowSpan={2} className="sticky left-0 z-10 bg-gray-900 px-3 py-2 text-left font-semibold whitespace-nowrap border-r border-gray-700 w-28">
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
                    className={`px-2 py-1.5 text-right font-medium whitespace-nowrap text-[10px] ${
                      colIdx === group.columns.length - 1 ? 'border-r border-gray-700' : ''
                    }`}
                  >
                    {col.label}
                  </th>
                ))
              )}
              {calculatedColumns.map((col, idx) => (
                <th
                  key={col.label}
                  className={`px-2 py-1.5 text-right font-medium whitespace-nowrap text-[10px] ${
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
                      {new Date(record.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
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
                        <div className="w-full px-2 py-1 text-right text-xs tabular-nums font-semibold text-emerald-700 bg-emerald-50/60 rounded-md">
                          {formatNumber(record[col.key as keyof FinancialRecord] as number)}
                        </div>
                      ) : (
                        <EditableCell
                          record={record}
                          field={col.key}
                          value={record[col.key as keyof FinancialRecord] as number}
                          editingCell={editingCell}
                          setEditingCell={setEditingCell}
                          updateCell={updateCell}
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
