import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAutoSave } from '../hooks/useAutoSave';
import {
  Target, TrendingUp, TrendingDown, Minus, Save, RotateCcw,
  ChevronDown, ChevronUp, CheckCircle2, Trophy, ArrowRight, Sparkles,
  ListChecks, Circle, CircleCheck, CircleDot, Lock, Pencil,
} from 'lucide-react';

interface FinancialRecord {
  id: string;
  date: string;
  month: string;
  total_factory_inventory: number;
  shop_stock_value: number;
  lc_stock_value?: number;
  shop_receivable: number;
  cheques_in_hand: number;
  import_goods_value: number;
  import_receivable: number;
  bank_balance: number;
  cash_in_hand?: number;
  investor_liability: number;
  monthly_sales: number;
  cost_of_sales: number;
  gross_profit: number;
  property_deposit: number;
  supplier_payable?: number;
  agent_payable?: number;
  bank_loan?: number;
  cheques_issued?: number;
}

interface FinancialTarget {
  id?: string;
  month: string;
  year: number;
  monthly_sales_target: number;
  gross_profit_target: number;
  net_capital_target: number;
  total_assets_target: number;
  receivable_days_target: number;
  gp_percentage_target: number;
  notes: string;
}

interface TrendData {
  salesGrowthRate: number;
  profitGrowthRate: number;
  capitalGrowthRate: number;
  assetsGrowthRate: number;
  avgSales: number;
  avgProfit: number;
  avgCapital: number;
  avgAssets: number;
  avgGPPercent: number;
  avgRecvDays: number;
  projectedSales: number;
  projectedProfit: number;
  projectedCapital: number;
  projectedAssets: number;
}

function calculateTotalAssets(r: FinancialRecord) {
  return r.total_factory_inventory + r.shop_stock_value + (r.lc_stock_value || 0) +
    r.shop_receivable + r.cheques_in_hand +
    r.import_goods_value + r.import_receivable +
    r.bank_balance + (r.cash_in_hand || 0) + r.property_deposit;
}

function calculateNetCapital(r: FinancialRecord) {
  // what we own minus everything we owe (same rule as the CEO Network cards)
  return calculateTotalAssets(r) - r.investor_liability - (r.supplier_payable || 0) - (r.agent_payable || 0) - (r.bank_loan || 0) - (r.cheques_issued || 0);
}

function calculateGPPercent(r: FinancialRecord) {
  if (r.monthly_sales === 0) return 0;
  return (r.gross_profit / r.monthly_sales) * 100;
}

function calculateRecvDays(r: FinancialRecord) {
  if (r.monthly_sales === 0) return 0;
  return (r.shop_receivable / r.monthly_sales) * 30;
}

function salesProfitUplift(growthRate: number): number {
  if (growthRate > 15) return 1.15;
  if (growthRate > 10) return 1.12;
  if (growthRate > 5) return 1.10;
  if (growthRate > 0) return 1.07;
  return 1.05;
}

function capitalAssetsUplift(growthRate: number): number {
  if (growthRate > 12) return 1.12;
  if (growthRate > 8) return 1.10;
  if (growthRate > 3) return 1.07;
  if (growthRate > 0) return 1.05;
  return 1.03;
}

function gpMarginUplift(currentGP: number): number {
  if (currentGP > 25) return 0.5;
  if (currentGP > 20) return 1.0;
  if (currentGP > 15) return 1.5;
  return 2.0;
}

function getNextMonth(month: string, year: number): { month: string; year: number } {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const idx = months.indexOf(month);
  if (idx === 11) return { month: 'January', year: year + 1 };
  return { month: months[idx + 1], year };
}

function formatNum(num: number) {
  return new Intl.NumberFormat('en-LK', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);
}


