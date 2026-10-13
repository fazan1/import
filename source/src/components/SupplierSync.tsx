import { useState } from 'react';
import { RefreshCw, Database, Clock, CheckCircle, XCircle, FileText } from 'lucide-react';

interface SyncResult {
  success: boolean;
  message: string;
  stats?: {
    total_found: number;
    unique_suppliers: number;
    inserted: number;
    updated: number;
    errors: number;
  };
  timestamp?: string;
}

export default function SupplierSync() {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);
  const [selectedSource, setSelectedSource] = useState<'both' | 'rainbowpages' | 'wedabima'>('both');

  const handleSync = async (dryRun: boolean = false) => {
    setSyncing(true);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-construction-suppliers`;
      const params = new URLSearchParams({
        source: selectedSource,
        dry_run: dryRun.toString(),
      });

      const response = await fetch(`${apiUrl}?${params}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      setLastSync(result);
    } catch (error) {
      setLastSync({
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleDebug = async () => {
    setSyncing(true);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-construction-suppliers`;
      const params = new URLSearchParams({
        debug: 'true',
      });

      console.log('Debug request URL:', `${apiUrl}?${params}`);

      const response = await fetch(`${apiUrl}?${params}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      console.log('Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        setLastSync({
          success: false,
          message: `Debug failed: ${response.status} - ${errorText.substring(0, 200)}`,
        });
        return;
      }

      const result = await response.json();
      console.log('Debug result:', result);

      setLastSync({
        success: true,
        message: `Debug successful! Found ${result.debug?.headings_found || 0} headings. Check console (F12) for full details.`,
      });
    } catch (error) {
      console.error('Debug error:', error);
      setLastSync({
        success: false,
        message: `Debug error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Supplier Database Sync</h1>
        <p className="text-sm text-gray-600 mt-1">
          Automatically scrape and update suppliers from Rainbow Pages and Wedabima
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <Database className="w-5 h-5 mr-2" />
          Manual Sync
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Source
            </label>
            <div className="flex space-x-2">
              <button
                onClick={() => setSelectedSource('both')}
                disabled={syncing}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedSource === 'both'
                    ? 'bg-teal-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                } disabled:opacity-50`}
              >
                Both Sources
              </button>
              <button
                onClick={() => setSelectedSource('rainbowpages')}
                disabled={syncing}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedSource === 'rainbowpages'
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                } disabled:opacity-50`}
              >
                Rainbow Pages
              </button>
              <button
                onClick={() => setSelectedSource('wedabima')}
                disabled={syncing}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedSource === 'wedabima'
                    ? 'bg-teal-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                } disabled:opacity-50`}
              >
                Wedabima
              </button>
            </div>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={handleDebug}
              disabled={syncing}
              className="flex items-center space-x-2 px-4 py-3 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Debugging...</span>
                </>
              ) : (
                <>
                  <FileText className="w-5 h-5" />
                  <span>Debug</span>
                </>
              )}
            </button>
            <button
              onClick={() => handleSync(true)}
              disabled={syncing}
              className="flex items-center space-x-2 px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Testing...</span>
                </>
              ) : (
                <>
                  <Database className="w-5 h-5" />
                  <span>Test Sync (Dry Run)</span>
                </>
              )}
            </button>
            <button
              onClick={() => handleSync(false)}
              disabled={syncing}
              className="flex items-center space-x-2 px-6 py-3 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Syncing...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-5 h-5" />
                  <span>Run Full Sync</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {lastSync && (
        <div className={`rounded-lg border p-6 ${
          lastSync.success
            ? 'bg-green-50 border-green-200'
            : 'bg-red-50 border-red-200'
        }`}>
          <div className="flex items-start space-x-3">
            {lastSync.success ? (
              <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <h3 className={`text-lg font-semibold mb-2 ${
                lastSync.success ? 'text-green-900' : 'text-red-900'
              }`}>
                {lastSync.message}
              </h3>

              {lastSync.stats && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
                  <div className="bg-white rounded-lg p-3 border border-gray-200">
                    <div className="text-2xl font-bold text-gray-900">
                      {lastSync.stats.total_found}
                    </div>
                    <div className="text-xs text-gray-600">Total Found</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-gray-200">
                    <div className="text-2xl font-bold text-gray-900">
                      {lastSync.stats.unique_suppliers}
                    </div>
                    <div className="text-xs text-gray-600">Unique</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-green-200">
                    <div className="text-2xl font-bold text-green-600">
                      {lastSync.stats.inserted}
                    </div>
                    <div className="text-xs text-gray-600">Inserted</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-blue-200">
                    <div className="text-2xl font-bold text-teal-700">
                      {lastSync.stats.updated}
                    </div>
                    <div className="text-xs text-gray-600">Updated</div>
                  </div>
                  <div className="bg-white rounded-lg p-3 border border-red-200">
                    <div className="text-2xl font-bold text-red-600">
                      {lastSync.stats.errors}
                    </div>
                    <div className="text-xs text-gray-600">Errors</div>
                  </div>
                </div>
              )}

              {lastSync.timestamp && (
                <div className="flex items-center text-sm text-gray-600 mt-3">
                  <Clock className="w-4 h-4 mr-1" />
                  <span>
                    Completed at {new Date(lastSync.timestamp).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-gradient-to-br from-teal-50 to-cyan-50 border border-teal-200 rounded-lg p-6">
        <div className="flex items-start space-x-3">
          <FileText className="w-6 h-6 text-teal-600 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-teal-900 mb-3">
              Automated Scheduled Scraping
            </h3>
            <div className="space-y-3 text-sm text-teal-800">
              <p className="font-medium">
                A GitHub Actions workflow is included for fully automated scraping!
              </p>
              <div className="bg-white rounded-lg p-4 border border-teal-200">
                <h4 className="font-semibold text-teal-900 mb-2">Quick Setup (3 steps):</h4>
                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Push this project to GitHub</li>
                  <li>
                    Add GitHub Secrets in Settings → Secrets and variables → Actions:
                    <ul className="list-disc list-inside ml-4 mt-1 text-xs">
                      <li><code className="bg-gray-100 px-1 rounded">VITE_SUPABASE_URL</code></li>
                      <li><code className="bg-gray-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code></li>
                    </ul>
                  </li>
                  <li>Done! Scraping runs automatically twice daily (3 AM & 3 PM UTC)</li>
                </ol>
              </div>
              <div className="bg-white rounded-lg p-4 border border-teal-200 mt-3">
                <h4 className="font-semibold text-teal-900 mb-2">Current Schedule:</h4>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Daily at 3 AM UTC (automatic)</li>
                  <li>Daily at 3 PM UTC (automatic)</li>
                  <li>Manual trigger available from GitHub Actions tab</li>
                </ul>
              </div>
              <p className="text-xs pt-3 border-t border-teal-300 mt-3">
                <strong>Note:</strong> See <code className="bg-white px-1 rounded">SCRAPING_SETUP.md</code> for detailed instructions,
                alternative scheduling options, and customization guide.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-teal-50 border border-blue-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">
          Alternative: External Cron Service
        </h3>
        <div className="space-y-3 text-sm text-teal-800">
          <p>
            You can also use services like cron-job.org or your own server:
          </p>
          <div className="bg-white rounded-lg p-4 border border-blue-200">
            <p className="font-semibold mb-2">Endpoint to call:</p>
            <code className="block text-xs bg-gray-100 p-2 rounded overflow-x-auto">
              POST {import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-construction-suppliers?source=both
            </code>
            <p className="font-semibold mt-3 mb-2">Headers:</p>
            <code className="block text-xs bg-gray-100 p-2 rounded">
              Authorization: Bearer {import.meta.env.VITE_SUPABASE_ANON_KEY}
            </code>
          </div>
          <p className="text-xs pt-3 border-t border-teal-300">
            <strong>Recommended frequency:</strong> Daily or twice daily. More frequent scraping may result in IP blocking.
          </p>
        </div>
      </div>
    </div>
  );
}
