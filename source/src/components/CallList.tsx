import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Phone, CheckCircle, XCircle, Clock, Calendar, Wand2 } from 'lucide-react';

interface Call {
  id: string;
  customer_id: string;
  scheduled_date: string;
  completed_date: string | null;
  duration_minutes: number;
  status: 'scheduled' | 'completed' | 'missed' | 'cancelled';
  outcome: 'positive' | 'neutral' | 'negative' | 'no_answer' | null;
  notes: string;
  follow_up_required: boolean;
  follow_up_date: string | null;
  customer_name: string;
  customer_phone: string | null;
}

interface CallListProps {
  refreshTrigger?: number;
  onCompleteCall: (call: Call) => void;
}

export default function CallList({ refreshTrigger, onCompleteCall }: CallListProps) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'scheduled' | 'completed'>('all');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadCalls();
  }, [refreshTrigger, filter]);

  async function loadCalls() {
    setLoading(true);

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayDateStr = `${year}-${month}-${day}`;

    const { data: allCalls, error: callsError } = await supabase
      .from('calls')
      .select(`
        *,
        customers (
          name,
          phone
        )
      `)
      .order('scheduled_date', { ascending: true });

    if (callsError) {
      console.error('Error loading calls:', callsError);
      setLoading(false);
      return;
    }

    let filteredCalls = allCalls?.filter(call => {
      const callDate = new Date(call.scheduled_date);
      const callDateStr = `${callDate.getFullYear()}-${String(callDate.getMonth() + 1).padStart(2, '0')}-${String(callDate.getDate()).padStart(2, '0')}`;
      return callDateStr === todayDateStr;
    }) || [];

    if (filter !== 'all') {
      filteredCalls = filteredCalls.filter(call => call.status === filter);
    }

    const data = filteredCalls;
    const error = null;

    if (error) {
      console.error('Error loading calls:', error);
    } else {
      const mappedCalls = data?.map((call: any) => ({
        ...call,
        customer_name: call.customers?.name || 'Unknown',
        customer_phone: call.customers?.phone || null,
      })) || [];

      mappedCalls.sort((a, b) => {
        if (a.status === 'scheduled' && b.status !== 'scheduled') return -1;
        if (a.status !== 'scheduled' && b.status === 'scheduled') return 1;

        const aTime = new Date(a.scheduled_date).getTime();
        const bTime = new Date(b.scheduled_date).getTime();
        const now = Date.now();

        const aDiff = Math.abs(aTime - now);
        const bDiff = Math.abs(bTime - now);

        return aDiff - bDiff;
      });

      setCalls(mappedCalls);
    }
    setLoading(false);
  }

  async function updateCallStatus(callId: string, status: 'completed' | 'missed' | 'cancelled') {
    const updates: any = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'completed') {
      updates.completed_date = new Date().toISOString();
    }

    const { error } = await supabase.from('calls').update(updates).eq('id', callId);

    if (error) {
      alert('Error updating call: ' + error.message);
    } else {
      loadCalls();
    }
  }

  function formatDateTime(dateString: string) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'scheduled':
        return 'bg-teal-100 text-teal-800';
      case 'missed':
        return 'bg-red-100 text-red-800';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  function getOutcomeIcon(outcome: string | null) {
    switch (outcome) {
      case 'positive':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'negative':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'neutral':
        return <Clock className="w-4 h-4 text-yellow-600" />;
      default:
        return null;
    }
  }

  function getCallTimingStatus(scheduledDate: string, status: string) {
    if (status !== 'scheduled') return null;

    const now = new Date();
    const scheduled = new Date(scheduledDate);
    const diffMs = scheduled.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffMs < 0) {
      return { label: 'OVERDUE', color: 'bg-red-600 text-white', urgent: true };
    } else if (diffHours < 2) {
      return { label: 'CALL NOW', color: 'bg-orange-600 text-white animate-pulse', urgent: true };
    } else if (diffHours < 24) {
      return { label: 'TODAY', color: 'bg-yellow-600 text-white', urgent: false };
    } else if (diffDays < 7) {
      return { label: 'THIS WEEK', color: 'bg-teal-600 text-white', urgent: false };
    }
    return { label: 'UPCOMING', color: 'bg-gray-600 text-white', urgent: false };
  }

  async function autoGenerateCalls() {
    setGenerating(true);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const eightDaysFromNow = new Date();
      eightDaysFromNow.setDate(eightDaysFromNow.getDate() + 8);
      eightDaysFromNow.setHours(23, 59, 59, 999);

      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('id, name, next_contact_date')
        .lte('next_contact_date', eightDaysFromNow.toISOString())
        .not('next_contact_date', 'is', null);

      if (customersError) {
        alert('Error fetching customers: ' + customersError.message);
        return;
      }

      if (!customers || customers.length === 0) {
        alert('No customers need to be called in the next 8 days');
        setGenerating(false);
        return;
      }

      const { data: existingCalls, error: callsError } = await supabase
        .from('calls')
        .select('customer_id')
        .eq('status', 'scheduled');

      if (callsError) {
        alert('Error checking existing calls: ' + callsError.message);
        return;
      }

      const existingCustomerIds = new Set(existingCalls?.map((c) => c.customer_id) || []);

      const customersToCall = customers.filter(
        (customer) => !existingCustomerIds.has(customer.id)
      );

      if (customersToCall.length === 0) {
        alert('All customers already have scheduled calls');
        setGenerating(false);
        return;
      }

      const newCalls = customersToCall.map((customer) => ({
        customer_id: customer.id,
        scheduled_date: customer.next_contact_date,
        status: 'scheduled',
        notes: 'Auto-generated call',
        follow_up_required: false,
        duration_minutes: 0,
      }));

      const { error: insertError } = await supabase.from('calls').insert(newCalls);

      if (insertError) {
        alert('Error creating calls: ' + insertError.message);
      } else {
        alert(`Successfully created ${newCalls.length} new call(s) for the next 8 days`);
        loadCalls();
      }
    } catch (error) {
      console.error('Error auto-generating calls:', error);
      alert('Error auto-generating calls');
    } finally {
      setGenerating(false);
    }
  }

  async function scheduleAllCustomersRandomly() {
    setGenerating(true);
    try {
      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('id, name');

      if (customersError) {
        alert('Error fetching customers: ' + customersError.message);
        return;
      }

      if (!customers || customers.length === 0) {
        alert('No customers found');
        setGenerating(false);
        return;
      }

      const dateOptions = [0, 8, 10];

      const updates = [];
      const newCalls = [];

      for (const customer of customers) {
        const randomDays = dateOptions[Math.floor(Math.random() * dateOptions.length)];
        const scheduledDate = new Date();
        scheduledDate.setDate(scheduledDate.getDate() + randomDays);
        scheduledDate.setHours(10, 0, 0, 0);

        updates.push({
          id: customer.id,
          next_contact_date: scheduledDate.toISOString().split('T')[0],
        });

        newCalls.push({
          customer_id: customer.id,
          scheduled_date: scheduledDate.toISOString(),
          status: 'scheduled',
          notes: randomDays === 0 ? 'Call today!' : `Call in ${randomDays} days`,
          follow_up_required: false,
          duration_minutes: 0,
        });
      }

      await supabase
        .from('calls')
        .delete()
        .eq('status', 'scheduled');

      for (const update of updates) {
        await supabase
          .from('customers')
          .update({ next_contact_date: update.next_contact_date })
          .eq('id', update.id);
      }

      const { error: insertError } = await supabase.from('calls').insert(newCalls);

      if (insertError) {
        alert('Error creating calls: ' + insertError.message);
      } else {
        const todayCalls = newCalls.filter(c => {
          const date = new Date(c.scheduled_date);
          const today = new Date();
          return date.toDateString() === today.toDateString();
        }).length;

        alert(`Successfully scheduled ${customers.length} customers!\n${todayCalls} for today\n${newCalls.length - todayCalls} for future dates`);
        loadCalls();
      }
    } catch (error) {
      console.error('Error scheduling customers:', error);
      alert('Error scheduling customers');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              filter === 'all'
                ? 'bg-teal-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            All Calls
          </button>
          <button
            onClick={() => setFilter('scheduled')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              filter === 'scheduled'
                ? 'bg-teal-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            Scheduled
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              filter === 'completed'
                ? 'bg-teal-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            Completed
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={scheduleAllCustomersRandomly}
            disabled={generating}
            className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white rounded-lg transition-all font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <Calendar className="w-4 h-4" />
            )}
            <span>{generating ? 'Scheduling...' : 'Schedule All (Random)'}</span>
          </button>

          <button
            onClick={autoGenerateCalls}
            disabled={generating}
            className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-teal-600 hover:from-blue-700 hover:to-teal-700 text-white rounded-lg transition-all font-medium shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <Wand2 className="w-4 h-4" />
            )}
            <span>{generating ? 'Generating...' : 'Auto-Generate Calls'}</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 divide-y divide-gray-200">
        {calls.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">No calls found</div>
        ) : (
          calls.map((call) => {
            const timingStatus = getCallTimingStatus(call.scheduled_date, call.status);
            return (
            <div key={call.id} className={`p-6 hover:bg-gray-50 transition-colors ${timingStatus?.urgent ? 'border-l-4 border-red-500' : ''}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2 flex-wrap">
                    <h3 className="text-lg font-semibold text-gray-900">{call.customer_name}</h3>
                    {timingStatus && (
                      <span className={`px-3 py-1 text-xs font-bold rounded-md ${timingStatus.color}`}>
                        {timingStatus.label}
                      </span>
                    )}
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(call.status)}`}>
                      {call.status}
                    </span>
                    {call.outcome && (
                      <div className="flex items-center space-x-1">
                        {getOutcomeIcon(call.outcome)}
                        <span className="text-sm text-gray-600 capitalize">{call.outcome}</span>
                      </div>
                    )}
                  </div>

                  {call.customer_phone && (
                    <div className="flex items-center text-sm text-gray-600 mb-2">
                      <Phone className="w-4 h-4 mr-2" />
                      {call.customer_phone}
                    </div>
                  )}

                  <div className="flex items-center text-sm text-gray-600 mb-2">
                    <Calendar className="w-4 h-4 mr-2" />
                    Scheduled: {formatDateTime(call.scheduled_date)}
                  </div>

                  {call.completed_date && (
                    <div className="flex items-center text-sm text-gray-600 mb-2">
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Completed: {formatDateTime(call.completed_date)}
                      {call.duration_minutes > 0 && (
                        <span className="ml-2">({call.duration_minutes} min)</span>
                      )}
                    </div>
                  )}

                  {call.notes && (
                    <p className="text-sm text-gray-600 mt-2 bg-gray-50 p-3 rounded-lg">{call.notes}</p>
                  )}

                  {call.follow_up_required && call.follow_up_date && (
                    <div className="mt-2 flex items-center text-sm text-orange-600">
                      <Clock className="w-4 h-4 mr-2" />
                      Follow-up required: {formatDateTime(call.follow_up_date)}
                    </div>
                  )}
                </div>

                {call.status === 'scheduled' && (
                  <div className="flex flex-col space-y-2 ml-4">
                    <button
                      onClick={() => onCompleteCall(call)}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
                    >
                      Complete
                    </button>
                    <button
                      onClick={() => updateCallStatus(call.id, 'missed')}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                    >
                      Missed
                    </button>
                    <button
                      onClick={() => updateCallStatus(call.id, 'cancelled')}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
            );
          })
        )}
      </div>
    </div>
  );
}
