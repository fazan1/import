import { useState } from 'react';
import { supabase } from '../lib/supabase';
import BackupRestore from './BackupRestore';
import UsersPanel from './UsersPanel';
import { Trash2, TriangleAlert as AlertTriangle, Database, Settings as SettingsIcon, TrendingUp } from 'lucide-react';

export default function Settings({ isAdmin, myId }: { isAdmin: boolean; myId: string }) {
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showClearCeoConfirm, setShowClearCeoConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearingCeo, setClearingCeo] = useState(false);

  async function clearAllData() {
    setClearing(true);
    try {
      { const { error } = await supabase.from('calls').delete().neq('id', '00000000-0000-0000-0000-000000000000'); if (error) throw error; }
      { const { error } = await supabase.from('sales_invoices').delete().neq('id', '00000000-0000-0000-0000-000000000000'); if (error) throw error; }
      { const { error } = await supabase.from('customers').delete().neq('id', '00000000-0000-0000-0000-000000000000'); if (error) throw error; }

      setShowClearConfirm(false);
      alert('All data has been cleared successfully');
    } catch (error) {
      console.error('Error clearing data:', error);
      alert('Error clearing data. Please try again.');
    } finally {
      setClearing(false);
    }
  }

  async function clearCeoData() {
    setClearingCeo(true);
    try {
      { const { error } = await supabase.from('financial_targets').delete().neq('id', '00000000-0000-0000-0000-000000000000'); if (error) throw error; }
      { const { error } = await supabase.from('financial_records').delete().neq('id', '00000000-0000-0000-0000-000000000000'); if (error) throw error; }

      setShowClearCeoConfirm(false);
      alert('CEO financial data has been cleared successfully');
    } catch (error) {
      console.error('Error clearing CEO data:', error);
      alert('Error clearing CEO data. Please try again.');
    } finally {
      setClearingCeo(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="bg-teal-100 rounded-lg p-2">
              <SettingsIcon className="w-5 h-5 text-teal-700" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Application Settings</h2>
              <p className="text-sm text-gray-500">Manage your CRM configuration and data</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-8">
          <div className="max-w-2xl space-y-6">
            <UsersPanel isAdmin={isAdmin} myId={myId} />

            {isAdmin && <BackupRestore />}

            {isAdmin && <>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
              <div className="flex items-start space-x-4">
                <div className="bg-amber-100 rounded-full p-3 flex-shrink-0">
                  <TrendingUp className="w-6 h-6 text-amber-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-amber-900 mb-2">Clear CEO Financial Data</h3>
                  <p className="text-sm text-amber-700 mb-4">
                    Delete all financial records and targets from the CEO spreadsheet. This will not affect customer or sales data.
                  </p>
                  <button
                    onClick={() => setShowClearCeoConfirm(true)}
                    className="flex items-center space-x-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors font-medium"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Clear CEO Data</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <div className="flex items-start space-x-4">
                <div className="bg-red-100 rounded-full p-3 flex-shrink-0">
                  <Database className="w-6 h-6 text-red-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-red-900 mb-2">Danger Zone</h3>
                  <p className="text-sm text-red-700 mb-4">
                    Permanently delete all CRM data (customers, calls, and sales invoices) from the database. This action cannot be undone.
                  </p>
                  <button
                    onClick={() => setShowClearConfirm(true)}
                    className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Clear All CRM Data</span>
                  </button>
                </div>
              </div>
            </div>
            </>}
          </div>
        </div>
      </div>

      {showClearCeoConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="bg-amber-100 rounded-full p-3">
                <AlertTriangle className="w-6 h-6 text-amber-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Clear CEO Data?</h3>
            </div>

            <p className="text-gray-600 mb-6">
              This will permanently delete all financial records and targets from the CEO spreadsheet.
              This action cannot be undone.
            </p>

            <div className="flex space-x-3">
              <button
                onClick={() => setShowClearCeoConfirm(false)}
                disabled={clearingCeo}
                className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={clearCeoData}
                disabled={clearingCeo}
                className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors font-medium disabled:opacity-50 flex items-center justify-center"
              >
                {clearingCeo ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                ) : (
                  'Delete CEO Data'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="bg-red-100 rounded-full p-3">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900">Clear All CRM Data?</h3>
            </div>

            <p className="text-gray-600 mb-6">
              This will permanently delete all customers, calls, and sales invoices from the database.
              This action cannot be undone.
            </p>

            <div className="flex space-x-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                disabled={clearing}
                className="flex-1 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={clearAllData}
                disabled={clearing}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium disabled:opacity-50 flex items-center justify-center"
              >
                {clearing ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                ) : (
                  'Delete Everything'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
