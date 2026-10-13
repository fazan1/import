import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X } from 'lucide-react';

interface CallFormProps {
  customerId: string | null;
  customerName: string;
  call: any | null;
  onClose: () => void;
  onSave: () => void;
}

export default function CallForm({ customerId, customerName, call, onClose, onSave }: CallFormProps) {
  const [formData, setFormData] = useState({
    scheduled_date: '',
    duration_minutes: 0,
    outcome: '' as 'positive' | 'neutral' | 'negative' | 'no_answer' | '',
    notes: '',
    follow_up_required: false,
    follow_up_date: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (call) {
      setFormData({
        scheduled_date: call.scheduled_date
          ? new Date(call.scheduled_date).toISOString().slice(0, 16)
          : '',
        duration_minutes: call.duration_minutes || 0,
        outcome: call.outcome || '',
        notes: call.notes || '',
        follow_up_required: call.follow_up_required || false,
        follow_up_date: call.follow_up_date
          ? new Date(call.follow_up_date).toISOString().slice(0, 16)
          : '',
      });
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      setFormData({
        scheduled_date: tomorrow.toISOString().slice(0, 16),
        duration_minutes: 0,
        outcome: '',
        notes: '',
        follow_up_required: false,
        follow_up_date: '',
      });
    }
  }, [call]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const data: any = {
      customer_id: customerId,
      scheduled_date: formData.scheduled_date,
      notes: formData.notes || '',
      follow_up_required: formData.follow_up_required,
      follow_up_date: formData.follow_up_date || null,
    };

    if (call) {
      data.status = 'completed';
      data.completed_date = new Date().toISOString();
      data.duration_minutes = formData.duration_minutes;
      data.outcome = formData.outcome || null;

      const { error: callError } = await supabase.from('calls').update(data).eq('id', call.id);

      const today = new Date();
      const daysToAdd = Math.random() < 0.5 ? 8 : 10;
      const nextContactDate = new Date(today);
      nextContactDate.setDate(today.getDate() + daysToAdd);

      const { error: customerError } = await supabase
        .from('customers')
        .update({
          last_contact_date: today.toISOString(),
          next_contact_date: formData.follow_up_required
            ? formData.follow_up_date
            : nextContactDate.toISOString(),
        })
        .eq('id', call.customer_id);

      if (callError || customerError) {
        alert('Error updating call: ' + (callError?.message || customerError?.message));
        setSaving(false);
        return;
      }
    } else {
      data.status = 'scheduled';

      const { error: callError } = await supabase.from('calls').insert([data]);

      const { error: customerError } = await supabase
        .from('customers')
        .update({
          next_contact_date: formData.scheduled_date,
        })
        .eq('id', customerId);

      if (callError || customerError) {
        alert('Error scheduling call: ' + (callError?.message || customerError?.message));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onSave();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {call ? `Complete Call with ${customerName}` : `Schedule Call with ${customerName}`}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {!call && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Scheduled Date & Time <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                required
                value={formData.scheduled_date}
                onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}

          {call && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Call Duration (minutes)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.duration_minutes}
                  onChange={(e) =>
                    setFormData({ ...formData, duration_minutes: parseInt(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Call Outcome
                </label>
                <select
                  value={formData.outcome}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      outcome: e.target.value as 'positive' | 'neutral' | 'negative' | 'no_answer' | '',
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select outcome...</option>
                  <option value="positive">Positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="negative">Negative</option>
                  <option value="no_answer">No Answer</option>
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Call notes, discussion points, action items..."
            />
          </div>

          {call && (
            <div className="bg-teal-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start space-x-2">
                <div className="flex-shrink-0 mt-0.5">
                  <svg className="w-5 h-5 text-teal-700" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-teal-800 font-medium">Auto-Schedule Next Contact</p>
                  <p className="text-sm text-teal-700 mt-1">
                    Next contact will automatically be scheduled for 8-10 days from today unless you set a custom follow-up date below.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="follow_up_required"
              checked={formData.follow_up_required}
              onChange={(e) =>
                setFormData({ ...formData, follow_up_required: e.target.checked })
              }
              className="w-4 h-4 text-teal-700 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <label htmlFor="follow_up_required" className="text-sm font-medium text-gray-700">
              Set custom follow-up date (optional)
            </label>
          </div>

          {formData.follow_up_required && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Custom Follow-up Date & Time
              </label>
              <input
                type="datetime-local"
                value={formData.follow_up_date}
                onChange={(e) => setFormData({ ...formData, follow_up_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">
                This will override the automatic 8-10 day scheduling
              </p>
            </div>
          )}

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
              {saving ? 'Saving...' : call ? 'Complete Call' : 'Schedule Call'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
