import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  History,
  ChevronDown,
  ChevronRight,
  Package,
  Calendar,
  Hash,
  X,
  Trash2,
  Search,
} from 'lucide-react';

interface ImportRecord {
  id: string;
  import_date: string;
  items_count: number;
  total_quantity: number;
  notes: string | null;
}

interface ImportDetail {
  id: string;
  item_code: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  location: string | null;
}

interface ProductSuggestion {
  item_name: string;
  item_code: string;
}

export default function ImportHistory() {
  const [history, setHistory] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, ImportDetail[]>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductSuggestion | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [filteredImportIds, setFilteredImportIds] = useState<Set<string> | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      if (searchQuery.trim().length >= 1) {
        searchProducts(searchQuery);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 200);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery]);

  async function searchProducts(query: string) {
    setLoadingSuggestions(true);
    const { data, error } = await supabase
      .from('stock_import_details')
      .select('item_name, item_code')
      .or(`item_name.ilike.%${query}%,item_code.ilike.%${query}%`)
      .order('item_name')
      .limit(50);

    if (!error && data) {
      const uniqueProducts = data.reduce((acc: ProductSuggestion[], item) => {
        const key = `${item.item_name}-${item.item_code}`;
        if (!acc.find((p) => `${p.item_name}-${p.item_code}` === key)) {
          acc.push({ item_name: item.item_name, item_code: item.item_code });
        }
        return acc;
      }, []);
      setSuggestions(uniqueProducts);
      setShowSuggestions(true);
    }
    setLoadingSuggestions(false);
  }

  async function selectProduct(product: ProductSuggestion) {
    setSelectedProduct(product);
    setSearchQuery(product.item_name);
    setShowSuggestions(false);

    const { data } = await supabase
      .from('stock_import_details')
      .select('import_id')
      .eq('item_name', product.item_name);

    if (data) {
      const importIds = new Set(data.map((d) => d.import_id));
      setFilteredImportIds(importIds);
      importIds.forEach((id) => loadDetails(id));
    }
  }

  function clearSearch() {
    setSearchQuery('');
    setSelectedProduct(null);
    setSuggestions([]);
    setFilteredImportIds(null);
  }

  async function loadHistory() {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from('stock_import_history')
      .select('*')
      .order('import_date', { ascending: false });

    if (queryError) {
      console.error('Error loading import history:', queryError);
      setError(queryError.message);
    } else {
      setHistory(data || []);
    }
    setLoading(false);
  }

  async function loadDetails(importId: string) {
    if (details[importId]) return;

    setLoadingDetails((prev) => ({ ...prev, [importId]: true }));
    const { data, error } = await supabase
      .from('stock_import_details')
      .select('*')
      .eq('import_id', importId)
      .order('item_name');

    if (error) {
      console.error('Error loading import details:', error);
    } else {
      setDetails((prev) => ({ ...prev, [importId]: data || [] }));
    }
    setLoadingDetails((prev) => ({ ...prev, [importId]: false }));
  }

  function toggleExpand(importId: string) {
    if (expandedId === importId) {
      setExpandedId(null);
    } else {
      setExpandedId(importId);
      loadDetails(importId);
    }
  }

  async function handleDelete(importId: string) {
    if (!confirm('Delete this import record? This action cannot be undone.')) return;

    const { error } = await supabase.from('stock_import_history').delete().eq('id', importId);

    if (error) {
      alert('Error deleting import: ' + error.message);
    } else {
      setHistory((prev) => prev.filter((h) => h.id !== importId));
      if (expandedId === importId) setExpandedId(null);
    }
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 border-b border-gray-200 pb-0">
        <div className="flex items-center gap-2 px-5 py-3 text-sm font-semibold text-teal-700 border-b-2 border-teal-600 -mb-px">
          <History className="w-4 h-4" />
          Import History
          {history.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-bold bg-teal-100 text-teal-700">
              {history.length}
            </span>
          )}
        </div>
      </div>

      <div>
        <div className="space-y-4">
          <div ref={searchRef} className="relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (selectedProduct && e.target.value !== selectedProduct.item_name) {
                    setSelectedProduct(null);
                  }
                }}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                placeholder="Search product by name or SKU..."
                className="w-full pl-10 pr-10 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all"
              />
              {(searchQuery || selectedProduct) && (
                <button
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            {showSuggestions && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
                {loadingSuggestions ? (
                  <div className="p-4 text-center text-gray-500">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-teal-600 mx-auto"></div>
                  </div>
                ) : suggestions.length > 0 ? (
                  suggestions.map((product, idx) => (
                    <button
                      key={`${product.item_name}-${product.item_code}-${idx}`}
                      onClick={() => selectProduct(product)}
                      className="w-full px-4 py-3 text-left hover:bg-teal-50 flex items-center justify-between border-b border-gray-50 last:border-0 transition-colors"
                    >
                      <span className="font-medium text-gray-900">{product.item_name}</span>
                      {product.item_code && (
                        <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                          {product.item_code}
                        </span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="p-4 text-center text-gray-500">No products found</div>
                )}
              </div>
            )}
            {selectedProduct && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-gray-600">Filtering by:</span>
                <span className="inline-flex items-center gap-1 bg-teal-100 text-teal-800 px-3 py-1 rounded-full text-sm font-medium">
                  {selectedProduct.item_name}
                  {selectedProduct.item_code && (
                    <span className="text-teal-600">({selectedProduct.item_code})</span>
                  )}
                  <button onClick={clearSearch} className="ml-1 hover:text-teal-900">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800 text-sm">
                <strong>Error loading history:</strong> {error}
              </p>
            </div>
          )}

          {history.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <Package className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 font-medium text-lg">No import history found</p>
              <p className="text-gray-400 text-sm mt-2">
                Import stock data to see history records here
              </p>
            </div>
          ) : filteredImportIds && filteredImportIds.size === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 font-medium text-lg">No imports found for this product</p>
              <p className="text-gray-400 text-sm mt-2">
                This product has not been imported yet
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {history
                .filter((item) => !filteredImportIds || filteredImportIds.has(item.id))
                .map((item) => (
                <div
                  key={item.id}
                  className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-all"
                >
                  <div className="p-4 flex items-center justify-between">
                    <button
                      onClick={() => toggleExpand(item.id)}
                      className="flex items-center flex-1 text-left"
                    >
                      {expandedId === item.id ? (
                        <ChevronDown className="w-5 h-5 text-teal-600 mr-3 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-gray-400 mr-3 flex-shrink-0" />
                      )}
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="flex items-center">
                          <Calendar className="w-4 h-4 text-teal-600 mr-2" />
                          <span className="text-sm font-semibold text-gray-900">
                            {formatDate(item.import_date)}
                          </span>
                        </div>
                        {selectedProduct && details[item.id] ? (
                          <div className="flex items-center md:col-span-2">
                            <Package className="w-4 h-4 text-teal-600 mr-2" />
                            <span className="text-sm text-teal-700 font-semibold">
                              {details[item.id]
                                .filter((d) => d.item_name === selectedProduct.item_name)
                                .reduce((sum, d) => sum + d.quantity, 0)
                                .toLocaleString(undefined, { maximumFractionDigits: 0 })}{' '}
                              units
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center">
                              <Package className="w-4 h-4 text-teal-700 mr-2" />
                              <span className="text-sm text-gray-700">
                                <span className="font-semibold">{item.items_count}</span> items
                              </span>
                            </div>
                            <div className="flex items-center">
                              <Hash className="w-4 h-4 text-gray-500 mr-2" />
                              <span className="text-sm text-gray-700">
                                <span className="font-semibold">
                                  {item.total_quantity.toLocaleString(undefined, {
                                    maximumFractionDigits: 0,
                                  })}
                                </span>{' '}
                                total qty
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="ml-4 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete import"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {item.notes && (
                    <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 mx-4 mb-3 rounded-lg">
                      <p className="text-sm text-gray-600">{item.notes}</p>
                    </div>
                  )}

                  {expandedId === item.id && (
                    <div className="border-t border-gray-100">
                      {loadingDetails[item.id] ? (
                        <div className="p-8 flex justify-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
                        </div>
                      ) : details[item.id] && details[item.id].length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-100">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-5 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                                  Item Name
                                </th>
                                <th className="px-5 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                                  SKU
                                </th>
                                <th className="px-5 py-3 text-right text-xs font-bold text-gray-600 uppercase tracking-wider">
                                  Quantity
                                </th>
                                {details[item.id].some((d) => d.location) && (
                                  <th className="px-5 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                                    Location
                                  </th>
                                )}
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-50">
                              {details[item.id]
                                .filter(
                                  (detail) =>
                                    !selectedProduct ||
                                    detail.item_name === selectedProduct.item_name
                                )
                                .map((detail) => (
                                <tr key={detail.id} className="hover:bg-gray-50 transition-colors">
                                  <td className="px-5 py-3 text-sm font-medium text-gray-900">
                                    {detail.item_name}
                                  </td>
                                  <td className="px-5 py-3 text-sm text-gray-500">
                                    {detail.item_code || '-'}
                                  </td>
                                  <td className="px-5 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">
                                    {detail.quantity.toLocaleString(undefined, {
                                      maximumFractionDigits: 0,
                                    })}
                                  </td>
                                  {details[item.id].some((d) => d.location) && (
                                    <td className="px-5 py-3 text-sm text-gray-500">
                                      {detail.location || '-'}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="p-8 text-center">
                          <X className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                          <p className="text-gray-400 text-sm">No details available for this import</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
