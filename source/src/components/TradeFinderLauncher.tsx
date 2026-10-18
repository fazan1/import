// Trade Finder is its own page (public/trade-finder.html) using the CRM's database and login.
// Shown inside the CRM like every other module: the page runs in a frame below the CRM header.
// ?embed=1 tells the page to drop its own sidebar / back buttons and show its sections as tabs.
export default function TradeFinderLauncher() {
  return (
    <div className="-m-3 sm:-m-6 lg:-mb-6 -mb-20">
      <iframe
        title="Trade Finder"
        src="/trade-finder.html?embed=1"
        className="block w-full border-0 bg-[#f4f3f1]"
        style={{ height: 'calc(100vh - 47px)' }}
      />
    </div>
  );
}
