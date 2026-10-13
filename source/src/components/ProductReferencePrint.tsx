import { X, FileDown, Search } from 'lucide-react';
import { useState } from 'react';
import { saveAsPdf } from '../lib/pdfUtils';

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

interface Props {
  products: AlibabaProduct[];
  onClose: () => void;
}

export default function ProductReferencePrint({ products, onClose }: Props) {
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = products.filter(p =>
    p.product_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.supplier_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.category || '').toLowerCase().includes(search.toLowerCase())
  );

  async function handlePrint(product: AlibabaProduct) {
    setPrintingId(product.id);
    await new Promise(r => setTimeout(r, 100));
    const filename = `${product.product_name.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
    await saveAsPdf('single-product-print', filename);
    setPrintingId(null);
  }

  function formatPrice(p: AlibabaProduct) {
    if (!p.unit_price) return '-';
    return `${p.currency} ${p.unit_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatDimensions(p: AlibabaProduct) {
    if (!p.length_cm && !p.width_cm && !p.height_cm) return '-';
    return `${p.length_cm || 0} x ${p.width_cm || 0} x ${p.height_cm || 0} cm`;
  }

  const printProduct = printingId ? products.find(p => p.id === printingId) : null;
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Save Product PDF</h2>
            <p className="text-xs text-gray-500 mt-0.5">{products.length} product{products.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        {products.length > 5 && (
          <div className="px-5 py-3 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search products..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>
        )}

        {/* Product List */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">No products found</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map(product => (
                <div
                  key={product.id}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{product.product_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {product.category && (
                        <span className="text-xs text-gray-500">{product.category}</span>
                      )}
                      {product.category && product.supplier_name && (
                        <span className="text-gray-300">&middot;</span>
                      )}
                      {product.supplier_name && (
                        <span className="text-xs text-gray-500">{product.supplier_name}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-medium text-gray-700 flex-shrink-0">
                    {formatPrice(product)}
                  </span>
                  <button
                    onClick={() => handlePrint(product)}
                    disabled={printingId !== null}
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    {printingId === product.id ? 'Saving...' : 'Save PDF'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Hidden printable card -- rendered off-screen, used by html2pdf */}
      {printProduct && (
        <div className="fixed left-[-9999px] top-0">
          <div id="single-product-print" style={{ width: '700px', fontFamily: 'Arial, sans-serif', padding: '32px', background: '#fff' }}>
            <div style={{ borderBottom: '2px solid #1f2937', paddingBottom: '16px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h1 style={{ fontSize: '22px', fontWeight: 'bold', color: '#111827', margin: 0 }}>{printProduct.product_name}</h1>
                  {printProduct.category && (
                    <span style={{ display: 'inline-block', marginTop: '8px', padding: '2px 10px', background: '#f3f4f6', borderRadius: '12px', fontSize: '11px', color: '#6b7280', border: '1px solid #e5e7eb' }}>
                      {printProduct.category}
                    </span>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ fontSize: '10px', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>Product Card</p>
                  <p style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>{dateStr}</p>
                </div>
              </div>
            </div>

            {/* Price Box */}
            <div style={{ background: '#f9fafb', borderRadius: '12px', padding: '20px', marginBottom: '20px', border: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
                <div>
                  <p style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 4px' }}>Unit Price</p>
                  <p style={{ fontSize: '22px', fontWeight: 'bold', color: '#111827', margin: 0 }}>{formatPrice(printProduct)}</p>
                  <p style={{ fontSize: '10px', color: '#9ca3af', marginTop: '2px' }}>per {printProduct.unit}</p>
                </div>
                <div style={{ borderLeft: '1px solid #e5e7eb', borderRight: '1px solid #e5e7eb', padding: '0 24px' }}>
                  <p style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 4px' }}>MOQ</p>
                  <p style={{ fontSize: '22px', fontWeight: 'bold', color: '#111827', margin: 0 }}>{printProduct.moq > 0 ? printProduct.moq.toLocaleString() : '-'}</p>
                  <p style={{ fontSize: '10px', color: '#9ca3af', marginTop: '2px' }}>{printProduct.unit}{printProduct.moq !== 1 ? 's' : ''}</p>
                </div>
                <div style={{ borderRight: '1px solid #e5e7eb', paddingRight: '24px' }}>
                  <p style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 4px' }}>No. of CTN</p>
                  <p style={{ fontSize: '22px', fontWeight: 'bold', color: '#111827', margin: 0 }}>{printProduct.number_of_ctns > 0 ? printProduct.number_of_ctns.toLocaleString() : '-'}</p>
                  <p style={{ fontSize: '10px', color: '#9ca3af', marginTop: '2px' }}>cartons</p>
                </div>
                <div>
                  <p style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 4px' }}>Quantity</p>
                  <p style={{ fontSize: '22px', fontWeight: 'bold', color: '#111827', margin: 0 }}>{printProduct.quantity > 0 ? printProduct.quantity.toLocaleString() : '-'}</p>
                  <p style={{ fontSize: '10px', color: '#9ca3af', marginTop: '2px' }}>{printProduct.unit}{printProduct.quantity !== 1 ? 's' : ''}</p>
                </div>
              </div>
              {printProduct.unit_price > 0 && printProduct.quantity > 0 && (
                <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '16px', paddingTop: '12px', textAlign: 'center' }}>
                  <p style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 4px' }}>Total Value</p>
                  <p style={{ fontSize: '20px', fontWeight: 'bold', color: '#0f766e', margin: 0 }}>
                    {printProduct.currency} {(printProduct.unit_price * printProduct.quantity).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              )}
            </div>

            {/* Supplier & Contact */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '10px', fontWeight: 'bold', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid #e5e7eb', paddingBottom: '4px', marginBottom: '8px' }}>
                Supplier & Contact
              </h3>
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <tbody>
                  <DetailRow label="Supplier" value={printProduct.supplier_name || '-'} />
                  <DetailRow label="Contact Person" value={printProduct.contact_person || '-'} />
                  <DetailRow label="Phone / WhatsApp" value={printProduct.contact_phone || '-'} />
                  <DetailRow label="WeChat" value={printProduct.contact_wechat || '-'} />
                </tbody>
              </table>
            </div>

            {/* Shipping */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '10px', fontWeight: 'bold', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid #e5e7eb', paddingBottom: '4px', marginBottom: '8px' }}>
                Shipping & Dimensions
              </h3>
              <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                <tbody>
                  <DetailRow label="Weight per Unit" value={printProduct.weight_kg > 0 ? `${printProduct.weight_kg} KG` : '-'} />
                  <DetailRow label="Dimensions (L x W x H)" value={formatDimensions(printProduct)} />
                  <DetailRow label="1 CTN Volume (CBM)" value={printProduct.cbm_per_unit > 0 ? printProduct.cbm_per_unit.toFixed(4) : '-'} />
                  <DetailRow label="Total Weight" value={printProduct.total_weight_kg > 0 ? `${printProduct.total_weight_kg.toFixed(1)} KG` : '-'} bold />
                  <DetailRow label="Total CBM" value={printProduct.total_cbm > 0 ? printProduct.total_cbm.toFixed(4) : '-'} bold />
                </tbody>
              </table>
            </div>

            {/* Notes */}
            {printProduct.notes && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: '10px', fontWeight: 'bold', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid #e5e7eb', paddingBottom: '4px', marginBottom: '8px' }}>
                  Notes
                </h3>
                <p style={{ fontSize: '13px', color: '#374151', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '12px', lineHeight: '1.5', margin: 0 }}>
                  {printProduct.notes}
                </p>
              </div>
            )}

            {/* Footer */}
            <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '12px', marginTop: '24px', display: 'flex', justifyContent: 'space-between' }}>
              <p style={{ fontSize: '9px', color: '#9ca3af', margin: 0 }}>Product Reference Card</p>
              <p style={{ fontSize: '9px', color: '#9ca3af', margin: 0 }}>Generated {dateStr}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <tr>
      <td style={{ padding: '6px 8px', color: '#6b7280', fontSize: '12px', width: '45%', borderBottom: '1px solid #f3f4f6' }}>{label}</td>
      <td style={{ padding: '6px 8px', color: bold ? '#0f766e' : '#111827', fontWeight: bold ? 700 : 600, fontSize: '13px', borderBottom: '1px solid #f3f4f6' }}>{value}</td>
    </tr>
  );
}
