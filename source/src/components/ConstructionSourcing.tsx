import { useState, useEffect } from 'react';
import { Search, Phone, MapPin, Building2, MessageCircle, Plus, Database, List } from 'lucide-react';
import { supabase } from '../lib/supabase';
import SupplierSync from './SupplierSync';

interface Supplier {
  id: string;
  business_name: string;
  phone_primary: string;
  address: string;
  city: string;
  products_services: string[];
  source: 'rainbowpages' | 'wedabima' | 'manual';
  description: string;
  business_type: string;
}

const cities = [
  'All Cities',
  'Colombo',
  'Gampaha',
  'Kalutara',
  'Kandy',
  'Matale',
  'Nuwara Eliya',
  'Galle',
  'Matara',
  'Hambantota',
  'Jaffna',
  'Kurunegala',
  'Anuradhapura',
];

const categories = [
  'All Categories',
  'Steel & Metal',
  'Cement & Concrete',
  'Timber & Lumber',
  'Hardware & Tools',
  'Paint & Coatings',
  'Plumbing',
  'Electrical',
  'Roofing',
  'Tiles & Flooring',
  'Glass & Glazing',
  'Doors & Windows',
  'Sand & Aggregate',
  'Bricks & Blocks',
];

export default function ConstructionSourcing() {
  const [activeTab, setActiveTab] = useState<'browse' | 'sync'>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('All Cities');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [selectedSource, setSelectedSource] = useState<'all' | 'rainbowpages' | 'wedabima' | 'manual'>('all');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    fetchSuppliers();

    const channel = supabase
      .channel('suppliers_changes')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'construction_suppliers' },
        () => {
          fetchSuppliers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchSuppliers = async () => {
    try {
      const { data, error } = await supabase
        .from('construction_suppliers')
        .select('*')
        .order('business_name');

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      console.log('Fetched suppliers:', data?.length || 0);
      setSuppliers(data || []);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
      alert('Failed to load suppliers. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const filteredSuppliers = suppliers.filter((supplier) => {
    const matchesSearch =
      searchQuery === '' ||
      supplier.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      supplier.products_services.some(p => p.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCity = selectedCity === 'All Cities' || supplier.city === selectedCity;
    const matchesCategory =
      selectedCategory === 'All Categories' ||
      supplier.products_services.some(p => p.toLowerCase().includes(selectedCategory.toLowerCase().split(' & ')[0]));
    const matchesSource = selectedSource === 'all' || supplier.source === selectedSource;

    return matchesSearch && matchesCity && matchesCategory && matchesSource;
  });

  const handleCall = (phone: string) => {
    window.location.href = `tel:${phone}`;
  };

  const handleWhatsApp = (phone: string, name: string) => {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const message = encodeURIComponent(`Hi ${name}, I found your contact through Construction Sourcing. I'd like to inquire about your products/services.`);
    window.open(`https://wa.me/${cleanPhone}?text=${message}`, '_blank');
  };

  const handleAddSupplier = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    const products = formData.get('products')?.toString().split(',').map(p => p.trim()) || [];

    try {
      const { error } = await supabase
        .from('construction_suppliers')
        .insert({
          source: 'manual',
          business_name: formData.get('business_name'),
          normalized_name: formData.get('business_name')?.toString().toLowerCase(),
          phone_primary: formData.get('phone'),
          address: formData.get('address'),
          city: formData.get('city'),
          district: formData.get('city'),
          business_type: formData.get('business_type'),
          products_services: products,
          description: formData.get('description'),
        });

      if (error) throw error;

      setShowAddForm(false);
      e.currentTarget.reset();
    } catch (error) {
      console.error('Error adding supplier:', error);
      alert('Failed to add supplier. Please try again.');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Construction Sourcing</h1>
          <p className="text-sm text-gray-600 mt-1">
            Find construction suppliers from Rainbow Pages and Wedabima
          </p>
        </div>
        {activeTab === 'browse' && (
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center space-x-2 px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span>Add Your Business</span>
          </button>
        )}
      </div>

      <div className="flex space-x-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('browse')}
          className={`flex items-center space-x-2 px-4 py-3 font-medium transition-colors relative ${
            activeTab === 'browse'
              ? 'text-teal-600 border-b-2 border-teal-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <List className="w-5 h-5" />
          <span>Browse Suppliers</span>
        </button>
        <button
          onClick={() => setActiveTab('sync')}
          className={`flex items-center space-x-2 px-4 py-3 font-medium transition-colors relative ${
            activeTab === 'sync'
              ? 'text-teal-600 border-b-2 border-teal-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          <Database className="w-5 h-5" />
          <span>Auto-Sync</span>
        </button>
      </div>

      {activeTab === 'sync' ? (
        <SupplierSync />
      ) : (
        <>
          {showAddForm && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Add Your Business</h2>
          <form onSubmit={handleAddSupplier} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Business Name *
                </label>
                <input
                  type="text"
                  name="business_name"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder="Your Business Name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number *
                </label>
                <input
                  type="tel"
                  name="phone"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder="0712345678"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  City *
                </label>
                <select
                  name="city"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                >
                  {cities.filter(c => c !== 'All Cities').map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Business Type *
                </label>
                <select
                  name="business_type"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                >
                  <option value="Hardware Shop">Hardware Shop</option>
                  <option value="Supplier">Supplier</option>
                  <option value="Manufacturer">Manufacturer</option>
                  <option value="Contractor">Contractor</option>
                  <option value="Rental Service">Rental Service</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Address *
                </label>
                <input
                  type="text"
                  name="address"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder="Street address"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Products/Services * (comma separated)
                </label>
                <input
                  type="text"
                  name="products"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder="Steel, Metal, Hardware"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  name="description"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder="Brief description of your business"
                ></textarea>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
              >
                Add Business
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search suppliers or products..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>
        </div>

        <select
          value={selectedCity}
          onChange={(e) => setSelectedCity(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        >
          {cities.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
        >
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center space-x-4">
        <span className="text-sm font-medium text-gray-700">Source:</span>
        <div className="flex space-x-2">
          <button
            onClick={() => setSelectedSource('all')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedSource === 'all'
                ? 'bg-teal-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All Sources
          </button>
          <button
            onClick={() => setSelectedSource('rainbowpages')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedSource === 'rainbowpages'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Rainbow Pages
          </button>
          <button
            onClick={() => setSelectedSource('wedabima')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedSource === 'wedabima'
                ? 'bg-teal-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Wedabima
          </button>
          <button
            onClick={() => setSelectedSource('manual')}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedSource === 'manual'
                ? 'bg-green-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            User Added
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading suppliers...</div>
        </div>
      ) : (
        <>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm text-gray-600">
              <span className="font-semibold text-gray-900">{filteredSuppliers.length}</span> suppliers found
            </div>
          </div>

          {filteredSuppliers.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No suppliers found matching your criteria</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredSuppliers.map((supplier) => (
            <div
              key={supplier.id}
              className="bg-white border border-gray-200 rounded-lg p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">{supplier.business_name}</h3>
                  <div className="flex items-center text-sm text-gray-600 mb-2">
                    <Building2 className="w-4 h-4 mr-1" />
                    <span>{supplier.products_services.join(', ')}</span>
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full font-medium ${
                    supplier.source === 'rainbowpages'
                      ? 'bg-orange-100 text-orange-700'
                      : supplier.source === 'wedabima'
                      ? 'bg-teal-100 text-teal-700'
                      : 'bg-green-100 text-green-700'
                  }`}
                >
                  {supplier.source === 'rainbowpages' ? 'Rainbow Pages' : supplier.source === 'wedabima' ? 'Wedabima' : 'User Added'}
                </span>
              </div>

              {supplier.description && (
                <p className="text-sm text-gray-600 mb-3">{supplier.description}</p>
              )}

              <div className="space-y-2 mb-4">
                <div className="flex items-center text-sm text-gray-700">
                  <Phone className="w-4 h-4 mr-2 text-gray-400" />
                  <span>{supplier.phone_primary}</span>
                </div>
                <div className="flex items-center text-sm text-gray-700">
                  <MapPin className="w-4 h-4 mr-2 text-gray-400" />
                  <span>{supplier.address}, {supplier.city}</span>
                </div>
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={() => handleCall(supplier.phone_primary)}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
                >
                  <Phone className="w-4 h-4" />
                  <span>Call</span>
                </button>
                <button
                  onClick={() => handleWhatsApp(supplier.phone_primary, supplier.business_name)}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>WhatsApp</span>
                </button>
              </div>
            </div>
          ))}
        </div>
          )}
        </>
      )}
        </>
      )}
    </div>
  );
}
