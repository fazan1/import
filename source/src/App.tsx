import { useState, useEffect } from 'react';
import { LayoutDashboard, Users, FileText, Settings as SettingsIcon, LogOut, Building2, ClipboardList, Shield, Network, Calculator, Receipt, Boxes, FileStack, ClipboardCheck, ListChecks, FileSpreadsheet, ShoppingCart, CreditCard, DollarSign, Ship, Trash2, ShoppingBag, Wrench, FolderOpen, Container, BarChart3, Crosshair, Warehouse as WarehouseIcon, Landmark, Wallet, TrendingUp, BookOpen as BookIcon, Lock, Handshake, Search as SearchIcon } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { BOOK_ALL, BOOK_NEW, BOOK_OLD, BOOK_BRO, getBook, setBook, lockBook, unlockBook, setBookModes, bookMode } from './lib/book';
import type { BookMode } from './lib/book';
import Login from './components/Login';
import SignUp from './components/SignUp';
import { checkRecycleBinBook } from './lib/recycleBin';
import { companyFor } from './lib/company';
import Customers from './components/Customers';
import CallList from './components/CallList';
import CallForm from './components/CallForm';
import SalesList from './components/SalesList';
import CustomerSummary from './components/CustomerSummary';
import CreditEvaluation from './components/CreditEvaluation';
import Settings from './components/Settings';
import CEONetwork from './components/CEONetwork';
import ImportCostCalculator from './components/ImportCostCalculator';
import Suppliers from './components/Suppliers';
import PurchaseOrders from './components/PurchaseOrders';
import PurchaseBills from './components/PurchaseBills';
import Items from './components/Items';
import BatchInvoice from './components/BatchInvoice';
import PLInput from './components/PLInput';
import PackingList from './components/PackingList';
import CostingDutySheet from './components/CostingDutySheet';
import CNPortalDashboard from './components/CNPortalDashboard';
import CalculatorPanel from './components/CalculatorPanel';
import BusySalesOrders from './components/BusySalesOrders';
import BusySalesInvoices from './components/BusySalesInvoices';
import BusySalesPayments from './components/BusySalesPayments';
import OutstandingPayments from './components/OutstandingPayments';
import ShipmentHistory from './components/ShipmentHistory';
import SLPortalDashboard from './components/SLPortalDashboard';
import CustomerOutstanding from './components/CustomerOutstanding';
import PartnerPayouts from './components/PartnerPayouts';
import TradeFinderLauncher from './components/TradeFinderLauncher';
import RecycleBin from './components/RecycleBin';
import UnifiedDashboard from './components/UnifiedDashboard';
import ProductReference from './components/ProductReference';
import FactoryProblems from './components/FactoryProblems';
import FactoryMyData from './components/FactoryMyData';
import Warehouse from './components/Warehouse';
import InvestorLedger from './components/InvestorLedger';
import ExpensePool from './components/ExpensePool';
import Growth from './components/Growth';
import { supabase, APP_MODE, APP_COMPANY, APP_TITLE } from './lib/supabase';
import type { AppUser } from './lib/modules';
import Shipping from './components/Shipping';
import Reports from './components/Reports';
import CnReports from './components/CnReports';
import CnHome from './components/CnHome';
import ClearingAgents from './components/ClearingAgents';
import { SHOP_MODULES } from './lib/modules';

const SETTINGS_PIN_HASH = 'd665119136130460b3e98647a4a280654685bf8eb0b300062a201879e7cb2074'; // SHA-256 of the Settings password
const HUNT_URL = 'https://claude.ai/artifact/WrDS1pCKmJ8Sv8YST4SvPc';

type View = 'main-dashboard' | 'customers' | 'calls' | 'sales' | 'summary' | 'credit' | 'ceo' | 'import-calc' | 'suppliers' | 'purchase-orders' | 'purchase-bills' | 'items' | 'batch-invoice' | 'pl-input' | 'packing-list' | 'costing-duty' | 'cn-dashboard' | 'outstanding-payments' | 'shipment-history' | 'product-reference' | 'busy-sales-orders' | 'busy-sales-invoices' | 'busy-sales-payments' | 'partner-payouts' | 'trade-finder' | 'sl-dashboard' | 'customer-outstanding' | 'recycle-bin' | 'settings' | 'factory-problems' | 'factory-my-data' | 'hunt' | 'investor' | 'expenses' | 'growth' | 'warehouse' | 'shipping' | 'reports' | 'cn-reports' | 'cn-home' | 'clearing-agents';

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

