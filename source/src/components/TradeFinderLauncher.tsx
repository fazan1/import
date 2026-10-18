import { useEffect } from 'react';

// Trade Finder is a separate page (public/trade-finder.html) that uses the CRM's database and login.
// It replaces this history entry, so "Back" from Trade Finder returns to the screen you came from.
export default function TradeFinderLauncher() {
  useEffect(() => { window.location.replace('/trade-finder.html'); }, []);
  return <div className="p-8 text-center text-gray-500">Opening Trade Finder…</div>;
}