async function getCurrentUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export default function FinancialTargets({ records }: { records: FinancialRecord[] }) {
  const [targets, setTargets] = useState<FinancialTarget | null>(null);
  const [nextMonthTargets, setNextMonthTargets] = useState<FinancialTarget | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editNextMonth, setEditNextMonth] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingNext, setSavingNext] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [draft, setDraft] = useState<FinancialTarget | null>(null);
  const [nextDraft, setNextDraft] = useState<FinancialTarget | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  const draftRef = useRef(draft);
  const targetsRef = useRef(targets);
  const nextDraftRef = useRef(nextDraft);
  const nextMonthTargetsRef = useRef(nextMonthTargets);

  useEffect(() => {
    draftRef.current = draft;
    targetsRef.current = targets;
    nextDraftRef.current = nextDraft;
    nextMonthTargetsRef.current = nextMonthTargets;
  }, [draft, targets, nextDraft, nextMonthTargets]);

  const { save: debouncedSaveTargets } = useAutoSave({
    onSave: async () => {
      if (!draftRef.current || !editMode) return;

      const userId = await getCurrentUserId();
      const currentDraft = draftRef.current;
      const currentTargets = targetsRef.current;

      if (currentTargets?.id) {
        await supabase
          .from('financial_targets')
          .update({
            monthly_sales_target: currentDraft.monthly_sales_target,
            gross_profit_target: currentDraft.gross_profit_target,
            net_capital_target: currentDraft.net_capital_target,
            total_assets_target: currentDraft.total_assets_target,
            receivable_days_target: currentDraft.receivable_days_target,
            gp_percentage_target: currentDraft.gp_percentage_target,
            notes: currentDraft.notes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', currentTargets.id);
      } else {
        const { data } = await supabase
          .from('financial_targets')
          .insert([{
            month: currentDraft.month,
            year: currentDraft.year,
            monthly_sales_target: currentDraft.monthly_sales_target,
            gross_profit_target: currentDraft.gross_profit_target,
            net_capital_target: currentDraft.net_capital_target,
            total_assets_target: currentDraft.total_assets_target,
            receivable_days_target: currentDraft.receivable_days_target,
            gp_percentage_target: currentDraft.gp_percentage_target,
            notes: currentDraft.notes,
            ...(userId ? { user_id: userId } : {}),
          }])
          .select();
        if (data && data.length > 0) {
          setDraft({ ...currentDraft, id: data[0].id });
          setTargets({ ...currentDraft, id: data[0].id });
        }
      }
    },
    debounceMs: 1000,
  });

  const { save: debouncedSaveNextMonth } = useAutoSave({
    onSave: async () => {
      if (!nextDraftRef.current || !editNextMonth) return;

      const userId = await getCurrentUserId();
      const currentNextDraft = nextDraftRef.current;
      const currentNextMonthTargets = nextMonthTargetsRef.current;

      if (currentNextMonthTargets?.id) {
        await supabase
          .from('financial_targets')
          .update({
            monthly_sales_target: currentNextDraft.monthly_sales_target,
            gross_profit_target: currentNextDraft.gross_profit_target,
            net_capital_target: currentNextDraft.net_capital_target,
            total_assets_target: currentNextDraft.total_assets_target,
            receivable_days_target: currentNextDraft.receivable_days_target,
            gp_percentage_target: currentNextDraft.gp_percentage_target,
            notes: currentNextDraft.notes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', currentNextMonthTargets.id);
      } else {
        const { data } = await supabase
          .from('financial_targets')
          .insert([{
            month: currentNextDraft.month,
            year: currentNextDraft.year,
            monthly_sales_target: currentNextDraft.monthly_sales_target,
            gross_profit_target: currentNextDraft.gross_profit_target,
            net_capital_target: currentNextDraft.net_capital_target,
            total_assets_target: currentNextDraft.total_assets_target,
            receivable_days_target: currentNextDraft.receivable_days_target,
            gp_percentage_target: currentNextDraft.gp_percentage_target,
            notes: currentNextDraft.notes,
            ...(userId ? { user_id: userId } : {}),
          }])
          .select();
        if (data && data.length > 0) {
          setNextDraft({ ...currentNextDraft, id: data[0].id });
          setNextMonthTargets({ ...currentNextDraft, id: data[0].id });
        }
      }
    },
    debounceMs: 1000,
  });

  const now = new Date();
  const currentMonth = now.toLocaleString('default', { month: 'long' });
  const currentYear = now.getFullYear();
  const next = getNextMonth(currentMonth, currentYear);

  useEffect(() => {
    loadTargets();
    loadNextMonthTargets();
  }, []);

  async function loadTargets() {
    const { data } = await supabase
      .from('financial_targets')
      .select('*')
      .eq('month', currentMonth)
      .eq('year', currentYear)
      .maybeSingle();

    if (data) {
      setTargets(data);
      setDraft(data);
    }
  }

  async function loadNextMonthTargets() {
    const { data } = await supabase
      .from('financial_targets')
      .select('*')
      .eq('month', next.month)
      .eq('year', next.year)
      .maybeSingle();

    if (data) {
      setNextMonthTargets(data);
      setNextDraft(data);
    }
  }

  const trend = useMemo<TrendData>(() => {
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 2) {
      const latest = sorted[0];
      const sales = latest?.monthly_sales || 0;
      const profit = latest?.gross_profit || 0;
      const capital = latest ? calculateNetCapital(latest) : 0;
      const assets = latest ? calculateTotalAssets(latest) : 0;
      return {
        salesGrowthRate: 0, profitGrowthRate: 0, capitalGrowthRate: 0, assetsGrowthRate: 0,
        avgSales: sales, avgProfit: profit, avgCapital: capital, avgAssets: assets,
        avgGPPercent: latest ? calculateGPPercent(latest) : 0,
        avgRecvDays: latest ? calculateRecvDays(latest) : 0,
        projectedSales: sales, projectedProfit: profit, projectedCapital: capital, projectedAssets: assets,
      };
    }

    const salesValues = sorted.map(r => r.monthly_sales).filter(v => v > 0);
    const profitValues = sorted.map(r => r.gross_profit).filter(v => v > 0);
    const capitalValues = sorted.map(r => calculateNetCapital(r)).filter(v => v > 0);
    const assetsValues = sorted.map(r => calculateTotalAssets(r)).filter(v => v > 0);

    function growthRate(values: number[]) {
      if (values.length < 2) return 0;
      const rates: number[] = [];
      for (let i = 1; i < values.length; i++) {
        if (values[i - 1] !== 0) {
          rates.push((values[i] - values[i - 1]) / values[i - 1]);
        }
      }
      return rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    }

    function avg(values: number[]) {
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    }

    const sgr = growthRate(salesValues);
    const pgr = growthRate(profitValues);
    const cgr = growthRate(capitalValues);
    const agr = growthRate(assetsValues);

    const lastSales = salesValues[salesValues.length - 1] || 0;
    const lastProfit = profitValues[profitValues.length - 1] || 0;
    const lastCapital = capitalValues[capitalValues.length - 1] || 0;
    const lastAssets = assetsValues[assetsValues.length - 1] || 0;

    return {
      salesGrowthRate: sgr * 100,
      profitGrowthRate: pgr * 100,
      capitalGrowthRate: cgr * 100,
      assetsGrowthRate: agr * 100,
      avgSales: avg(salesValues),
      avgProfit: avg(profitValues),
      avgCapital: avg(capitalValues),
      avgAssets: avg(assetsValues),
      avgGPPercent: avg(sorted.map(r => calculateGPPercent(r))),
      avgRecvDays: avg(sorted.map(r => calculateRecvDays(r)).filter(v => v > 0)),
      projectedSales: lastSales * (1 + sgr),
      projectedProfit: lastProfit * (1 + pgr),
      projectedCapital: lastCapital * (1 + cgr),
      projectedAssets: lastAssets * (1 + agr),
    };
  }, [records]);

  const latest = records.length > 0 ? records[0] : null;

  const achievements = useMemo(() => {
    if (!targets || !latest) return { items: [], count: 0, total: 4 };
    const items = [
      { label: 'Monthly Sales', achieved: latest.monthly_sales >= targets.monthly_sales_target, actual: latest.monthly_sales, target: targets.monthly_sales_target },
      { label: 'Gross Profit', achieved: latest.gross_profit >= targets.gross_profit_target, actual: latest.gross_profit, target: targets.gross_profit_target },
      { label: 'Net Capital', achieved: calculateNetCapital(latest) >= targets.net_capital_target, actual: calculateNetCapital(latest), target: targets.net_capital_target },
      { label: 'Total Assets', achieved: calculateTotalAssets(latest) >= targets.total_assets_target, actual: calculateTotalAssets(latest), target: targets.total_assets_target },
    ];
    return { items, count: items.filter(i => i.achieved).length, total: items.length };
  }, [targets, latest]);

  const allTargetsMet = achievements.count === achievements.total && achievements.total > 0;

  useEffect(() => {
    if (allTargetsMet) {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [allTargetsMet]);

  async function applyProjections() {
    const projected: FinancialTarget = {
      month: currentMonth,
      year: currentYear,
      monthly_sales_target: Math.round(trend.projectedSales),
      gross_profit_target: Math.round(trend.projectedProfit),
      net_capital_target: Math.round(trend.projectedCapital),
      total_assets_target: Math.round(trend.projectedAssets),
      receivable_days_target: Math.round(trend.avgRecvDays > 0 ? Math.max(trend.avgRecvDays - 2, 7) : 30),
      gp_percentage_target: Math.round(trend.avgGPPercent * 10) / 10,
      notes: '',
    };
    setDraft(projected);
    setSaving(true);

    const userId = await getCurrentUserId();

    if (targets?.id) {
      const { error } = await supabase
        .from('financial_targets')
        .update({
          monthly_sales_target: projected.monthly_sales_target,
          gross_profit_target: projected.gross_profit_target,
          net_capital_target: projected.net_capital_target,
          total_assets_target: projected.total_assets_target,
          receivable_days_target: projected.receivable_days_target,
          gp_percentage_target: projected.gp_percentage_target,
          notes: projected.notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', targets.id);
      if (error) console.error('Update targets error:', error);
    } else {
      const { data, error } = await supabase
        .from('financial_targets')
        .insert([{
          month: projected.month,
          year: projected.year,
          monthly_sales_target: projected.monthly_sales_target,
          gross_profit_target: projected.gross_profit_target,
          net_capital_target: projected.net_capital_target,
          total_assets_target: projected.total_assets_target,
          receivable_days_target: projected.receivable_days_target,
          gp_percentage_target: projected.gp_percentage_target,
          notes: projected.notes,
          ...(userId ? { user_id: userId } : {}),
        }])
        .select();
      if (error) console.error('Insert targets error:', error);
      if (data && data.length > 0) {
        projected.id = data[0].id;
      }
    }

    setTargets(projected);
    setDraft(projected);
    setEditMode(false);
    setSaving(false);
    loadTargets();
  }

  async function applyNextMonthProjections() {
    const spUplift = salesProfitUplift(trend.salesGrowthRate);
    const caUplift = capitalAssetsUplift(trend.capitalGrowthRate);
    const gpUplift = gpMarginUplift(trend.avgGPPercent);

    const projected: FinancialTarget = {
      month: next.month,
      year: next.year,
      monthly_sales_target: Math.round(trend.projectedSales * spUplift),
      gross_profit_target: Math.round(trend.projectedProfit * salesProfitUplift(trend.profitGrowthRate)),
      net_capital_target: Math.round(trend.projectedCapital * caUplift),
      total_assets_target: Math.round(trend.projectedAssets * capitalAssetsUplift(trend.assetsGrowthRate)),
      receivable_days_target: Math.round(trend.avgRecvDays > 0 ? Math.max(trend.avgRecvDays - 2, 7) : 30),
      gp_percentage_target: Math.round((trend.avgGPPercent + gpUplift) * 10) / 10,
      notes: '',
    };
    setNextDraft(projected);
    setSavingNext(true);

    const userId = await getCurrentUserId();

    if (nextMonthTargets?.id) {
      const { error } = await supabase
        .from('financial_targets')
        .update({
          monthly_sales_target: projected.monthly_sales_target,
          gross_profit_target: projected.gross_profit_target,
          net_capital_target: projected.net_capital_target,
          total_assets_target: projected.total_assets_target,
          receivable_days_target: projected.receivable_days_target,
          gp_percentage_target: projected.gp_percentage_target,
          notes: projected.notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', nextMonthTargets.id);
      if (error) console.error('Update next month targets error:', error);
    } else {
      const { data, error } = await supabase
        .from('financial_targets')
        .insert([{
          month: projected.month,
          year: projected.year,
          monthly_sales_target: projected.monthly_sales_target,
          gross_profit_target: projected.gross_profit_target,
          net_capital_target: projected.net_capital_target,
          total_assets_target: projected.total_assets_target,
          receivable_days_target: projected.receivable_days_target,
          gp_percentage_target: projected.gp_percentage_target,
          notes: projected.notes,
          ...(userId ? { user_id: userId } : {}),
        }])
        .select();
      if (error) console.error('Insert next month targets error:', error);
      if (data && data.length > 0) {
        projected.id = data[0].id;
      }
    }

    setNextMonthTargets(projected);
    setNextDraft(projected);
    setEditNextMonth(false);
    setSavingNext(false);
    loadNextMonthTargets();
  }

  async function saveTargets() {
    if (!draft) return;
    setSaving(true);

    const userId = await getCurrentUserId();

    if (targets?.id) {
      const { error } = await supabase
        .from('financial_targets')
        .update({
          monthly_sales_target: draft.monthly_sales_target,
          gross_profit_target: draft.gross_profit_target,
          net_capital_target: draft.net_capital_target,
          total_assets_target: draft.total_assets_target,
          receivable_days_target: draft.receivable_days_target,
          gp_percentage_target: draft.gp_percentage_target,
          notes: draft.notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', targets.id);
      if (error) console.error('Save targets update error:', error);
    } else {
      const { data, error } = await supabase
        .from('financial_targets')
        .insert([{
          month: draft.month,
          year: draft.year,
          monthly_sales_target: draft.monthly_sales_target,
          gross_profit_target: draft.gross_profit_target,
          net_capital_target: draft.net_capital_target,
          total_assets_target: draft.total_assets_target,
          receivable_days_target: draft.receivable_days_target,
          gp_percentage_target: draft.gp_percentage_target,
          notes: draft.notes,
          ...(userId ? { user_id: userId } : {}),
        }])
        .select();
      if (error) console.error('Save targets insert error:', error);
      if (data && data.length > 0) {
        setDraft({ ...draft, id: data[0].id });
      }
    }

    setTargets(draft);
    setEditMode(false);
    setSaving(false);
    loadTargets();
  }

  async function saveNextMonthTargets() {
    if (!nextDraft) return;
    setSavingNext(true);

    const userId = await getCurrentUserId();

    if (nextMonthTargets?.id) {
      const { error } = await supabase
        .from('financial_targets')
        .update({
          monthly_sales_target: nextDraft.monthly_sales_target,
          gross_profit_target: nextDraft.gross_profit_target,
          net_capital_target: nextDraft.net_capital_target,
          total_assets_target: nextDraft.total_assets_target,
          receivable_days_target: nextDraft.receivable_days_target,
          gp_percentage_target: nextDraft.gp_percentage_target,
          notes: nextDraft.notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', nextMonthTargets.id);
      if (error) console.error('Save next month update error:', error);
    } else {
      const { data, error } = await supabase
        .from('financial_targets')
        .insert([{
          month: nextDraft.month,
          year: nextDraft.year,
          monthly_sales_target: nextDraft.monthly_sales_target,
          gross_profit_target: nextDraft.gross_profit_target,
          net_capital_target: nextDraft.net_capital_target,
          total_assets_target: nextDraft.total_assets_target,
          receivable_days_target: nextDraft.receivable_days_target,
          gp_percentage_target: nextDraft.gp_percentage_target,
          notes: nextDraft.notes,
          ...(userId ? { user_id: userId } : {}),
        }])
        .select();
      if (error) console.error('Save next month insert error:', error);
      if (data && data.length > 0) {
        setNextDraft({ ...nextDraft, id: data[0].id });
      }
    }

    setNextMonthTargets(nextDraft);
    setEditNextMonth(false);
    setSavingNext(false);
    loadNextMonthTargets();
  }

  return (
    <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 bg-gradient-to-r from-slate-800 to-slate-700 text-white hover:from-slate-700 hover:to-slate-600 transition-all"
      >
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-amber-400" />
          <span className="font-bold text-sm">Business Targets & Projections</span>
          <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{currentMonth} {currentYear}</span>
          {allTargetsMet && (
            <span className="text-xs bg-emerald-500 px-2 py-0.5 rounded-full animate-pulse">All Targets Met!</span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="p-3 space-y-2">
          {allTargetsMet && (
            <CongratsBanner showConfetti={showConfetti} />
          )}

          {achievements.count > 0 && !allTargetsMet && targets && latest && (
            <PartialAchievementBanner achieved={achievements.count} total={achievements.total} items={achievements.items} />
          )}

          <WorkflowGuide
            hasRecords={records.length > 0}
            hasTargets={!!targets}
            hasNextMonthTargets={!!nextMonthTargets}
            onAutoCalc={applyProjections}
            onAutoGenNext={applyNextMonthProjections}
          />

          <div className="grid grid-cols-4 gap-2">
            <TrendCard
              label="Sales Growth"
              value={`${trend.salesGrowthRate >= 0 ? '+' : ''}${trend.salesGrowthRate.toFixed(1)}%`}
              sub={`Avg: ${formatNum(trend.avgSales)}/mo`}
              trend={trend.salesGrowthRate}
            />
            <TrendCard
              label="Profit Growth"
              value={`${trend.profitGrowthRate >= 0 ? '+' : ''}${trend.profitGrowthRate.toFixed(1)}%`}
              sub={`Avg: ${formatNum(trend.avgProfit)}/mo`}
              trend={trend.profitGrowthRate}
            />
            <TrendCard
              label="Capital Growth"
              value={`${trend.capitalGrowthRate >= 0 ? '+' : ''}${trend.capitalGrowthRate.toFixed(1)}%`}
              sub={`Avg: ${formatNum(trend.avgCapital)}`}
              trend={trend.capitalGrowthRate}
            />
            <TrendCard
              label="GP Margin"
              value={`${trend.avgGPPercent.toFixed(1)}%`}
              sub={`Recv: ${trend.avgRecvDays.toFixed(0)} days`}
              trend={trend.avgGPPercent > 15 ? 1 : trend.avgGPPercent > 10 ? 0 : -1}
            />
          </div>

          <div className={`grid gap-3 ${targets && latest ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-bold text-gray-800">
                    {targets ? `${currentMonth} Targets` : 'Set Monthly Targets'}
                  </h3>
                  {targets && !editMode && (
                    <span className="inline-flex items-center gap-0.5 text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-semibold">
                      <Lock className="w-2 h-2" />
                      Locked
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {!editMode && !saving && (
                    <button
                      onClick={applyProjections}
                      disabled={saving}
                      className="flex items-center gap-1 text-[10px] bg-slate-100 text-slate-700 px-2 py-1 rounded hover:bg-slate-200 transition-colors font-medium disabled:opacity-50"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      {targets ? 'Recalc' : 'Auto-Calc'}
                    </button>
                  )}
                  {saving && (
                    <span className="flex items-center gap-1 text-[10px] text-slate-500 px-2 py-1">
                      <div className="w-2.5 h-2.5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                      Saving...
                    </span>
                  )}
                  {editMode && (
                    <>
                      <button
                        onClick={() => { setEditMode(false); setDraft(targets); }}
                        className="text-[10px] text-gray-500 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveTargets}
                        disabled={saving}
                        className="flex items-center gap-1 text-[10px] bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 transition-colors font-medium disabled:opacity-50"
                      >
                        <Save className="w-2.5 h-2.5" />
                        Save
                      </button>
                    </>
                  )}
                  {targets && !editMode && !saving && (
                    <button
                      onClick={() => { setDraft(targets); setEditMode(true); }}
                      className="flex items-center gap-1 text-[10px] bg-teal-600 text-white px-2 py-1 rounded hover:bg-teal-700 transition-colors font-medium"
                    >
                      <Pencil className="w-2.5 h-2.5" />
                      Edit
                    </button>
                  )}
                </div>
              </div>

              {editMode && draft ? (
                <div className="grid grid-cols-2 gap-2">
                  <TargetInput label="Monthly Sales" value={draft.monthly_sales_target} onChange={v => { setDraft({ ...draft, monthly_sales_target: v }); debouncedSaveTargets(); }} />
                  <TargetInput label="Gross Profit" value={draft.gross_profit_target} onChange={v => { setDraft({ ...draft, gross_profit_target: v }); debouncedSaveTargets(); }} />
                  <TargetInput label="Net Capital" value={draft.net_capital_target} onChange={v => { setDraft({ ...draft, net_capital_target: v }); debouncedSaveTargets(); }} />
                  <TargetInput label="Total Assets" value={draft.total_assets_target} onChange={v => { setDraft({ ...draft, total_assets_target: v }); debouncedSaveTargets(); }} />
                  <TargetInput label="Receivable Days" value={draft.receivable_days_target} onChange={v => { setDraft({ ...draft, receivable_days_target: v }); debouncedSaveTargets(); }} />
                  <TargetInput label="GP %" value={draft.gp_percentage_target} onChange={v => { setDraft({ ...draft, gp_percentage_target: v }); debouncedSaveTargets(); }} />
                </div>
              ) : targets && latest ? (
                <FrozenTargetsDisplay targets={targets} latest={latest} />
              ) : (
                <div className="text-center py-4 text-gray-500 text-xs">
                  <Target className="w-6 h-6 mx-auto mb-1 text-gray-300" />
                  <p>Click <strong>"Auto-Calc"</strong> to generate targets.</p>
                </div>
              )}
            </div>

            {targets && latest && (
              <NextMonthSection
                next={next}
                nextMonthTargets={nextMonthTargets}
                editNextMonth={editNextMonth}
                nextDraft={nextDraft}
                savingNext={savingNext}
                trend={trend}
                latest={latest}
                onAutoCalc={applyNextMonthProjections}
                onEdit={() => { setNextDraft(nextMonthTargets); setEditNextMonth(true); }}
                onCancel={() => { setEditNextMonth(false); setNextDraft(nextMonthTargets); }}
                onSave={saveNextMonthTargets}
                onDraftChange={(d) => { setNextDraft(d); debouncedSaveNextMonth(); }}
                currentTargets={targets}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowGuide({ hasRecords, hasTargets, hasNextMonthTargets, onAutoCalc, onAutoGenNext }: {
  hasRecords: boolean;
  hasTargets: boolean;
  hasNextMonthTargets: boolean;
  onAutoCalc: () => void;
  onAutoGenNext: () => void;
}) {
  if (!hasRecords) return null;
  if (hasTargets && hasNextMonthTargets) return null;

  const steps = [
    { label: 'Enter last month\'s financial data', done: hasRecords },
    { label: 'Set this month\'s targets', done: hasTargets },
    { label: 'Generate next month\'s targets', done: hasNextMonthTargets },
  ];

  const currentStep = steps.findIndex(s => !s.done);

  return (
    <div className="rounded-lg bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 px-3 py-2">
      <div className="flex items-center gap-2">
        <ListChecks className="w-4 h-4 text-amber-700 flex-shrink-0" />
        <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
          {steps.map((step, i) => {
            const isCurrent = i === currentStep;
            const Icon = step.done ? CircleCheck : isCurrent ? CircleDot : Circle;
            return (
              <div key={i} className="flex items-center gap-1">
                <Icon className={`w-3 h-3 flex-shrink-0 ${
                  step.done ? 'text-emerald-500' : isCurrent ? 'text-amber-600' : 'text-gray-300'
                }`} />
                <span className={`text-[10px] ${
                  step.done ? 'text-gray-400 line-through' : isCurrent ? 'text-gray-800 font-semibold' : 'text-gray-400'
                }`}>
                  {step.label}
                </span>
                {isCurrent && i === 1 && !hasTargets && (
                  <button onClick={onAutoCalc} className="text-[9px] bg-amber-600 text-white px-2 py-0.5 rounded hover:bg-amber-700 transition-colors font-medium">
                    Auto-Calc
                  </button>
                )}
                {isCurrent && i === 2 && hasTargets && !hasNextMonthTargets && (
                  <button onClick={onAutoGenNext} className="text-[9px] bg-amber-600 text-white px-2 py-0.5 rounded hover:bg-amber-700 transition-colors font-medium">
                    Auto-Gen
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CongratsBanner({ showConfetti }: { showConfetti: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-lg bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 px-4 py-3 text-white">
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-1.5 h-1.5 rounded-full animate-bounce"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                backgroundColor: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'][i % 6],
                animationDelay: `${Math.random() * 2}s`,
                animationDuration: `${1 + Math.random() * 2}s`,
              }}
            />
          ))}
        </div>
      )}
      <div className="relative flex items-center gap-3">
        <Trophy className="w-6 h-6 text-amber-300 flex-shrink-0" />
        <div>
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            All Targets Achieved!
            <Sparkles className="w-4 h-4 text-amber-300" />
          </h3>
          <p className="text-emerald-100 text-xs">Outstanding month -- time to set next month's goals.</p>
        </div>
      </div>
    </div>
  );
}

function PartialAchievementBanner({ achieved, total, items }: {
  achieved: number;
  total: number;
  items: { label: string; achieved: boolean }[];
}) {
  return (
    <div className="rounded-lg bg-gradient-to-r from-blue-50 to-emerald-50 border border-blue-200 px-3 py-2">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-teal-700 flex-shrink-0" />
        <span className="text-xs font-bold text-gray-800">{achieved}/{total} achieved</span>
        <div className="flex gap-0.5">
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < achieved ? 'bg-emerald-500' : 'bg-gray-300'}`} />
          ))}
        </div>
        <div className="flex flex-wrap gap-1 ml-1">
          {items.filter(i => i.achieved).map(item => (
            <span key={item.label} className="inline-flex items-center gap-0.5 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">
              <CheckCircle2 className="w-2.5 h-2.5" />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function FrozenTargetsDisplay({ targets, latest }: { targets: FinancialTarget; latest: FinancialRecord }) {
  const items = [
    { label: 'Sales', actual: latest.monthly_sales, target: targets.monthly_sales_target },
    { label: 'Profit', actual: latest.gross_profit, target: targets.gross_profit_target },
    { label: 'Capital', actual: calculateNetCapital(latest), target: targets.net_capital_target },
    { label: 'Assets', actual: calculateTotalAssets(latest), target: targets.total_assets_target },
  ];
  const ratioItems = [
    { label: 'GP%', actual: calculateGPPercent(latest), target: targets.gp_percentage_target, suffix: '%' },
    { label: 'Recv Days', actual: calculateRecvDays(latest), target: targets.receivable_days_target, suffix: 'd', invert: true },
  ];

  return (
    <div className="space-y-1.5">
      {items.map(item => {
        const pct = item.target > 0 ? (item.actual / item.target) * 100 : 0;
        const achieved = pct >= 100;
        const barColor = achieved ? 'bg-emerald-500' : pct >= 75 ? 'bg-teal-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-400';
        return (
          <div key={item.label} className={`rounded-lg px-2.5 py-1.5 ${achieved ? 'bg-emerald-50' : 'bg-gray-50'}`}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] font-bold text-slate-600">{item.label}</span>
              <div className="flex items-center gap-2 text-[10px]">
                <span className="text-slate-500">{formatNum(item.actual)}</span>
                <span className="text-slate-300">/</span>
                <span className="font-bold text-slate-800">{formatNum(item.target)}</span>
                {achieved ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                ) : (
                  <span className={`font-bold ${pct >= 75 ? 'text-teal-700' : pct >= 50 ? 'text-amber-600' : 'text-red-500'}`}>{pct.toFixed(0)}%</span>
                )}
              </div>
            </div>
            <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
          </div>
        );
      })}
      <div className="flex gap-2">
        {ratioItems.map(item => {
          const achieved = item.invert ? item.actual <= item.target : item.actual >= item.target;
          return (
            <div key={item.label} className={`flex-1 flex items-center justify-between rounded-lg px-2.5 py-1.5 ${achieved ? 'bg-emerald-50' : 'bg-gray-50'}`}>
              <span className="text-[10px] font-bold text-slate-600">{item.label}</span>
              <div className="flex items-center gap-1 text-[10px]">
                <span className="font-bold text-slate-800">{item.actual.toFixed(1)}{item.suffix}</span>
                <span className="text-slate-300">/</span>
                <span className="text-slate-500">{item.target.toFixed(1)}{item.suffix}</span>
                {achieved && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NextMonthSection({ next, nextMonthTargets, editNextMonth, nextDraft, savingNext, trend, latest, onAutoCalc, onEdit, onCancel, onSave, onDraftChange, currentTargets }: {
  next: { month: string; year: number };
  nextMonthTargets: FinancialTarget | null;
  editNextMonth: boolean;
  nextDraft: FinancialTarget | null;
  savingNext: boolean;
  trend: TrendData;
  latest: FinancialRecord;
  onAutoCalc: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onDraftChange: (d: FinancialTarget) => void;
  currentTargets: FinancialTarget;
}) {
  return (
    <div className="border border-blue-200 rounded-lg p-3 bg-teal-50/30">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <ArrowRight className="w-3 h-3 text-teal-700" />
          <h3 className="text-xs font-bold text-gray-800">
            {next.month} {next.year}
          </h3>
          {nextMonthTargets && !editNextMonth && !savingNext && (
            <span className="inline-flex items-center gap-0.5 text-[9px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full font-semibold">
              <Lock className="w-2 h-2" />
              Locked
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          {!editNextMonth && !savingNext && (
            <button
              onClick={onAutoCalc}
              className="flex items-center gap-1 text-[10px] bg-teal-100 text-teal-700 px-2 py-1 rounded hover:bg-blue-200 transition-colors font-medium"
            >
              <Sparkles className="w-2.5 h-2.5" />
              {nextMonthTargets ? 'Recalc' : 'Auto-Gen'}
            </button>
          )}
          {savingNext && (
            <span className="flex items-center gap-1 text-[10px] text-blue-500 px-2 py-1">
              <div className="w-2.5 h-2.5 border-2 border-teal-300 border-t-blue-600 rounded-full animate-spin" />
              Saving...
            </span>
          )}
          {editNextMonth && (
            <>
              <button onClick={onCancel} className="text-[10px] text-gray-500 px-2 py-1 rounded hover:bg-gray-100 transition-colors">Cancel</button>
              <button onClick={onSave} disabled={savingNext} className="flex items-center gap-1 text-[10px] bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 transition-colors font-medium disabled:opacity-50">
                <Save className="w-2.5 h-2.5" />
                Save
              </button>
            </>
          )}
          {nextMonthTargets && !editNextMonth && !savingNext && (
            <button onClick={onEdit} className="flex items-center gap-1 text-[10px] bg-teal-600 text-white px-2 py-1 rounded hover:bg-teal-700 transition-colors font-medium">
              <Pencil className="w-2.5 h-2.5" />
              Edit
            </button>
          )}
        </div>
      </div>

      {editNextMonth && nextDraft ? (
        <div className="grid grid-cols-2 gap-2">
          <TargetInput label="Sales" value={nextDraft.monthly_sales_target} onChange={v => onDraftChange({ ...nextDraft, monthly_sales_target: v })} />
          <TargetInput label="Profit" value={nextDraft.gross_profit_target} onChange={v => onDraftChange({ ...nextDraft, gross_profit_target: v })} />
          <TargetInput label="Capital" value={nextDraft.net_capital_target} onChange={v => onDraftChange({ ...nextDraft, net_capital_target: v })} />
          <TargetInput label="Assets" value={nextDraft.total_assets_target} onChange={v => onDraftChange({ ...nextDraft, total_assets_target: v })} />
          <TargetInput label="Recv Days" value={nextDraft.receivable_days_target} onChange={v => onDraftChange({ ...nextDraft, receivable_days_target: v })} />
          <TargetInput label="GP %" value={nextDraft.gp_percentage_target} onChange={v => onDraftChange({ ...nextDraft, gp_percentage_target: v })} />
        </div>
      ) : nextMonthTargets ? (
        <FrozenNextMonthDisplay targets={nextMonthTargets} currentTargets={currentTargets} />
      ) : (
        <div className="space-y-1.5">
          {[
            { label: 'Sales', current: latest.monthly_sales, projected: trend.projectedSales },
            { label: 'Profit', current: latest.gross_profit, projected: trend.projectedProfit },
            { label: 'Capital', current: calculateNetCapital(latest), projected: trend.projectedCapital },
            { label: 'Assets', current: calculateTotalAssets(latest), projected: trend.projectedAssets },
          ].map(item => {
            const diff = item.current !== 0 ? ((item.projected - item.current) / item.current) * 100 : 0;
            return (
              <div key={item.label} className="flex items-center justify-between bg-white rounded px-2.5 py-1.5">
                <span className="text-[10px] font-bold text-slate-600">{item.label}</span>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="font-bold text-slate-800">{formatNum(item.projected)}</span>
                  <span className={`${diff > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{diff > 0 ? '+' : ''}{diff.toFixed(1)}%</span>
                </div>
              </div>
            );
          })}
          <p className="text-[9px] text-center text-gray-400 mt-1">Projections -- click <strong>Auto-Gen</strong> to lock</p>
        </div>
      )}
    </div>
  );
}

function FrozenNextMonthDisplay({ targets, currentTargets }: { targets: FinancialTarget; currentTargets: FinancialTarget }) {
  const items = [
    { label: 'Sales', next: targets.monthly_sales_target, current: currentTargets.monthly_sales_target },
    { label: 'Profit', next: targets.gross_profit_target, current: currentTargets.gross_profit_target },
    { label: 'Capital', next: targets.net_capital_target, current: currentTargets.net_capital_target },
    { label: 'Assets', next: targets.total_assets_target, current: currentTargets.total_assets_target },
  ];

  return (
    <div className="space-y-1.5">
      {items.map(item => {
        const diff = item.current > 0 ? ((item.next - item.current) / item.current) * 100 : 0;
        const isUp = diff > 0;
        return (
          <div key={item.label} className="flex items-center justify-between bg-white rounded px-2.5 py-1.5">
            <span className="text-[10px] font-bold text-slate-600">{item.label}</span>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="font-bold text-slate-800">{formatNum(item.next)}</span>
              <span className={`flex items-center gap-0.5 ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
                {isUp ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                {isUp ? '+' : ''}{diff.toFixed(1)}%
              </span>
            </div>
          </div>
        );
      })}
      <div className="flex gap-2">
        <div className="flex-1 flex items-center justify-between bg-white rounded px-2.5 py-1.5">
          <span className="text-[10px] font-bold text-slate-600">GP%</span>
          <span className="text-[10px] font-bold text-slate-800">{targets.gp_percentage_target.toFixed(1)}%</span>
        </div>
        <div className="flex-1 flex items-center justify-between bg-white rounded px-2.5 py-1.5">
          <span className="text-[10px] font-bold text-slate-600">Recv Days</span>
          <span className="text-[10px] font-bold text-slate-800">{targets.receivable_days_target}d</span>
        </div>
      </div>
    </div>
  );
}

function TrendCard({ label, value, sub, trend }: { label: string; value: string; sub: string; trend: number }) {
  const bgColor = trend > 1 ? 'bg-emerald-50 border-emerald-200' : trend < -1 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200';
  const textColor = trend > 1 ? 'text-emerald-700' : trend < -1 ? 'text-red-700' : 'text-gray-700';

  return (
    <div className={`rounded-lg border p-2 ${bgColor}`}>
      <p className="text-[9px] uppercase tracking-wide font-semibold text-gray-500">{label}</p>
      <div className="flex items-center gap-1 mt-0.5">
        {trend > 1 ? <TrendingUp className="w-3 h-3 text-emerald-500" /> :
         trend < -1 ? <TrendingDown className="w-3 h-3 text-red-500" /> :
         <Minus className="w-3 h-3 text-gray-400" />}
        <span className={`text-sm font-bold ${textColor}`}>{value}</span>
      </div>
      <p className="text-[9px] text-gray-500">{sub}</p>
    </div>
  );
}

function TargetInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-[9px] uppercase tracking-wide font-semibold text-gray-500 mb-0.5">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>
  );
}
