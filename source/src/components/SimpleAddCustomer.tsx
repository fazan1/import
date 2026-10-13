import { useState } from 'react';
import { X, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface SimpleAddCustomerProps {
  onClose: () => void;
  onSave: () => void;
}

export default function SimpleAddCustomer({ onClose, onSave }: SimpleAddCustomerProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!name.trim() || !phone.trim()) {
      alert('Please enter both name and phone number');
      return;
    }

    setSaving(true);

    try {
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      nextWeek.setHours(10, 0, 0, 0);

      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .insert({
          name: name.trim(),
          phone: phone.trim(),
          relationship_score: 5,
          notes: '',
          next_contact_date: nextWeek.toISOString().split('T')[0],
        })
        .select()
        .single();

      if (customerError) throw customerError;

      const { error: callError } = await supabase
        .from('calls')
        .insert({
          customer_id: customer.id,
          scheduled_date: nextWeek.toISOString(),
          status: 'scheduled',
          notes: 'Initial weekly call',
          follow_up_required: false,
        });

      if (callError) throw callError;

      onSave();
    } catch (error: any) {
      alert('Error adding customer: ' + error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-teal-500 to-cyan-600">
          <div className="flex items-center space-x-3">
            <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2">
              <UserPlus className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-xl font-bold text-white">Add New Customer</h2>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Customer Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              placeholder="Enter customer name"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Phone Number *
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              placeholder="Enter phone number"
              required
            />
          </div>

          <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
            <p className="text-sm text-teal-800">
              <strong>Note:</strong> A weekly call will be automatically scheduled for next week (7 days from now) at 10:00 AM.
            </p>
          </div>

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 text-sm font-semibold text-gray-700 bg-white border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-teal-500 to-cyan-600 rounded-lg hover:from-teal-600 hover:to-cyan-700 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Adding...' : 'Add Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
