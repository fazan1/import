import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Package, Building2, Calendar, ChevronDown, ChevronRight, Search, ListFilter as Filter, Truck, CircleCheck as CheckCircle, Clock, Ship, Box, Hash, FileText, RefreshCw, Printer } from 'lucide-react';
import ShipmentHistoryPrint from './ShipmentHistoryPrint';

interface PackingListItem {
  id: string;
  item_name: string;
  quantity: number;
  unit: string;
  no_of_pkgs: number;
  cbm: number;
  weight_kg: number;
}

interface PackingList {
  id: string;
  packing_list_no: string;
  supplier_name: string;
  status: string;
  date: string;
  batch_number: string | null;
  total_cartons: number;
  total_cbm: number;
  total_weight: number;
  items: PackingListItem[];
}

interface SupplierShipments {
  supplier_name: string;
  total_shipments: number;
  total_cartons: number;
  total_cbm: number;
  packing_lists: PackingList[];
}

interface ShipmentHistoryProps {
  initialSupplier?: string;
  initialBatch?: string;
}

export default function ShipmentHistory({ initialSupplier, initialBatch }: ShipmentHistoryProps) {
  const [shipments, setShipments] = useState<SupplierShipments[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set());
  const [expandedPLs, setExpandedPLs] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [batchFilter, setBatchFilter] = useState(initialBatch || '');
  const [allBatches, setAllBatches] = useState<string[]>([]);
  const [totals, setTotals] = useState({ shipments: 0, cartons: 0, cbm: 0, weight: 0 });
  const [showPrintView, setShowPrintView] = useState(false);

  useEffect(() => {
    loadShipmentHistory();
  }, []);

  useEffect(() => {
    if (initialSupplier && shipments.length > 0) {
      setExpandedSuppliers(new Set([initialSupplier]));
    }
  }, [initialSupplier, shipments]);

  async function loadShipmentHistory() {
    setLoading(true);

    const { data: packingLists } = await supabase
      .from('pl_input')
      .select(`
        id,
        packing_list_no,
        supplier_name,
        status,
        date,
        packing_list_items (
          id,
          item_name,
          quantity,
          unit,
          no_of_pkgs,
          cbm,
          weight_kg
        )
      `)
      .order('date', { ascending: false });

    const { data: bills } = await supabase
      .from('purchase_bills')
      .select('batch_number')
      .not('batch_number', 'is', null);

    const batches = [...new Set(bills?.map(b => b.batch_number).filter(Boolean) || [])];
    setAllBatches(batches as string[]);

    if (packingLists) {
      const supplierMap = new Map<string, SupplierShipments>();
      let totalShipments = 0;
      let totalCartons = 0;
      let totalCbm = 0;
      let totalWeight = 0;

      packingLists.forEach((pl) => {
        const items = pl.packing_list_items as PackingListItem[] || [];
        const plCartons = items.reduce((sum, item) => sum + (item.no_of_pkgs || 0), 0);
        const plCbm = items.reduce((sum, item) => sum + (item.cbm || 0), 0);
        const plWeight = items.reduce((sum, item) => sum + (item.weight_kg || 0), 0);

        const packingList: PackingList = {
          id: pl.id,
          packing_list_no: pl.packing_list_no,
          supplier_name: pl.supplier_name,
          status: pl.status,
          date: pl.date,
          batch_number: null,
          total_cartons: plCartons,
          total_cbm: plCbm,
          total_weight: plWeight,
          items,
        };

        const existing = supplierMap.get(pl.supplier_name);
        if (existing) {
          existing.total_shipments += 1;
          existing.total_cartons += plCartons;
          existing.total_cbm += plCbm;
          existing.packing_lists.push(packingList);
        } else {
          supplierMap.set(pl.supplier_name, {
            supplier_name: pl.supplier_name,
            total_shipments: 1,
            total_cartons: plCartons,
            total_cbm: plCbm,
            packing_lists: [packingList],
          });
        }

        totalShipments += 1;
        totalCartons += plCartons;
        totalCbm += plCbm;
        totalWeight += plWeight;
      });

      const supplierList = Array.from(supplierMap.values())
        .sort((a, b) => b.total_shipments - a.total_shipments);

      setShipments(supplierList);
      setTotals({ shipments: totalShipments, cartons: totalCartons, cbm: totalCbm, weight: totalWeight });
    }

    setLoading(false);
  }

  function toggleSupplier(supplier: string) {
    const newExpanded = new Set(expandedSuppliers);
    if (newExpanded.has(supplier)) {
      newExpanded.delete(supplier);
    } else {
      newExpanded.add(supplier);
    }
    setExpandedSuppliers(newExpanded);
  }

  function togglePL(plId: string) {
    const newExpanded = new Set(expandedPLs);
    if (newExpanded.has(plId)) {
      newExpanded.delete(plId);
    } else {
      newExpanded.add(plId);
    }
    setExpandedPLs(newExpanded);
  }

  function getStatusColor(status: string) {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'bg-amber-100 text-amber-700';
      case 'shipped':
        return 'bg-cyan-100 text-cyan-700';
      case 'received':
        return 'bg-green-100 text-green-700';
      case 'expected':
        return 'bg-teal-100 text-teal-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  }

  function getStatusIcon(status: string) {
    switch (status.toLowerCase()) {
      case 'pending':
        return <Clock className="w-3 h-3" />;
      case 'shipped':
        return <Ship className="w-3 h-3" />;
      case 'received':
        return <CheckCircle className="w-3 h-3" />;
      case 'expected':
        return <Truck className="w-3 h-3" />;
      default:
        return <Package className="w-3 h-3" />;
    }
  }

  const filteredShipments = shipments.map(supplier => ({
    ...supplier,
    packing_lists: supplier.packing_lists.filter(pl => {
      const matchesSearch =
        pl.packing_list_no.toLowerCase().includes(searchTerm.toLowerCase()) ||
        pl.supplier_name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || pl.status.toLowerCase() === statusFilter.toLowerCase();
      const matchesBatch = !batchFilter || pl.batch_number === batchFilter;
      return matchesSearch && matchesStatus && matchesBatch;
    })
  })).filter(supplier =>
    supplier.supplier_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    supplier.packing_lists.length > 0
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-cyan-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-cyan-500 to-teal-600 rounded-xl">
            <Ship className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Shipment History</h2>
            <p className="text-sm text-gray-500">Track shipments by supplier and batch</p>
          </div>
        </div>
        <button
          onClick={loadShipmentHistory}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
        <button
          onClick={() => setShowPrintView(true)}
          disabled={filteredShipments.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <Printer className="w-4 h-4" />
          Print / PDF
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-50 rounded-lg">
              <Package className="w-5 h-5 text-cyan-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Shipments</p>
              <p className="text-2xl font-bold text-gray-900">{totals.shipments}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-50 rounded-lg">
              <Box className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Cartons</p>
              <p className="text-2xl font-bold text-gray-900">{totals.cartons.toLocaleString()}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-50 rounded-lg">
              <Truck className="w-5 h-5 text-teal-700" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total CBM</p>
              <p className="text-2xl font-bold text-gray-900">{totals.cbm.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <Building2 className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total Weight</p>
              <p className="text-2xl font-bold text-gray-900">{totals.weight.toFixed(1)} kg</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by supplier or PL number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="shipped">Shipped</option>
              <option value="expected">Expected</option>
              <option value="received">Received</option>
            </select>
          </div>
          {allBatches.length > 0 && (
            <div className="flex items-center gap-2">
              <Hash className="w-4 h-4 text-gray-500" />
              <select
                value={batchFilter}
                onChange={(e) => setBatchFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
              >
                <option value="">All Batches</option>
                {allBatches.map(batch => (
                  <option key={batch} value={batch}>{batch}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {filteredShipments.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No shipments found</p>
          </div>
        ) : (
          filteredShipments.map((supplier) => (
            <div key={supplier.supplier_name} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button
                onClick={() => toggleSupplier(supplier.supplier_name)}
                className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <Building2 className="w-5 h-5 text-gray-600" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-gray-900">{supplier.supplier_name}</p>
                    <p className="text-sm text-gray-500">
                      {supplier.packing_lists.length} shipment{supplier.packing_lists.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Cartons</p>
                    <p className="text-sm font-bold text-gray-900">{supplier.total_cartons.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">CBM</p>
                    <p className="text-sm font-bold text-cyan-600">{supplier.total_cbm.toFixed(2)}</p>
                  </div>
                  {expandedSuppliers.has(supplier.supplier_name) ? (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  )}
                </div>
              </button>

              {expandedSuppliers.has(supplier.supplier_name) && (
                <div className="border-t border-gray-200">
                  <div className="divide-y divide-gray-100">
                    {supplier.packing_lists.map((pl) => (
                      <div key={pl.id}>
                        <button
                          onClick={() => togglePL(pl.id)}
                          className="w-full px-5 py-3 flex items-center justify-between hover:bg-cyan-50 transition-colors"
                        >
                          <div className="flex items-center gap-4">
                            <div className="p-1.5 bg-cyan-100 rounded">
                              <FileText className="w-4 h-4 text-cyan-600" />
                            </div>
                            <div className="text-left">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900">PL #{pl.packing_list_no}</span>
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(pl.status)}`}>
                                  {getStatusIcon(pl.status)}
                                  {pl.status}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3 h-3" />
                                  {new Date(pl.date).toLocaleDateString()}
                                </span>
                                {pl.batch_number && (
                                  <span className="flex items-center gap-1">
                                    <Hash className="w-3 h-3" />
                                    {pl.batch_number}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right text-xs">
                              <p className="text-gray-500">{pl.total_cartons} ctns</p>
                              <p className="text-cyan-600 font-medium">{pl.total_cbm.toFixed(2)} CBM</p>
                            </div>
                            {expandedPLs.has(pl.id) ? (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-400" />
                            )}
                          </div>
                        </button>

                        {expandedPLs.has(pl.id) && pl.items.length > 0 && (
                          <div className="bg-gray-50 px-5 py-3">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-gray-500 uppercase">
                                  <th className="text-left py-2">Product</th>
                                  <th className="text-right py-2">Qty</th>
                                  <th className="text-right py-2">Cartons</th>
                                  <th className="text-right py-2">CBM</th>
                                  <th className="text-right py-2">Weight</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {pl.items.map((item) => (
                                  <tr key={item.id}>
                                    <td className="py-2 text-gray-900">{item.item_name}</td>
                                    <td className="py-2 text-right text-gray-600">{item.quantity} {item.unit}</td>
                                    <td className="py-2 text-right text-gray-600">{item.no_of_pkgs}</td>
                                    <td className="py-2 text-right text-gray-600">{item.cbm?.toFixed(3) || '-'}</td>
                                    <td className="py-2 text-right text-gray-600">{item.weight_kg?.toFixed(1) || '-'} kg</td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot className="border-t border-gray-300 font-medium">
                                <tr>
                                  <td className="py-2">Total</td>
                                  <td className="py-2 text-right">{pl.items.reduce((s, i) => s + i.quantity, 0)}</td>
                                  <td className="py-2 text-right">{pl.total_cartons}</td>
                                  <td className="py-2 text-right">{pl.total_cbm.toFixed(3)}</td>
                                  <td className="py-2 text-right">{pl.total_weight.toFixed(1)} kg</td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {showPrintView && (
        <ShipmentHistoryPrint
          shipments={filteredShipments}
          batchFilter={batchFilter || undefined}
          totals={totals}
          onClose={() => setShowPrintView(false)}
        />
      )}
    </div>
  );
}
