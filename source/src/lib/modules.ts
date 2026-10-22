// Every screen a user can be given access to. Ids match View ids in App.tsx.
export const MODULE_GROUPS: { group: string; items: { id: string; label: string }[] }[] = [
  { group: 'General', items: [
    { id: 'main-dashboard', label: 'Dashboard' },
    { id: 'credit', label: 'Credit Evaluation' },
    { id: 'ceo', label: 'CEO Network' },
    { id: 'import-calc', label: 'Import Calculator' },
  ]},
  { group: 'Masters', items: [
    { id: 'customers', label: 'Customers' },
    { id: 'items', label: 'Items' },
    { id: 'suppliers', label: 'Suppliers' },
    { id: 'clearing-agents', label: 'Clearing Agents' },
  ]},
  { group: 'CN Portal', items: [
    { id: 'cn-home', label: 'Shop Home (BLINE SHOP book only)' },
    { id: 'purchase-orders', label: 'PO' },
    { id: 'purchase-bills', label: 'Bills' },
    { id: 'outstanding-payments', label: 'Outstanding Pay' },
    { id: 'investor', label: 'Investor Ledger' },
    { id: 'shipping', label: 'Shipping' },
    { id: 'shipment-history', label: 'Shipment History' },
    { id: 'batch-invoice', label: 'Batch Invoice' },
    { id: 'pl-input', label: 'PL Input' },
    { id: 'packing-list', label: 'Packing List' },
    { id: 'costing-duty', label: 'Costing & Duty' },
    { id: 'product-reference', label: 'Product Ref' },
    { id: 'cn-reports', label: 'CN Reports' },
  ]},
  { group: 'SL Portal', items: [
    { id: 'customer-outstanding', label: 'Outstanding' },
    { id: 'busy-sales-orders', label: 'SO' },
    { id: 'busy-sales-invoices', label: 'Sales Invoice' },
    { id: 'busy-sales-payments', label: 'Sales Payment' },
    { id: 'partner-payouts', label: 'Partner Payouts' },
  ]},
  { group: 'Other', items: [
    { id: 'reports', label: 'Reports' },
    { id: 'hunt', label: 'Hunt' },
    { id: 'expenses', label: 'Expenses (personal pool)' },
    { id: 'growth', label: 'Growth (RMB business)' },
    { id: 'trade-finder', label: 'Trade Finder (leads)' },
    { id: 'warehouse', label: 'Warehouse' },
    { id: 'factory-problems', label: 'Factory Problems' },
    { id: 'factory-my-data', label: 'My Data' },
    { id: 'factory-pattern', label: 'Pattern Settings (glove machine guide)' },
    { id: 'factory-mechanical', label: 'Mechanical Settings (glove machine guide)' },
    { id: 'recycle-bin', label: 'Recycle Bin' },
  ]},
];
export const ALL_MODULE_IDS = MODULE_GROUPS.flatMap((g) => g.items.map((i) => i.id));

export interface AppUser { user_id: string; email: string; name: string | null; role: 'admin' | 'staff'; modules: string[]; is_active: boolean; book?: string | null; created_at?: string; }

// The screens of the shop book — the shop login gets these, and an admin who switches to the shop book sees only these.
// The shop sees its own prices and costs, so Costing & Duty (landed cost) is part of its book too.
export const SHOP_MODULES = ['cn-home', 'purchase-orders', 'purchase-bills', 'outstanding-payments', 'investor', 'pl-input', 'packing-list', 'costing-duty', 'shipping', 'shipment-history', 'cn-reports', 'items', 'suppliers', 'clearing-agents'];

// Presets to make setup fast
export const PRESETS: { label: string; modules: string[] }[] = [
  { label: 'Everything', modules: ALL_MODULE_IDS },
  { label: 'Sales (SL Portal)', modules: ['sl-dashboard', 'customer-outstanding', 'busy-sales-orders', 'busy-sales-invoices', 'busy-sales-payments', 'partner-payouts', 'customers', 'items'] },
  { label: 'Import (CN Portal)', modules: ['cn-dashboard', 'purchase-orders', 'purchase-bills', 'outstanding-payments', 'shipping', 'shipment-history', 'pl-input', 'packing-list', 'costing-duty', 'product-reference', 'suppliers', 'items'] },
  { label: 'BLINE Shop (CN, own books)', modules: SHOP_MODULES },
  { label: 'Warehouse only', modules: ['warehouse'] },
  { label: 'Factory only', modules: ['factory-problems', 'factory-my-data', 'factory-pattern', 'factory-mechanical'] },
];
