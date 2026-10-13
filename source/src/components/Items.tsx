import { useState, useEffect } from 'react';
import { Package, Plus, Search, Pencil as Edit2, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { moveToRecycleBin } from '../lib/recycleBin';

interface Item {
  id: string;
  item_name: string;
  sku: string | null;
  unit: string;
  purchase_price: number;
  sales_price: number;
  is_active: boolean;
  created_at: string;
}

const UNITS = ['Piece', 'kg', 'Meter', 'Liter', 'Box', 'Set', 'Roll', 'Pack'];

export default function Items() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    item_name: '',
    sku: '',
    unit: 'Piece',
    purchase_price: '',
    sales_price: ''
  });

  useEffect(() => {
    loadItems();
  }, []);

  async function loadItems() {
    setLoading(true);
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('item_name')
      .throwOnError();

    if (error) {
      console.error('Load error:', error);
    } else if (data) {
      setItems(data);
    }
    setLoading(false);
  }

  function openForm(item?: Item) {
    if (item) {
      setEditingItem(item);
      setFormData({
        item_name: item.item_name,
        sku: item.sku || '',
        unit: item.unit,
        purchase_price: String(item.purchase_price || 0),
        sales_price: String(item.sales_price || 0)
      });
    } else {
      setEditingItem(null);
      setFormData({
        item_name: '',
        sku: '',
        unit: 'Piece',
        purchase_price: '',
        sales_price: ''
      });
    }
    setShowForm(true);
  }

  async function saveItem() {
    if (!formData.item_name.trim()) return;
    setSaving(true);

    const payload = {
      item_name: formData.item_name.trim(),
      sku: formData.sku.trim() || null,
      unit: formData.unit,
      purchase_price: parseFloat(formData.purchase_price) || 0,
      purchase_currency: 'CNY',
      sales_price: parseFloat(formData.sales_price) || 0,
      sales_currency: 'LKR',
      updated_at: new Date().toISOString()
    };

    let result;
    if (editingItem) {
      result = await supabase
        .from('items')
        .update(payload)
        .eq('id', editingItem.id)
        .select();
    } else {
      result = await supabase
        .from('items')
        .insert(payload)
        .select();
    }

    if (result.error) {
      console.error('Save error:', result.error);
      alert('Failed to save item: ' + result.error.message);
      setSaving(false);
      return;
    }

    console.log('Save successful:', result.data);
    setShowForm(false);
    setEditingItem(null);
    setItems([]);
    await loadItems();
    setSaving(false);
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this item? It will be moved to the Recycle Bin.')) return;

    const itemToDelete = items.find(i => i.id === id);
    if (!itemToDelete) return;

    const result = await moveToRecycleBin({
      source_table: 'items',
      source_id: id,
      record_data: itemToDelete,
      display_name: `Item: ${itemToDelete.item_name}`,
      portal: 'cn',
    });

    if (!result.success) {
      alert('Failed to move to recycle bin: ' + result.error);
      return;
    }

    await supabase.from('items').delete().eq('id', id);
    loadItems();
  }

  const filteredItems = items.filter(item =>
    item.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.sku?.toLowerCase() || '').includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Items</h1>
          <p className="text-gray-500 mt-1">Manage your products and pricing</p>
        </div>
        <button
          onClick={() => openForm()}
          className="flex items-center px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add Item
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search items by name or SKU..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">Loading items...</div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No items found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-center space-x-4 flex-1">
                  <div className="p-2 bg-teal-50 rounded-lg">
                    <Package className="w-5 h-5 text-teal-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <p className="font-medium text-gray-900">{item.item_name}</p>
                      {item.sku && (
                        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                          {item.sku}
                        </span>
                      )}
                      <span className="px-2 py-0.5 text-xs bg-teal-100 text-teal-700 rounded">
                        {item.unit}
                      </span>
                    </div>
                    <div className="flex items-center space-x-4 mt-1 text-sm text-gray-500">
                      <span>Buy: CNY {item.purchase_price.toFixed(2)}</span>
                      <span>Sell: LKR {item.sales_price.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => openForm(item)}
                    className="p-2 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteItem(item.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingItem ? 'Edit Item' : 'Add New Item'}
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Item Name *</label>
                <input
                  type="text"
                  value={formData.item_name}
                  onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  placeholder="Enter item name"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                  <input
                    type="text"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    placeholder="SKU-001"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                  <select
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                  >
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Price (CNY)</label>
                  <input
                    type="number"
                    value={formData.purchase_price}
                    onChange={(e) => setFormData({ ...formData, purchase_price: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    placeholder="0.00"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sales Price (LKR)</label>
                  <input
                    type="number"
                    value={formData.sales_price}
                    onChange={(e) => setFormData({ ...formData, sales_price: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    placeholder="0.00"
                    step="0.01"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 p-4 border-t border-gray-200">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveItem}
                disabled={saving || !formData.item_name.trim()}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving...' : editingItem ? 'Update Item' : 'Add Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
