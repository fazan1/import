/* Factory -> Pattern Settings: the owner's own reference page for the 10-gauge glove machine pattern settings
   (public/glove-pattern-settings.html, served from this site), shown inside the CRM. Static text, nothing saved. */
export default function FactoryPatternSettings() {
  return (
    <div className="-m-3 sm:-m-6 lg:-mb-6 -mb-20">
      <iframe title="Pattern settings" src="/glove-pattern-settings.html" className="block w-full border-0 bg-white" style={{ height: 'calc(100vh - 47px)' }} />
    </div>
  );
}
