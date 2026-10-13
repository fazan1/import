import { useEffect, useState } from 'react';
import { Landmark, Boxes, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import CNPortalDashboard from './CNPortalDashboard';
import SLPortalDashboard from './SLPortalDashboard';
import ShipmentJourney from './ShipmentJourney';

interface Props { onNavigate: (view: string) => void; }

// One dashboard: a thin strip of cross-business numbers, then the import (CN) and sales (SL) sections stacked.
export default function UnifiedDashboard({ onNavigate }: Props) {
  const [investorOwed, setInvestorOwed] = useState<number | null>(null);
  const [lowStock, setLowStock] = useState<number | null>(null);
  const [openShipments, setOpenShipments] = useState<number | null>(null);

  useEffect(() => {
    supabase.from('investor_ledger').select('direction, lkr').then(({ data }) => {
      if (!data) return; setInvestorOwed(data.reduce((t, l) => t + (l.direction === 'owe' ? Number(l.lkr) : -Number(l.lkr)), 0));
    });
    Promise.all([supabase.from('wh_products').select('id, min_qty, is_active'), supabase.from('wh_stock').select('product_id, qty')]).then(([p, s]) => {
      if (!p.data) return; const q: Record<string, number> = {}; (s.data ?? []).forEach((r) => { q[r.product_id] = (q[r.product_id] ?? 0) + Number(r.qty); });
      setLowStock(p.data.filter((x) => x.is_active && Number(x.min_qty) > 0 && (q[x.id] ?? 0) < Number(x.min_qty)).length);
    });
    supabase.from('shipments').select('id, status').then(({ data }) => { if (data) setOpenShipments(data.filter((x) => x.status !== 'closed' && x.status !== 'costed').length); });
  }, []);

  const rs = (n: number) => 'Rs ' + n.toLocaleString('en-LK', { maximumFractionDigits: 0 });
  const strip = [
    { label: 'Owed to investor', value: investorOwed === null ? '…' : rs(investorOwed), tone: (investorOwed ?? 0) > 0 ? 'text-red-700' : 'text-green-700', icon: Landmark, view: 'investor' },
    { label: 'Shipments in motion', value: openShipments === null ? '…' : String(openShipments), tone: 'text-gray-900', icon: Boxes, view: 'shipping' },
    { label: 'Warehouse low stock', value: lowStock === null ? '…' : String(lowStock), tone: (lowStock ?? 0) > 0 ? 'text-amber-700' : 'text-gray-900', icon: AlertTriangle, view: 'warehouse' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-sm text-gray-500">Everything in one place — imports on top, sales below.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {strip.map((t) => { const Icon = t.icon; return (
          <button key={t.label} onClick={() => onNavigate(t.view)} className="bg-white border border-gray-200 rounded-lg p-4 text-left hover:bg-gray-50 flex items-center gap-3">
            <Icon className="w-5 h-5 text-gray-400" />
            <div><div className="text-xs text-gray-500">{t.label}</div><div className={`text-xl font-bold ${t.tone}`}>{t.value}</div></div>
          </button>
        ); })}
      </div>

      <ShipmentJourney onNavigate={onNavigate} />

      <section>
        <div className="flex items-center gap-3 mb-3"><span className="font-mono text-[10px] tracking-[0.16em] text-[#e8552a] uppercase">Imports · CN</span><span className="flex-1 h-px bg-gray-200" /></div>
        <CNPortalDashboard onNavigate={onNavigate} embedded />
      </section>

      <section>
        <div className="flex items-center gap-3 mb-3"><span className="font-mono text-[10px] tracking-[0.16em] text-[#e8552a] uppercase">Sales · SL</span><span className="flex-1 h-px bg-gray-200" /></div>
        <SLPortalDashboard onNavigate={onNavigate} embedded />
      </section>
    </div>
  );
}
