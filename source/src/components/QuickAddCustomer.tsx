import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { X, UserPlus } from 'lucide-react';

interface QuickAddCustomerProps {
  onClose: () => void;
  onSave: () => void;
}

export default function QuickAddCustomer({ onClose, onSave }: QuickAddCustomerProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim()) {
      alert('Please enter a customer name');
      return;
    }

    setSaving(true);

    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    const formatDateForDB = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const customerData = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: null,
      company: null,
      position: null,
      notes: 'Quick add - Build customer relationship through weekly calls',
      last_contact_date: formatDateForDB(now),
      next_contact_date: formatDateForDB(nextWeek),
      relationship_score: 5,
      security_provided: false,
    };

    const { data: newCustomer, error: customerError } = await supabase
      .from('customers')
      .insert([customerData])
      .select('id')
      .single();

    if (customerError) {
      alert('Error adding customer: ' + customerError.message);
      setSaving(false);
      return;
    }

    const callData = {
      customer_id: newCustomer.id,
      scheduled_date: nextWeek.toISOString(),
      status: 'scheduled',
      notes: 'First weekly call to build relationship',
      outcome: null,
      follow_up_required: false,
      follow_up_date: null,
      duration_minutes: 0,
      completed_date: null,
    };

    const { error: callError } = await supabase
      .from('calls')
      .insert([callData]);

    setSaving(false);

    if (callError) {
      console.error('Error scheduling call:', callError);
    }

    onSave();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-teal-500 to-cyan-600">
          <div className="flex items-center space-x-2">
            <div className="bg-white/20 rounded-lg p-2">
              <UserPlus className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-white">Quick Add Customer</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
            <p className="text-sm text-teal-900 font-medium">Weekly Call Schedule</p>
            <p className="text-xs text-teal-700 mt-1">
              A weekly call will be automatically scheduled to help you build a strong relationship with this customer.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Customer Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter customer name"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-lg"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Enter phone number"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent text-lg"
            />
          </div>

          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="flex items-center text-sm text-gray-700">
              <span className="font-medium mr-2">📅 First Call:</span>
              <span>{new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-GB')}</span>
            </div>
            <div className="flex items-center text-sm text-gray-700">
              <span className="font-medium mr-2">🔄 Frequency:</span>
              <span>Weekly</span>
            </div>
            <div className="flex items-center text-sm text-gray-700">
              <span className="font-medium mr-2">🎯 Goal:</span>
              <span>Build strong customer relationship</span>
            </div>
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
              className="px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-teal-500 to-cyan-600 rounded-lg hover:from-teal-600 hover:to-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
            >
              {saving ? 'Adding...' : 'Add & Schedule Call'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
