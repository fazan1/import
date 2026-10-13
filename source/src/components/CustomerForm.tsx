import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X } from 'lucide-react';

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  position: string | null;
  notes: string;
  last_contact_date: string | null;
  next_contact_date: string | null;
  relationship_score: number;
  tags: string[];
  security_provided: boolean;
}

interface CustomerFormProps {
  customer: Customer | null;
  onClose: () => void;
  onSave: () => void;
}

export default function CustomerForm({ customer, onClose, onSave }: CustomerFormProps) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    company: '',
    position: '',
    notes: '',
    last_contact_date: '',
    next_contact_date: '',
    relationship_score: 5,
    security_provided: false,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (customer) {
      setFormData({
        name: customer.name,
        email: customer.email || '',
        phone: customer.phone || '',
        company: customer.company || '',
        position: customer.position || '',
        notes: customer.notes || '',
        last_contact_date: customer.last_contact_date
          ? new Date(customer.last_contact_date).toISOString().slice(0, 16)
          : '',
        next_contact_date: customer.next_contact_date
          ? new Date(customer.next_contact_date).toISOString().slice(0, 16)
          : '',
        relationship_score: customer.relationship_score,
        security_provided: customer.security_provided || false,
      });
    }
  }, [customer]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const data = {
      name: formData.name,
      email: formData.email || null,
      phone: formData.phone || null,
      company: formData.company || null,
      position: formData.position || null,
      notes: formData.notes || '',
      last_contact_date: formData.last_contact_date || null,
      next_contact_date: formData.next_contact_date || null,
      relationship_score: formData.relationship_score,
      security_provided: formData.security_provided,
    };

    let error;
    if (customer) {
      const result = await supabase.from('customers').update(data).eq('id', customer.id);
      error = result.error;
    } else {
      const result = await supabase.from('customers').insert([data]);
      error = result.error;
    }

    setSaving(false);

    if (error) {
      alert('Error saving customer: ' + error.message);
    } else {
      onSave();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {customer ? 'Edit Customer' : 'Add New Customer'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
              <input
                type="text"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
              <input
                type="text"
                value={formData.position}
                onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Relationship Score (1-10)
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={formData.relationship_score}
                onChange={(e) =>
                  setFormData({ ...formData, relationship_score: parseInt(e.target.value) })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Security Provided
              </label>
              <div className="flex items-center h-10">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.security_provided}
                    onChange={(e) =>
                      setFormData({ ...formData, security_provided: e.target.checked })
                    }
                    className="w-5 h-5 text-teal-700 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-600">
                    Customer has provided collateral/security
                  </span>
                </label>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Increases credit score and credit limit
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Last Contact Date
              </label>
              <input
                type="datetime-local"
                value={formData.last_contact_date}
                onChange={(e) => setFormData({ ...formData, last_contact_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Next Contact Date
                <span className="text-xs text-gray-500 ml-2">(Auto-calculated: +8 days)</span>
              </label>
              <input
                type="datetime-local"
                value={formData.next_contact_date}
                onChange={(e) => setFormData({ ...formData, next_contact_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50"
                placeholder="Auto-calculated from last contact"
              />
              <p className="text-xs text-gray-500 mt-1">
                Automatically set to 8 days after last contact date
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Any additional information about this customer..."
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : customer ? 'Update Customer' : 'Add Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
