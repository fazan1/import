import { useState, useEffect } from 'react';
import { X, Search, Trash2, FileDown, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface SavedCalc {
  id: string;
  customer_name: string;
  reference: string;
  total_landed: number;
  total_sell: number;
  total_profit: number;
  created_at: string;
  config: Record<string, unknown>;
  lines: Record<string, unknown>[];
}

interface Props {
  onLoad: (calc: SavedCalc) => void;
  onClose: () => void;
}

export default function SavedCalculations({ onLoad, onClose }: Props) {
  const [calcs, setCalcs] = useState<SavedCalc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchCalcs();
  }, []);

  async function fetchCalcs() {
    setLoading(true);
    const { data, error } = await supabase
      .from('import_calculations')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) alert('Could not load saved calculations: ' + error.message + (/import_calculations|schema cache|does not exist/i.test(error.message) ? '\n\nThe calculator tables are missing — run import-calculator-setup.sql in Supabase (MAIN project) once.' : ''));
    setCalcs((data as SavedCalc[]) ?? []);
    setLoading(false);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    await supabase.from('import_calculations').delete().eq('id', id);
    setCalcs((prev) => prev.filter((c) => c.id !== id));
    setDeleting(null);
  }

  const fmt = (v: number) =>
    `LKR ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const filtered = calcs.filter(
    (c) =>
      c.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      c.reference.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 pt-16 px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-900">Saved Calculations</h3>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer or reference..."
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-teal-500 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">
              {calcs.length === 0
                ? 'No saved calculations yet'
                : 'No results match your search'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 sticky top-0">
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-700">Customer</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-700">Reference</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-gray-700">Landed</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-gray-700">Sell</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-gray-700">Profit</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-700">Date</th>
                  <th className="px-4 py-2.5 w-24" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-gray-100 hover:bg-teal-50/40 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      {c.customer_name || '-'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{c.reference || '-'}</td>
                    <td className="px-4 py-2.5 text-right font-medium text-amber-700">
                      {fmt(c.total_landed)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-emerald-700">
                      {fmt(c.total_sell)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-emerald-700">
                      {fmt(c.total_profit)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">
                      {new Date(c.created_at).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => onLoad(c)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-teal-600 rounded hover:bg-teal-700 transition-colors"
                        >
                          <FileDown className="w-3 h-3" />
                          Load
                        </button>
                        <button
                          onClick={() => handleDelete(c.id)}
                          disabled={deleting === c.id}
                          className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors disabled:opacity-50"
                        >
                          {deleting === c.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
