import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Phone, Mail, Building2, Star, Calendar, Trash2, Edit, BookOpen, LayoutGrid } from 'lucide-react';

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

interface CustomerListProps {
  onEdit: (customer: Customer) => void;
  onScheduleCall: (customerId: string, customerName: string) => void;
  refreshTrigger?: number;
}

export default function CustomerList({ onEdit, onScheduleCall, refreshTrigger }: CustomerListProps) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'phonebook'>('grid');

  useEffect(() => {
    loadCustomers();
  }, [refreshTrigger]);

  async function loadCustomers() {
    setLoading(true);
    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Error loading customers:', error);
    } else {
      setCustomers(data || []);
    }
    setLoading(false);
  }

  async function deleteCustomer(id: string) {
    if (!confirm('Are you sure you want to delete this customer? This will also delete all associated calls and interactions.')) {
      return;
    }

    const { error } = await supabase.from('customers').delete().eq('id', id);

    if (error) {
      alert('Error deleting customer: ' + error.message);
    } else {
      loadCustomers();
    }
  }

  function formatDate(dateString: string | null) {
    if (!dateString) return 'Not set';
    const parts = dateString.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${day}/${month}/${year}`;
    }
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB');
  }

  function isCallDue(nextContactDate: string | null) {
    if (!nextContactDate) return false;
    return new Date(nextContactDate) <= new Date();
  }

  const filteredCustomers = customers.filter(
    (customer) =>
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.company?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.phone?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <input
          type="text"
          placeholder="Search by name, company, email, or phone..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <div className="flex items-center bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`flex items-center space-x-2 px-3 py-2 rounded-md transition-colors ${
              viewMode === 'grid'
                ? 'bg-white text-teal-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="text-sm font-medium">Grid</span>
          </button>
          <button
            onClick={() => setViewMode('phonebook')}
            className={`flex items-center space-x-2 px-3 py-2 rounded-md transition-colors ${
              viewMode === 'phonebook'
                ? 'bg-white text-teal-700 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span className="text-sm font-medium">Phone Book</span>
          </button>
        </div>
      </div>

      {filteredCustomers.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No customers found
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredCustomers.map((customer) => (
            <div
              key={customer.id}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">{customer.name}</h3>
                  {customer.position && customer.company && (
                    <p className="text-sm text-gray-600 mt-1">
                      {customer.position} at {customer.company}
                    </p>
                  )}
                </div>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => onEdit(customer)}
                    className="p-2 text-gray-500 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteCustomer(customer.id)}
                    className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {customer.email && (
                  <div className="flex items-center text-sm text-gray-600">
                    <Mail className="w-4 h-4 mr-2 text-gray-400" />
                    <a href={`mailto:${customer.email}`} className="hover:text-teal-700">
                      {customer.email}
                    </a>
                  </div>
                )}
                {customer.phone && (
                  <div className="flex items-center text-sm text-gray-600">
                    <Phone className="w-4 h-4 mr-2 text-gray-400" />
                    <a href={`tel:${customer.phone}`} className="hover:text-teal-700">
                      {customer.phone}
                    </a>
                  </div>
                )}
                {customer.company && (
                  <div className="flex items-center text-sm text-gray-600">
                    <Building2 className="w-4 h-4 mr-2 text-gray-400" />
                    {customer.company}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                <div className="flex items-center space-x-4">
                  <div className="flex items-center text-sm">
                    <Star className="w-4 h-4 mr-1 text-yellow-500 fill-yellow-500" />
                    <span className="font-medium">{customer.relationship_score}/10</span>
                  </div>
                  {customer.next_contact_date && (
                    <div className="flex items-center text-sm">
                      <Calendar className={`w-4 h-4 mr-1 ${isCallDue(customer.next_contact_date) ? 'text-red-500' : 'text-gray-400'}`} />
                      <span className={isCallDue(customer.next_contact_date) ? 'text-red-600 font-medium' : 'text-gray-600'}>
                        {formatDate(customer.next_contact_date)}
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onScheduleCall(customer.id, customer.name)}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
                >
                  Schedule Call
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="bg-gradient-to-r from-teal-500 to-cyan-600 px-6 py-4 rounded-t-lg">
            <h2 className="text-xl font-bold text-white flex items-center">
              <BookOpen className="w-6 h-6 mr-2" />
              Phone Book Directory
            </h2>
            <p className="text-sm text-teal-50 mt-1">{filteredCustomers.length} contacts</p>
          </div>
          <div className="divide-y divide-gray-200">
            {filteredCustomers.map((customer) => (
              <div
                key={customer.id}
                className="px-6 py-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-teal-500 to-cyan-600 rounded-full flex items-center justify-center">
                        <span className="text-white font-bold text-lg">
                          {customer.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold text-gray-900 truncate">
                          {customer.name}
                        </h3>
                        {customer.company && (
                          <p className="text-sm text-gray-600 flex items-center">
                            <Building2 className="w-3 h-3 mr-1" />
                            {customer.company}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4 ml-4">
                    <div className="text-right">
                      {customer.phone ? (
                        <a
                          href={`tel:${customer.phone}`}
                          className="flex items-center space-x-2 text-teal-600 hover:text-teal-700 font-semibold"
                        >
                          <Phone className="w-5 h-5" />
                          <span className="text-lg">{customer.phone}</span>
                        </a>
                      ) : (
                        <span className="text-gray-400 text-sm">No phone</span>
                      )}
                      {customer.email && (
                        <a
                          href={`mailto:${customer.email}`}
                          className="flex items-center space-x-1 text-sm text-gray-600 hover:text-teal-700 mt-1"
                        >
                          <Mail className="w-4 h-4" />
                          <span>{customer.email}</span>
                        </a>
                      )}
                    </div>
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => onScheduleCall(customer.id, customer.name)}
                        className="p-2 text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
                        title="Schedule Call"
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onEdit(customer)}
                        className="p-2 text-gray-500 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
                        title="Edit"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteCustomer(customer.id)}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