function App() {
  const { user, loading, signOut } = useAuth();
  const [showSignUp, setShowSignUp] = useState(false);
  const VIEW_IDS: View[] = ['main-dashboard', 'customers', 'calls', 'sales', 'summary', 'credit', 'ceo', 'import-calc', 'suppliers', 'purchase-orders', 'purchase-bills', 'items', 'batch-invoice', 'pl-input', 'packing-list', 'costing-duty', 'cn-dashboard', 'outstanding-payments', 'shipment-history', 'product-reference', 'busy-sales-orders', 'busy-sales-invoices', 'busy-sales-payments', 'partner-payouts', 'trade-finder', 'sl-dashboard', 'customer-outstanding', 'recycle-bin', 'settings', 'factory-problems', 'factory-my-data', 'investor', 'warehouse', 'shipping', 'reports', 'expenses', 'growth', 'cn-reports', 'cn-home', 'clearing-agents'];
  const viewFromHash = (): View | null => { const h = window.location.hash.replace(/^#\/?/, ''); return (VIEW_IDS as string[]).includes(h) ? (h as View) : null; };
  // the screen lives in the address bar: #/bills, #/warehouse … so tabs, refresh, back and bookmarks all work
  const [currentView, setCurrentViewState] = useState<View>(() => viewFromHash() ?? ('main-dashboard'));
  const setCurrentView = (v: View) => { setCurrentViewState(v); if (window.location.hash !== '#/' + v) window.history.pushState(null, '', '#/' + v); };
  useEffect(() => {
    if (!window.location.hash) window.history.replaceState(null, '', '#/' + currentView);
    const onPop = () => { const v = viewFromHash(); if (v) setCurrentViewState(v); };
    window.addEventListener('popstate', onPop); window.addEventListener('hashchange', onPop);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('hashchange', onPop); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [showCallForm, setShowCallForm] = useState(false);
  const [scheduleCallData, setScheduleCallData] = useState<{ customerId: string; customerName: string } | null>(null);
  const [completingCall, setCompletingCall] = useState<Call | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showCalc, setShowCalc] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [book, setBookState] = useState<string>(getBook());
  const [bookOpen, setBookOpen] = useState(false);
  const [settingsUnlocked, setSettingsUnlocked] = useState(() => sessionStorage.getItem('settings-unlocked') === '1');
  const [askPin, setAskPin] = useState(false);
  const [pinFor, setPinFor] = useState<'settings' | 'tools'>('settings');
  const [pendingView, setPendingView] = useState<View | null>(null);
  const [toolsUnlocked, setToolsUnlocked] = useState(() => sessionStorage.getItem('tools-unlocked') === '1');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  async function checkPin() {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex === SETTINGS_PIN_HASH) {
      setSettingsUnlocked(true); sessionStorage.setItem('settings-unlocked', '1');
      setToolsUnlocked(true); sessionStorage.setItem('tools-unlocked', '1');
      setAskPin(false); setPin(''); setPinError(false);
      setCurrentView(pinFor === 'tools' ? (pendingView ?? 'growth') : 'settings');
      setPendingView(null);
    } else setPinError(true);
  }
  function openSettings() { if (settingsUnlocked) setCurrentView('settings'); else { setPinFor('settings'); setPendingView(null); setPin(''); setPinError(false); setAskPin(true); } }
  function askToolsPin(target: View) { setPinFor('tools'); setPendingView(target); setPin(''); setPinError(false); setAskPin(true); }
  // permissions: undefined = loading, 'open' = no app_users table yet (everyone sees all), null = no row / disabled
  const [perm, setPerm] = useState<AppUser | null | 'open' | undefined>(undefined);
  useEffect(() => {
    if (!user) { setPerm(undefined); return; }
    supabase.from('app_users').select('*').eq('user_id', user.id).maybeSingle().then(({ data, error }) => {
      // never fall back to full access on an error: show "No access" and let them reload
      if (error) { console.error('could not read app_users', error); setPerm(null); return; }
      const u = data && data.is_active ? (data as AppUser) : null;
      if (!(u && u.role !== 'admin' && u.book)) { unlockBook(); setBookState(getBook()); }
      if (u && u.role !== 'admin' && u.book) { lockBook(u.book); setBookState(u.book); if (u.modules.includes('cn-home') && !sessionStorage.getItem('landed')) { sessionStorage.setItem('landed', '1'); setCurrentView('cn-home'); } }
      setPerm(u);
    });
  }, [user]);
  // Recycle Bin split by book only once books-separate.sql has run
  useEffect(() => { if (user) checkRecycleBinBook(); }, [user]);
  // book modes (OLD = collection only); no table yet = every book open
  const [, setModesLoaded] = useState(0);
  useEffect(() => {
    if (!user) return;
    supabase.from('book_settings').select('book, mode').then(({ data, error }) => {
      if (error || !data) return;
      setBookModes(Object.fromEntries(data.map((r: { book: string; mode: BookMode }) => [r.book, r.mode])));
      setModesLoaded((n) => n + 1); // redraw the banner
    });
  }, [user]);
  const canView = (item: { id: View }) => {
    if (item.id === 'settings') return true;
    if (perm === 'open' || perm === undefined) return true;
    if (!perm) return false;
    return perm.role === 'admin' || perm.modules.includes(item.id);
  };
  const isAdmin = perm === 'open' || (typeof perm === 'object' && perm !== null && perm.role === 'admin');
  useEffect(() => {
    if (perm === undefined || perm === 'open') return;
    if (!canView({ id: currentView })) {
      const first = ([...mainMenuItems, ...mastersSubMenuItems, ...cnPortalSubMenuItems, ...slPortalSubMenuItems, ...bottomMenuItems] as { id: View }[]).find(canView);
      setCurrentView(first ? first.id : 'settings');
    }
  }, [perm]); // eslint-disable-line react-hooks/exhaustive-deps
  // in the shop book only the shop's screens exist — land on its Home
  useEffect(() => {
    if (book === BOOK_BRO && currentView !== 'settings' && !SHOP_MODULES.includes(currentView)) setCurrentView('cn-home');
  }, [book, currentView]); // eslint-disable-line react-hooks/exhaustive-deps
  const [factoryProblemId, setFactoryProblemId] = useState<string | null>(null);
  const [preselectedOrderId, setPreselectedOrderId] = useState<string | null>(null);
  const [preselectedInvoiceId, setPreselectedInvoiceId] = useState<string | null>(null);
  const [preselectedSupplierId, setPreselectedSupplierId] = useState<string | null>(null);
  const [preselectedBillId, setPreselectedBillId] = useState<string | null>(null);
  const [preselectedSOItems, setPreselectedSOItems] = useState<{ item_name: string; quantity: number; unit: string }[] | null>(null);
  const [preselectedSOId, setPreselectedSOId] = useState<string | null>(null);

  const mainMenuItems = [
    { id: 'main-dashboard' as View, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'credit' as View, label: 'Credit Evaluation', icon: Shield },
    { id: 'ceo' as View, label: 'CEO Network', icon: Network },
    { id: 'import-calc' as View, label: 'Import Calculator', icon: Calculator },
  ];

  const mastersSubMenuItems: { id: View; label: string; icon: typeof Building2 }[] = [
    { id: 'customers' as View, label: 'Customers', icon: Users },
    { id: 'items' as View, label: 'Items', icon: Boxes },
    { id: 'suppliers' as View, label: 'Suppliers', icon: Building2 },
    { id: 'clearing-agents' as View, label: 'Clearing Agents', icon: Container },
  ];

  const cnPortalSubMenuItems: { id: View; label: string; icon: typeof Building2 }[] = [
    { id: 'cn-home' as View, label: 'Home', icon: LayoutDashboard },
    { id: 'purchase-orders' as View, label: 'PO', icon: ClipboardList },
    { id: 'purchase-bills' as View, label: 'Bills', icon: Receipt },
    { id: 'outstanding-payments' as View, label: 'Outstanding Pay', icon: DollarSign },
    { id: 'investor' as View, label: 'Investor Ledger', icon: Landmark },
    { id: 'shipping' as View, label: 'Shipping', icon: Container },
    { id: 'shipment-history' as View, label: 'Shipment History', icon: Ship },
    { id: 'batch-invoice' as View, label: 'Batch Invoice', icon: FileStack },
    { id: 'pl-input' as View, label: 'PL Input', icon: ClipboardCheck },
    { id: 'packing-list' as View, label: 'Packing List', icon: ListChecks },
    { id: 'costing-duty' as View, label: 'Costing & Duty', icon: FileSpreadsheet },
    { id: 'product-reference' as View, label: 'Product Ref', icon: ShoppingBag },
    { id: 'cn-reports' as View, label: 'CN Reports', icon: BarChart3 },
  ];

  const slPortalSubMenuItems: { id: View; label: string; icon: typeof Building2 }[] = [
    { id: 'busy-sales-orders' as View, label: 'SO', icon: ShoppingCart },
    { id: 'busy-sales-invoices' as View, label: 'Sales Invoice', icon: FileText },
    { id: 'busy-sales-payments' as View, label: 'Sales Payment', icon: CreditCard },
    { id: 'partner-payouts' as View, label: 'Partner Payouts', icon: Handshake },
    { id: 'customer-outstanding' as View, label: 'Outstanding', icon: DollarSign },
  ];

  const bottomMenuItems = [
    { id: 'reports' as View, label: 'Reports', icon: BarChart3 },
    { id: 'hunt' as View, label: 'Hunt', icon: Crosshair },
    { id: 'warehouse' as View, label: 'Warehouse', icon: WarehouseIcon },
    { id: 'factory-problems' as View, label: 'Factory Problems', icon: Wrench },
    { id: 'factory-my-data' as View, label: 'My Data', icon: FolderOpen },
    { id: 'recycle-bin' as View, label: 'Recycle Bin', icon: Trash2 },
    { id: 'settings' as View, label: 'Settings', icon: SettingsIcon },
  ];

  function handleCompleteCall(call: Call) {
    setCompletingCall(call);
  }

  function handleCallFormClose() {
    setShowCallForm(false);
    setScheduleCallData(null);
    setRefreshTrigger(prev => prev + 1);
  }

  function renderView() {
    if (perm === null) {
      return <div className="max-w-md mx-auto mt-16 bg-white border border-gray-200 rounded-xl p-8 text-center"><h2 className="text-lg font-semibold text-gray-900 mb-2">No access yet</h2><p className="text-sm text-gray-600">Your account ({user?.email}) has not been given any modules. Ask the admin to open Settings → Users & permissions and enable it.</p></div>;
    }
    if (!canView({ id: currentView })) return <div className="p-6 text-gray-500">You don't have access to this screen.</div>;
    if (currentView === 'ceo' && book !== BOOK_NEW) return <div className="p-6 text-gray-500">CEO Network is part of the {BOOK_NEW} book. <button onClick={() => changeBook(BOOK_NEW)} className="text-teal-700 underline">Switch to {BOOK_NEW}</button></div>;
    if (book === BOOK_BRO && currentView !== 'settings' && !SHOP_MODULES.includes(currentView)) return <div className="p-6 text-gray-500">This screen is not part of the BLINE SHOP book. <button onClick={() => setCurrentView('cn-home')} className="text-teal-700 underline">Go to the shop's Home</button></div>;
    if (inToolsGroup(currentView) && !toolsUnlocked) return <div className="p-6 text-gray-500">Tools is locked. <button onClick={() => askToolsPin(currentView)} className="text-teal-700 underline">Enter password</button></div>;
    if (currentView === 'settings' && !settingsUnlocked) return <div className="p-6 text-gray-500">Settings is locked. <button onClick={openSettings} className="text-teal-700 underline">Enter password</button></div>;
    switch (currentView) {
      case 'main-dashboard':
        return <UnifiedDashboard name={typeof perm === 'object' && perm ? (perm.name || perm.email) : user?.email} onNavigate={(view) => setCurrentView(view as View)} />;
      case 'customers':
        return <Customers />;
      case 'calls':
        return (
          <CallList
            onCompleteCall={handleCompleteCall}
            refreshTrigger={refreshTrigger}
          />
        );
      case 'sales':
        return <SalesList />;
      case 'summary':
        return <CustomerSummary />;
      case 'credit':
        return <CreditEvaluation />;
      case 'ceo':
        return <CEONetwork />;
      case 'import-calc':
        return <ImportCostCalculator />;
      case 'items':
        return <Items />;
      case 'suppliers':
        return <Suppliers />;
      case 'shipping':
        return <Shipping />;
      case 'reports':
        return <Reports />;
      case 'cn-reports':
        return <CnReports />;
      case 'clearing-agents':
        return <ClearingAgents />;
      case 'cn-home':
        if (book !== BOOK_BRO) return <UnifiedDashboard name={typeof perm === 'object' && perm ? (perm.name || perm.email) : user?.email} onNavigate={(view) => setCurrentView(view as View)} />;
        return <CnHome name={typeof perm === 'object' && perm ? (perm.name || perm.email) : null} onNavigate={(v) => setCurrentView(v as View)} />;
      case 'investor':
        return <InvestorLedger />;
      case 'expenses':
        return <ExpensePool />;
      case 'growth':
        return <Growth />;
      case 'warehouse':
        return <Warehouse />;
      case 'purchase-orders':
        return (
          <PurchaseOrders
            preselectedSOItems={preselectedSOItems || undefined}
            preselectedSOId={preselectedSOId || undefined}
            onClearPreselection={() => {
              setPreselectedSOItems(null);
              setPreselectedSOId(null);
            }}
          />
        );
      case 'purchase-bills':
        return (
          <PurchaseBills
            preselectedBillId={preselectedBillId || undefined}
            onClearPreselection={() => setPreselectedBillId(null)}
          />
        );
      case 'batch-invoice':
        return <BatchInvoice />;
      case 'pl-input':
        return <PLInput />;
      case 'packing-list':
        return <PackingList />;
      case 'costing-duty':
        return <CostingDutySheet />;
      case 'product-reference':
        return <ProductReference />;
      case 'cn-dashboard':
        return (
          <CNPortalDashboard
            onNavigate={(view, filter) => {
              if (view === 'outstanding-payments') setPreselectedSupplierId(filter?.supplierId || null);
              setCurrentView(view as View);
            }}
          />
        );
      case 'outstanding-payments':
        return (
          <OutstandingPayments
            initialSupplierId={preselectedSupplierId || undefined}
            onRecordPayment={(billId) => {
              setPreselectedBillId(billId);
              setCurrentView('purchase-bills');
            }}
          />
        );
      case 'shipment-history':
        return <ShipmentHistory />;
      case 'sl-dashboard':
        return (
          <SLPortalDashboard
            onNavigate={(view) => {
              if (view === 'busy-sales-orders') {
                setCurrentView('busy-sales-orders');
              } else if (view === 'busy-sales-invoices') {
                setCurrentView('busy-sales-invoices');
              } else if (view === 'busy-sales-payments') {
                setCurrentView('busy-sales-payments');
              } else if (view === 'customer-outstanding') {
                setCurrentView('customer-outstanding');
              }
            }}
          />
        );
      case 'customer-outstanding':
        return <CustomerOutstanding />;
      case 'busy-sales-orders':
        return (
          <BusySalesOrders
            onCreateInvoice={(orderId) => {
              setPreselectedOrderId(orderId);
              setCurrentView('busy-sales-invoices');
            }}
            onCopyToPO={(orderId, items) => {
              setPreselectedSOId(orderId);
              setPreselectedSOItems(items);
              setCurrentView('purchase-orders');
            }}
          />
        );
      case 'busy-sales-invoices':
        return (
          <BusySalesInvoices
            preselectedOrderId={preselectedOrderId}
            onClearPreselection={() => setPreselectedOrderId(null)}
            onRecordPayment={(invoiceId) => {
              setPreselectedInvoiceId(invoiceId);
              setCurrentView('busy-sales-payments');
            }}
          />
        );
      case 'busy-sales-payments':
        return (
          <BusySalesPayments
            preselectedInvoiceId={preselectedInvoiceId}
            onClearPreselection={() => setPreselectedInvoiceId(null)}
          />
        );
      case 'trade-finder':
        return <TradeFinderLauncher />;
      case 'partner-payouts':
        return <PartnerPayouts />;
      case 'factory-problems':
        return <FactoryProblems openProblemId={factoryProblemId} onOpenChange={setFactoryProblemId} />;
      case 'factory-my-data':
        return <FactoryMyData onOpenProblem={(id) => { setFactoryProblemId(id); setCurrentView('factory-problems'); }} />;
      case 'recycle-bin':
        return <RecycleBin />;
      case 'settings':
        return <Settings isAdmin={isAdmin} myId={user?.id ?? ''} />;
      default:
        return <CreditEvaluation />;
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 border-t-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    // no public sign-up: logins are created by an admin in Settings -> Users
    if (showSignUp) {
      return <SignUp onSwitchToLogin={() => setShowSignUp(false)} />;
    }
    return <Login />;
  }

  // ---- Menu 3: portals on a black strip, that portal's screens as a second row of tabs ----
  type Group = { key: string; label: string; items: { id: View; label: string; icon: typeof Building2 }[] };
  const groups: Group[] = [
    { key: 'home', label: 'Dashboard', items: [mainMenuItems[0]] },
    { key: 'masters', label: 'Masters', items: mastersSubMenuItems },
    { key: 'cn', label: 'CN Portal', items: cnPortalSubMenuItems },
    { key: 'sl', label: 'SL Portal', items: slPortalSubMenuItems },
    { key: 'reports', label: 'Reports', items: [bottomMenuItems[0]] },
    { key: 'warehouse', label: 'Warehouse', items: [bottomMenuItems[2]] },
    { key: 'factory', label: 'Factory', items: [bottomMenuItems[3], bottomMenuItems[4]] },
    { key: 'tools', label: 'Tools', items: [{ id: 'growth' as View, label: 'Capital', icon: TrendingUp }, { id: 'expenses' as View, label: 'Expenses', icon: Wallet }, { id: 'trade-finder' as View, label: 'Trade Finder', icon: SearchIcon }, mainMenuItems[1], mainMenuItems[2], mainMenuItems[3], bottomMenuItems[1], bottomMenuItems[5]] },
  ].filter((g) => APP_MODE !== 'shop' || ['home', 'masters', 'cn', 'reports'].includes(g.key))
   .map((g) => ({ ...g, items: g.items.filter(canView).filter((i) => book !== BOOK_BRO || SHOP_MODULES.includes(i.id)).filter((i) => i.id !== 'ceo' || book === BOOK_NEW).filter((i) => i.id !== 'cn-home' || book === BOOK_BRO).filter((i) => APP_MODE !== 'shop' || (g.key === 'cn' || ['main-dashboard', 'suppliers', 'items', 'reports'].includes(i.id))) })).filter((g) => g.items.length > 0);
  const activeGroup = groups.find((g) => g.items.some((i) => i.id === currentView)) ?? groups[0];
  const inToolsGroup = (id: View) => groups.find((g) => g.key === 'tools')?.items.some((i) => i.id === id) ?? false;
  const goItem = (id: View) => { setMoreOpen(false); if (id === 'hunt') window.open(HUNT_URL, '_blank', 'noopener'); else if (id === 'settings') openSettings(); else if (inToolsGroup(id) && !toolsUnlocked) askToolsPin(id); else setCurrentView(id); };
  const goGroup = (g: Group) => { if (g.items.some((i) => i.id === currentView)) return; goItem(g.items[0].id); };
  const portalBtn = (on: boolean) => `px-3 lg:px-2 2xl:px-4 h-11 text-[11px] 2xl:text-[12px] font-semibold uppercase tracking-[0.04em] 2xl:tracking-[0.08em] whitespace-nowrap border-b-2 transition-colors ${on ? 'text-white border-[#e8552a]' : 'text-neutral-200 border-transparent hover:text-white'}`;
  const bookLocked = typeof perm === 'object' && perm !== null && perm.role !== 'admin' && !!perm.book;
  function changeBook(b: string) {
    const was = book;
    setBook(b); setBookState(b);
    if (b === BOOK_BRO) setCurrentView('cn-home');                       // the shop's own home
    else if (was === BOOK_BRO) setCurrentView('main-dashboard');          // back to your full dashboard
  }

  const tabBtn = (on: boolean) => `px-3 py-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap border-b-2 transition-colors ${on ? 'text-neutral-900 border-[#e8552a]' : 'text-neutral-700 border-transparent hover:text-neutral-900'}`;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* black portal strip */}
      <header className="bg-[#0a0a0a] text-white sticky top-0 z-50 border-b-[3px] border-[#e8552a]">
        <div className="px-3 sm:px-5 flex items-center h-11">
          <div className="font-extrabold text-[13px] tracking-[0.18em] mr-2 lg:mr-5 select-none whitespace-nowrap shrink-0">{companyFor(book).short}<span className="hidden xl:inline font-mono font-normal text-[11px] tracking-[0.12em] text-neutral-300 ml-2">{APP_TITLE} / V146</span></div>
          <div className="relative mr-2 lg:mr-4 shrink-0">
            <button onClick={() => { if (!bookLocked) setBookOpen((o) => !o); }} title={bookLocked ? 'Your books' : 'Which set of books you are working in'}
              className={`flex items-center gap-1.5 border px-2 h-[26px] font-mono text-[11px] tracking-[0.1em] uppercase whitespace-nowrap transition-colors ${book === BOOK_NEW || bookLocked ? 'border-neutral-700 text-neutral-300 hover:border-neutral-500' : 'border-amber-500 text-amber-400 hover:bg-amber-500/10'}`}>
              <BookIcon className="w-3 h-3" />
              <span className="hidden sm:inline">{book === BOOK_ALL ? 'ALL BOOKS' : book}</span>
            </button>
            {bookOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setBookOpen(false)} />
                <div className="absolute left-0 top-[30px] z-50 w-52 bg-[#0a0a0a] border border-neutral-700 shadow-xl">
                  {[{ v: BOOK_NEW, t: BOOK_NEW, d: 'New business from the changeover' }, { v: BOOK_OLD, t: BOOK_OLD + ' BOOKS', d: 'Everything up to the changeover' }, { v: BOOK_ALL, t: 'ALL BOOKS', d: 'Old + LCL 2026 together, for checking' }, { v: BOOK_BRO, t: BOOK_BRO, d: 'Shop transactions only — kept apart' }].map((o) => (
                    <button key={o.v} onClick={() => { changeBook(o.v); setBookOpen(false); }}
                      className={`w-full text-left px-3 py-2 border-b border-neutral-800 last:border-0 hover:bg-neutral-900 ${o.v === book ? 'text-[#e8552a]' : 'text-neutral-300'}`}>
                      <div className="font-mono text-[11px] tracking-[0.1em] uppercase">{o.t}</div>
                      <div className="text-[11px] text-neutral-300 normal-case tracking-normal mt-0.5">{o.d}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <nav className="hidden lg:flex flex-1 min-w-0 items-stretch h-11 overflow-x-auto no-scrollbar">
            {groups.map((g) => <button key={g.key} onClick={() => goGroup(g)} className={portalBtn(g.key === activeGroup?.key)} title={g.label}><span className="2xl:hidden">{g.label.replace(' Portal', '')}</span><span className="hidden 2xl:inline">{g.label}</span>{g.key === 'tools' && !toolsUnlocked && <Lock className="w-3 h-3 inline ml-1.5 -mt-0.5 opacity-60" />}</button>)}
          </nav>
          <div className="ml-auto pl-3 flex items-center gap-1 shrink-0">
            <span className="hidden 2xl:inline whitespace-nowrap max-w-[180px] truncate font-mono text-[11px] text-neutral-300 mr-2" title={user?.email ?? ''}>{user?.email?.split('@')[0]?.toUpperCase()}{isAdmin ? ' / ADMIN' : ''}</span>
            <button onClick={() => setShowCalc((o) => !o)} className="p-2 text-neutral-200 hover:text-white" title="Calculator & pricing"><Calculator className="w-4 h-4" /></button>
            <button onClick={openSettings} className={`p-2 hover:text-white ${currentView === 'settings' ? 'text-[#e8552a]' : 'text-neutral-200'}`} title="Settings"><SettingsIcon className="w-4 h-4" /></button>
            <button onClick={signOut} className="flex items-center gap-1 px-2 py-1.5 text-neutral-200 hover:text-[#e8552a]" title="Sign out"><LogOut className="w-4 h-4" /><span className="font-mono text-[11px] text-neutral-300">v146</span></button>
          </div>
        </div>
        {/* second row: this portal's screens */}
        {activeGroup && activeGroup.items.length > 1 && (
          <div className="bg-white border-b border-[#d8d8d4] text-neutral-900">
            <div className="px-3 sm:px-5 flex items-stretch overflow-x-auto no-scrollbar">
              {activeGroup.items.map((it) => <button key={it.id} onClick={() => goItem(it.id)} className={tabBtn(it.id === currentView)}>{it.label}</button>)}
            </div>
          </div>
        )}
        {activeGroup && activeGroup.items.length === 1 && <div className="bg-white border-b border-[#d8d8d4] h-[3px]" />}
      </header>

      <div className="flex">
        {showCalc && <CalculatorPanel onClose={() => setShowCalc(false)} />}
        {askPin && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setAskPin(false)}>
            <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-xs p-5">
              <h3 className="font-semibold text-gray-900 mb-1">{pinFor === 'tools' ? 'Tools password' : 'Settings password'}</h3>
              <p className="text-xs text-gray-500 mb-3">{pinFor === 'tools' ? 'Tools is protected. Enter the password to continue.' : 'Settings is protected. Enter the password to continue.'}</p>
              <input autoFocus type="password" value={pin} onChange={(e) => { setPin(e.target.value); setPinError(false); }} onKeyDown={(e) => e.key === 'Enter' && checkPin()} className={`w-full px-3 py-2 border rounded-lg text-base focus:ring-2 focus:ring-teal-500 ${pinError ? 'border-red-400' : 'border-gray-300'}`} placeholder="Password" />
              {pinError && <p className="text-xs text-red-600 mt-1">Wrong password</p>}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setAskPin(false)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm">Cancel</button>
                <button onClick={checkPin} className="px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm">Open</button>
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 min-w-0 p-3 sm:p-6 bg-gray-50 overflow-x-hidden pb-20 lg:pb-6">
          {book !== BOOK_NEW && !bookLocked && (
            <div className="max-w-[1600px] mx-auto mb-3 border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 flex items-center justify-between gap-3">
              <span>{book === BOOK_ALL ? <><b>All books</b> — old and new together, for reading only. To add anything, switch to one book.</> : book === BOOK_BRO ? <><b>{BOOK_BRO}</b> — the shop's own books, separate from your import books. Anything you add or correct here stays in the shop book.</> : bookMode(BOOK_OLD) === 'closed' ? <><b>{BOOK_OLD} books — closed</b>. Reference only: nothing can be added or changed.</> : bookMode(BOOK_OLD) === 'collection' ? <><b>{BOOK_OLD} books — collection only</b>. Record customer receipts and supplier payments here. New POs, bills, shipments, orders and invoices go in {BOOK_NEW}.</> : <><b>{BOOK_OLD} books</b> — the business up to the changeover. Collect and settle here; anything you add is saved into the old books.</>}</span>
              <button onClick={() => changeBook(BOOK_NEW)} className="shrink-0 border border-amber-600 text-amber-900 px-2 py-1 text-[11px] font-semibold hover:bg-amber-100">Back to {BOOK_NEW}</button>
            </div>
          )}
          <div key={book} className="max-w-[1600px] mx-auto">
            {renderView()}
          </div>
        </main>
      </div>

      {/* phone: portals at the thumb */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-[#0a0a0a] border-t border-neutral-800 flex" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {groups.slice(0, 4).map((g) => <button key={g.key} onClick={() => goGroup(g)} className={`flex-1 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] border-t-2 ${g.key === activeGroup?.key ? 'text-[#e8552a] border-[#e8552a]' : 'text-neutral-200 border-transparent'}`}>{g.label.replace(' Portal', '')}</button>)}
        <button onClick={() => setMoreOpen((o) => !o)} className={`flex-1 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] border-t-2 ${moreOpen || (activeGroup && groups.indexOf(activeGroup) >= 4) ? 'text-[#e8552a] border-[#e8552a]' : 'text-neutral-200 border-transparent'}`}>More</button>
      </nav>
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMoreOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="absolute bottom-12 inset-x-0 bg-white border-t border-[#d8d8d4] max-h-[70vh] overflow-y-auto">
            {groups.slice(4).map((g) => (
              <div key={g.key} className="border-b border-[#ececea]">
                <div className="px-4 pt-3 pb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-neutral-600">{g.label}</div>
                {g.items.map((it) => <button key={it.id} onClick={() => goItem(it.id)} className={`w-full text-left px-4 py-2.5 text-[12px] uppercase tracking-[0.04em] ${it.id === currentView ? 'text-neutral-900 font-bold border-l-2 border-[#e8552a]' : 'text-neutral-700'}`}>{it.label}</button>)}
              </div>
            ))}
            <button onClick={() => { setMoreOpen(false); openSettings(); }} className="w-full text-left px-4 py-3 text-[12px] uppercase tracking-[0.04em] text-neutral-700">Settings</button>
          </div>
        </div>
      )}

      {showCallForm && scheduleCallData && (
        <CallForm
          customerId={scheduleCallData.customerId}
          customerName={scheduleCallData.customerName}
          call={null}
          onClose={handleCallFormClose}
          onSave={handleCallFormClose}
        />
      )}

      {completingCall && (
        <CallForm
          customerId={completingCall.customer_id}
          customerName={completingCall.customer_name}
          call={completingCall}
          onClose={() => {
            setCompletingCall(null);
            setRefreshTrigger(prev => prev + 1);
          }}
          onSave={() => {
            setCompletingCall(null);
            setRefreshTrigger(prev => prev + 1);
          }}
        />
      )}

    </div>
  );
}

export default App;
