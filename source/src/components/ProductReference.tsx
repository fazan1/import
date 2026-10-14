import { useState, useEffect, useMemo, useRef } from 'react';
import { ShoppingBag, Plus, Search, X, Trash2, Copy, ChevronDown, ChevronRight, Check, Pencil, RefreshCw, Tag, FileDown, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import ProductReferencePrint from './ProductReferencePrint';
import { supabase } from '../lib/supabase';
import { moveToRecycleBin } from '../lib/recycleBin';

interface AlibabaProduct {
  id: string;
  product_name: string;
  category: string | null;
  supplier_name: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  contact_wechat: string | null;
  unit_price: number;
  currency: string;
  moq: number;
  unit: string;
  weight_kg: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  cbm_per_unit: number;
  number_of_ctns: number;
  quantity: number;
  total_cbm: number;
  total_weight_kg: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const UNITS = ['Piece', 'kg', 'Meter', 'Liter', 'Box', 'Set', 'Roll', 'Pack', 'Ton', 'Bundle', 'Pair', 'Carton'];
const CURRENCIES = ['CNY', 'USD'];
const DEFAULT_CATEGORIES = ['Steel', 'Hardware', 'Fittings', 'Tools', 'Electrical', 'Building Materials', 'Machinery', 'Packaging', 'Raw Materials', 'Other'];

const emptyForm = {
  product_name: '',
  category: '',
  supplier_name: '',
  contact_person: '',
  contact_phone: '',
  contact_wechat: '',
  unit_price: '',
  currency: 'CNY',
  moq: '',
  unit: 'Piece',
  weight_kg: '',
  length_cm: '',
  width_cm: '',
  height_cm: '',
  cbm_per_unit: '',
  number_of_ctns: '',
  quantity: '',
  notes: '',
};

/** Total CBM = cartons x volume of 1 carton; without a carton count, quantity x carton volume (the old way). */
function totalCbmOf(ctns: number, ctnVolume: number, qty: number): number {
  return ctns > 0 ? ctns * ctnVolume : qty * ctnVolume;
}

export default function ProductReference() {
  const [products, setProducts] = useState<AlibabaProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const cbmManualRef = useRef(false);
  const [editingProduct, setEditingProduct] = useState<AlibabaProduct | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [showPrintView, setShowPrintView] = useState(false);

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    const { data, error } = await supabase
      .from('alibaba_products')
      .select('*')
      .eq('is_active', true)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Load error:', error);
      alert('Could not load products: ' + error.message);
    } else if (data) {
      // Total CBM = No. of CTN x 1 CTN volume (older records were saved as quantity x CTN volume)
      setProducts(data.map((p) => ({ ...p, total_cbm: totalCbmOf(Number(p.number_of_ctns) || 0, Number(p.cbm_per_unit) || 0, Number(p.quantity) || 0) })));
    }
    setLoading(false);
  }

  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category).filter(Boolean) as string[]);
    DEFAULT_CATEGORIES.forEach(c => cats.add(c));
    return [...cats].sort();
  }, [products]);

  const suppliers = useMemo(() => {
    const sups = new Set(products.map(p => p.supplier_name).filter(Boolean) as string[]);
    return [...sups].sort();
  }, [products]);

  function openForm(product?: AlibabaProduct) {
    if (product) {
      setEditingProduct(product);
      setFormData({
        product_name: product.product_name,
        category: product.category || '',
        supplier_name: product.supplier_name || '',
        contact_person: product.contact_person || '',
        contact_phone: product.contact_phone || '',
        contact_wechat: product.contact_wechat || '',
          unit_price: product.unit_price ? String(product.unit_price) : '',
        currency: product.currency || 'CNY',
        moq: product.moq ? String(product.moq) : '',
        unit: product.unit || 'Piece',
        weight_kg: product.weight_kg ? String(product.weight_kg) : '',
        length_cm: product.length_cm ? String(product.length_cm) : '',
        width_cm: product.width_cm ? String(product.width_cm) : '',
        height_cm: product.height_cm ? String(product.height_cm) : '',
        cbm_per_unit: product.cbm_per_unit ? String(product.cbm_per_unit) : '',
        number_of_ctns: product.number_of_ctns ? String(product.number_of_ctns) : '',
        quantity: product.quantity ? String(product.quantity) : '',
        notes: product.notes || '',
      });
    } else {
      setEditingProduct(null);
      setFormData({ ...emptyForm });
    }
    cbmManualRef.current = product ? !!product.cbm_per_unit : false;
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingProduct(null);
  }

  function updateFormField(field: string, value: string) {
    setFormData(prev => {
      const next = { ...prev, [field]: value };

      if (field === 'cbm_per_unit') {
        cbmManualRef.current = value !== '';
      }

      if (['length_cm', 'width_cm', 'height_cm'].includes(field) && !cbmManualRef.current) {
        const l = parseFloat(field === 'length_cm' ? value : next.length_cm) || 0;
        const w = parseFloat(field === 'width_cm' ? value : next.width_cm) || 0;
        const h = parseFloat(field === 'height_cm' ? value : next.height_cm) || 0;
        if (l > 0 && w > 0 && h > 0) {
          next.cbm_per_unit = ((l * w * h) / 1000000).toFixed(6);
        }
      }

      return next;
    });
  }

  async function saveProduct() {
    if (!formData.product_name.trim()) {
      alert('Product name is required');
      return;
    }
    setSaving(true);

    const qty = parseFloat(formData.quantity) || 0;
    const weightPerUnit = parseFloat(formData.weight_kg) || 0;
    const cbmPerUnit = parseFloat(formData.cbm_per_unit) || 0;

    const payload = {
      product_name: formData.product_name.trim(),
      category: formData.category.trim() || null,
      supplier_name: formData.supplier_name.trim() || null,
      contact_person: formData.contact_person.trim() || null,
      contact_phone: formData.contact_phone.trim() || null,
      contact_wechat: formData.contact_wechat.trim() || null,
      unit_price: parseFloat(formData.unit_price) || 0,
      currency: formData.currency,
      moq: parseFloat(formData.moq) || 0,
      unit: formData.unit,
      weight_kg: weightPerUnit,
      length_cm: parseFloat(formData.length_cm) || 0,
      width_cm: parseFloat(formData.width_cm) || 0,
      height_cm: parseFloat(formData.height_cm) || 0,
      cbm_per_unit: cbmPerUnit,
      number_of_ctns: parseFloat(formData.number_of_ctns) || 0,
      quantity: qty,
      total_cbm: totalCbmOf(parseFloat(formData.number_of_ctns) || 0, cbmPerUnit, qty),
      total_weight_kg: qty * weightPerUnit,
      notes: formData.notes.trim() || null,
    };

    let result;
    if (editingProduct) {
      result = await supabase
        .from('alibaba_products')
        .update(payload)
        .eq('id', editingProduct.id)
        .select();
    } else {
      result = await supabase
        .from('alibaba_products')
        .insert(payload)
        .select();
    }

    if (result.error) {
      console.error('Save error:', result.error);
      alert('Failed to save: ' + result.error.message);
      setSaving(false);
      return;
    }

    closeForm();
    await loadProducts();
    setSaving(false);
  }

  async function deleteProduct(product: AlibabaProduct) {
    if (!confirm(`Delete "${product.product_name}"? It will be moved to the Recycle Bin.`)) return;

    const result = await moveToRecycleBin({
      source_table: 'alibaba_products',
      source_id: product.id,
      record_data: product,
      display_name: `Product: ${product.product_name}`,
      portal: 'cn',
    });

    if (!result.success) {
      alert('Failed to move to recycle bin: ' + result.error);
      return;
    }

    const { error } = await supabase.from('alibaba_products').delete().eq('id', product.id);
    if (error) {
      alert('Could not delete the product (a copy was put in the Recycle Bin; remove it there): ' + error.message);
      return;
    }
    loadProducts();
  }

  function copyToClipboard(product: AlibabaProduct) {
    const lines = [
      `Product: ${product.product_name}`,
      product.supplier_name ? `Supplier: ${product.supplier_name}` : '',
      product.unit_price ? `Price: ${product.currency} ${product.unit_price} per ${product.unit}` : '',
      product.moq ? `MOQ: ${product.moq} ${product.unit}` : '',
      product.weight_kg ? `Weight: ${product.weight_kg} KG per ${product.unit}` : '',
      (product.length_cm && product.width_cm && product.height_cm)
        ? `Dimensions: ${product.length_cm} x ${product.width_cm} x ${product.height_cm} cm`
        : '',
      product.cbm_per_unit ? `CBM/Unit: ${product.cbm_per_unit}` : '',
      product.quantity ? `Qty: ${product.quantity} ${product.unit}` : '',
      product.total_cbm ? `Total CBM: ${product.total_cbm.toFixed(4)}` : '',
      product.total_weight_kg ? `Total Weight: ${product.total_weight_kg.toFixed(2)} KG` : '',
      product.notes ? `Notes: ${product.notes}` : '',
    ].filter(Boolean).join('\n');

    navigator.clipboard.writeText(lines);
    setCopiedId(product.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const filteredProducts = products.filter(p => {
    const matchesSearch = !searchTerm ||
      p.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.supplier_name?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (p.category?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (p.notes?.toLowerCase() || '').includes(searchTerm.toLowerCase());
    const matchesCategory = !categoryFilter || p.category === categoryFilter;
    const matchesSupplier = !supplierFilter || p.supplier_name === supplierFilter;
    return matchesSearch && matchesCategory && matchesSupplier;
  });

  function exportToExcel() {
    const headers = [
      'Product Name', 'Category', 'Supplier', 'Contact Person', 'Phone/WhatsApp', 'WeChat',
      'Unit Price', 'Currency', 'MOQ', 'Unit', 'Weight/Unit (KG)',
      'L (cm)', 'W (cm)', 'H (cm)', 'CBM/Unit', 'Quantity',
      'Total Weight (KG)', 'Total CBM', 'Notes'
    ];
    const data = filteredProducts.map(p => [
      p.product_name,
      p.category || '',
      p.supplier_name || '',
      p.contact_person || '',
      p.contact_phone || '',
      p.contact_wechat || '',
      p.unit_price || '',
      p.currency,
      p.moq || '',
      p.unit,
      p.weight_kg || '',
      p.length_cm || '',
      p.width_cm || '',
      p.height_cm || '',
      p.cbm_per_unit || '',
      p.quantity || '',
      p.total_weight_kg || '',
      p.total_cbm || '',
      p.notes || ''
    ]);

    const wsData: (string | number)[][] = [
      ['Product Reference Sheet'],
      [`Generated: ${new Date().toLocaleDateString('en-GB')}`, '', `${filteredProducts.length} products`],
      [],
      headers,
      ...data,
      [],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'TOTALS:',
        Number(filteredProducts.reduce((s, p) => s + (p.total_weight_kg || 0), 0).toFixed(1)),
        Number(filteredProducts.reduce((s, p) => s + (p.total_cbm || 0), 0).toFixed(4)),
        ''
      ]
    ];

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [
      { wch: 30 }, { wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 14 },
      { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 12 },
      { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
      { wch: 14 }, { wch: 12 }, { wch: 30 }
    ];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Products');
    XLSX.writeFile(wb, `Product_Reference_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  function formatPrice(product: AlibabaProduct) {
    if (!product.unit_price) return '-';
    return `${product.currency} ${product.unit_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Reference</h1>
          <p className="text-sm text-gray-500 mt-1">Alibaba product details for quick customer replies</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filteredProducts.length > 0 && (
            <>
              <button
                onClick={exportToExcel}
                className="flex items-center gap-1.5 px-3 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium"
                title="Export to Excel"
              >
                <FileSpreadsheet className="w-4 h-4 text-green-600" />
                Excel
              </button>
              <button
                onClick={() => setShowPrintView(true)}
                className="flex items-center gap-1.5 px-3 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-colors text-sm font-medium"
                title="PDF / Print Preview"
              >
                <FileDown className="w-4 h-4 text-teal-700" />
                PDF
              </button>
            </>
          )}
          <button
            onClick={() => openForm()}
            className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors font-medium shadow-sm"
          >
            <Plus className="w-5 h-5" />
            Add Product
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search products, suppliers, notes..."
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
          >
            <option value="">All Suppliers</option>
            {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <button
            onClick={() => { setSearchTerm(''); setCategoryFilter(''); setSupplierFilter(''); }}
            className="px-3 py-2.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Clear Filters"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <div className="text-sm text-gray-500 ml-auto">
            {filteredProducts.length} of {products.length} products
          </div>
        </div>
      </div>

      {/* Product List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl shadow-sm border border-gray-100">
          <ShoppingBag className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">
            {products.length === 0 ? 'No products saved yet' : 'No products match your search'}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            {products.length === 0
              ? 'Add products from your Alibaba chats to reference them later'
              : 'Try adjusting your search or filters'}
          </p>
          {products.length === 0 && (
            <button onClick={() => openForm()} className="mt-4 px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700 transition-colors">
              Add Your First Product
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredProducts.map((product) => {
            const isExpanded = expandedId === product.id;
            return (
              <div key={product.id} className="bg-white rounded-xl shadow-sm border border-gray-100 hover:border-gray-200 transition-all">
                {/* Collapsed Row */}
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : product.id)}
                >
                  <button className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                    {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 truncate">{product.product_name}</h3>
                      {product.category && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full font-medium flex-shrink-0">
                          {product.category}
                        </span>
                      )}
                    </div>
                    {product.supplier_name && (
                      <p className="text-sm text-gray-500 truncate mt-0.5">{product.supplier_name}</p>
                    )}
                  </div>

                  <div className="hidden sm:flex items-center gap-6 text-sm flex-shrink-0">
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{formatPrice(product)}</p>
                      <p className="text-xs text-gray-500">per {product.unit}</p>
                    </div>
                    {product.moq > 0 && (
                      <div className="text-right">
                        <p className="font-medium text-gray-700">{product.moq.toLocaleString()}</p>
                        <p className="text-xs text-gray-500">MOQ</p>
                      </div>
                    )}
                    {product.weight_kg > 0 && (
                      <div className="text-right">
                        <p className="font-medium text-gray-700">{product.weight_kg} KG</p>
                        <p className="text-xs text-gray-500">Weight</p>
                      </div>
                    )}
                    {product.cbm_per_unit > 0 && (
                      <div className="text-right">
                        <p className="font-medium text-gray-700">{product.cbm_per_unit}</p>
                        <p className="text-xs text-gray-500">1 CTN Vol</p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => copyToClipboard(product)}
                      className={`p-2 rounded-lg transition-colors ${copiedId === product.id ? 'text-green-600 bg-green-50' : 'text-gray-400 hover:text-teal-700 hover:bg-teal-50'}`}
                      title="Copy details to clipboard"
                    >
                      {copiedId === product.id ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => openForm(product)}
                      className="p-2 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteProduct(product)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-gray-100 px-4 pb-4 pt-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
                      <DetailItem label="Price" value={product.unit_price ? `${product.currency} ${product.unit_price.toLocaleString(undefined, { minimumFractionDigits: 2 })} / ${product.unit}` : '-'} />
                      <DetailItem label="MOQ" value={product.moq ? `${product.moq.toLocaleString()} ${product.unit}` : '-'} />
                      <DetailItem label="Weight / Unit" value={product.weight_kg ? `${product.weight_kg} KG` : '-'} />
                      <DetailItem label="1 CTN Volume (CBM)" value={product.cbm_per_unit ? String(product.cbm_per_unit) : '-'} />
                      <DetailItem label="No. of CTN" value={product.number_of_ctns ? String(product.number_of_ctns) : '-'} />

                      <DetailItem label="Dimensions (L x W x H)" value={
                        (product.length_cm && product.width_cm && product.height_cm)
                          ? `${product.length_cm} x ${product.width_cm} x ${product.height_cm} cm`
                          : '-'
                      } />
                      <DetailItem label="Quantity" value={product.quantity ? `${product.quantity.toLocaleString()} ${product.unit}` : '-'} />
                      <DetailItem label="Total Weight" value={product.total_weight_kg ? `${product.total_weight_kg.toFixed(2)} KG` : '-'} />
                      <DetailItem label="Total CBM" value={product.total_cbm ? product.total_cbm.toFixed(4) : '-'} />
                      <DetailItem label="CBM / Piece" value={product.total_cbm && product.quantity ? (product.total_cbm / product.quantity).toFixed(6) : '-'} />

                      <DetailItem label="Supplier" value={product.supplier_name || '-'} />
                      <DetailItem label="Contact Person" value={product.contact_person || '-'} />
                      <DetailItem label="Phone" value={product.contact_phone || '-'} />
                      <DetailItem label="WeChat" value={product.contact_wechat || '-'} />
                    </div>


                    {product.notes && (
                      <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
                        <p className="text-xs font-medium text-amber-700 mb-1">Notes</p>
                        <p className="text-sm text-amber-900 whitespace-pre-wrap">{product.notes}</p>
                      </div>
                    )}

                    <div className="mt-3 text-xs text-gray-400">
                      Added: {new Date(product.created_at).toLocaleDateString('en-GB')}
                      {product.updated_at !== product.created_at && (
                        <> &middot; Updated: {new Date(product.updated_at).toLocaleDateString('en-GB')}</>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center">
                  <ShoppingBag className="w-5 h-5 text-teal-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">
                    {editingProduct ? 'Edit Product' : 'Add Product'}
                  </h2>
                  <p className="text-xs text-gray-500">Save product details from Alibaba chat</p>
                </div>
              </div>
              <button onClick={closeForm} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Product Info */}
              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" />
                  Product Info
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Product Name <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      value={formData.product_name}
                      onChange={(e) => updateFormField('product_name', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="e.g. Stainless Steel Pipe 304"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                    <select
                      value={formData.category}
                      onChange={(e) => updateFormField('category', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white"
                    >
                      <option value="">Select category</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>

                </div>
              </section>

              {/* Supplier Info */}
              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Supplier Info</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Name</label>
                    <input
                      type="text"
                      value={formData.supplier_name}
                      onChange={(e) => updateFormField('supplier_name', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="Alibaba store name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                    <input
                      type="text"
                      value={formData.contact_person}
                      onChange={(e) => updateFormField('contact_person', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="Name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone / WhatsApp</label>
                    <input
                      type="text"
                      value={formData.contact_phone}
                      onChange={(e) => updateFormField('contact_phone', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="+86..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">WeChat</label>
                    <input
                      type="text"
                      value={formData.contact_wechat}
                      onChange={(e) => updateFormField('contact_wechat', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="WeChat ID"
                    />
                  </div>
                </div>
              </section>

              {/* Pricing */}
              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Pricing</h3>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Unit Price</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.unit_price}
                      onChange={(e) => updateFormField('unit_price', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                    <select
                      value={formData.currency}
                      onChange={(e) => updateFormField('currency', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white"
                    >
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">MOQ</label>
                    <input
                      type="number"
                      value={formData.moq}
                      onChange={(e) => updateFormField('moq', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="Min order qty"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                    <select
                      value={formData.unit}
                      onChange={(e) => updateFormField('unit', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white"
                    >
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                </div>
              </section>

              {/* Shipping Details */}
              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Shipping Details</h3>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Weight/Unit (KG)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.weight_kg}
                      onChange={(e) => updateFormField('weight_kg', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Length (cm)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.length_cm}
                      onChange={(e) => updateFormField('length_cm', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Width (cm)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.width_cm}
                      onChange={(e) => updateFormField('width_cm', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Height (cm)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={formData.height_cm}
                      onChange={(e) => updateFormField('height_cm', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">1 CTN Volume (CBM)</label>
                    <input
                      type="number"
                      step="0.000001"
                      value={formData.cbm_per_unit}
                      onChange={(e) => updateFormField('cbm_per_unit', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-gray-50"
                      placeholder="Auto-calculated"
                    />
                    <p className="text-xs text-gray-400 mt-0.5">L x W x H / 1,000,000</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">No. of CTN</label>
                    <input
                      type="number"
                      value={formData.number_of_ctns}
                      onChange={(e) => updateFormField('number_of_ctns', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="Number of cartons"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                    <input
                      type="number"
                      value={formData.quantity}
                      onChange={(e) => updateFormField('quantity', e.target.value)}
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                      placeholder="Order quantity"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Totals</label>
                    <div className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                      {(() => {
                        const qty = parseFloat(formData.quantity) || 0;
                        const w = parseFloat(formData.weight_kg) || 0;
                        const cbm = parseFloat(formData.cbm_per_unit) || 0;
                        const ctns = parseFloat(formData.number_of_ctns) || 0;
                        if (qty === 0 && ctns === 0) return 'Enter quantity';
                        const parts = [];
                        if (w > 0 && qty > 0) parts.push(`${(qty * w).toFixed(2)} KG`);
                        const tc = totalCbmOf(ctns, cbm, qty);
                        if (tc > 0) parts.push(`${tc.toFixed(4)} CBM`);
                        if (tc > 0 && qty > 0) parts.push(`${(tc / qty).toFixed(6)} CBM/pc`);
                        return parts.length > 0 ? parts.join(' | ') : 'Enter weight or dimensions';
                      })()}
                    </div>
                  </div>
                </div>
              </section>

              {/* Notes */}
              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Notes</h3>
                <textarea
                  value={formData.notes}
                  onChange={(e) => updateFormField('notes', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 resize-none"
                  placeholder="Additional details from Alibaba chat..."
                />
              </section>
            </div>

            <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
              <button
                onClick={closeForm}
                className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveProduct}
                disabled={saving || !formData.product_name.trim()}
                className="px-5 py-2.5 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : editingProduct ? 'Update Product' : 'Save Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrintView && (
        <ProductReferencePrint
          products={filteredProducts}
          onClose={() => setShowPrintView(false)}
        />
      )}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm text-gray-900 font-medium">{value}</p>
    </div>
  );
}
