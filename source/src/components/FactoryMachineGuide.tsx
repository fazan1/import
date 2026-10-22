import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, X, Info, Cpu, ChevronRight, Trash2 } from 'lucide-react';

/* FACTORY -> MACHINE SETTINGS
   The glove machine controller pages, laid out like the machine screen. Each row = one parameter.
   Tap the name: what it is, what happens when the value goes UP or DOWN, and which glove fault points to it.
   The owner adds his machines and types each machine's value; values are saved in factory_machine_settings
   (sql/factory-machine-settings.sql) so every phone shows the same. Nothing here talks to the machine. */

type Kind = 'number' | 'onoff' | 'fixed' | 'choice';
interface Param { key: string; label: string; zh?: string; kind: Kind; typical: string; what: string; up: string; down: string; fault: string }
interface Page { id: string; group: string; title: string; note: string; params: Param[] }

const PAGES: Page[] = [
  {
    id: 'pattern1', group: 'Pattern setting', title: 'Pattern 1: Functions', note: 'Which features of the glove program are switched on, the size and type, and the order of cutting and sealing.',
    params: [
      { key: 'size_sel', label: 'Size selection', kind: 'choice', typical: 'M', what: 'Which glove size program runs (S, M, L, XL). It changes the row counts of every part.', up: 'Bigger size = more rows, more yarn.', down: 'Smaller size.', fault: 'Glove too big or small overall = wrong size selected, check this before touching densities.' },
      { key: 'type_sel', label: 'Type selection', kind: 'choice', typical: 'General', what: 'Which glove type program runs (General = plain 5-finger; others for special styles).', up: '-', down: '-', fault: 'Wrong finger order or missing parts = wrong type.' },
      { key: 'drop_detect', label: 'Dropping detection', kind: 'onoff', typical: 'OFF', what: 'Sensor that stops the machine when the glove drops off the needles (fabric fall).', up: 'ON = stops when the fabric drops.', down: 'OFF = keeps running with no fabric, wasting yarn and risking needles.', fault: 'Machine runs on after a glove falls = turn ON.' },
      { key: 'sub_yarn_fn', label: 'Sub yarn function', kind: 'onoff', typical: 'OFF', what: 'Use a second (sub) yarn in the program, e.g. a second colour or reinforcing yarn.', up: 'ON = the sub yarn feeder is used where the pattern says.', down: 'OFF = single yarn only.', fault: 'Second yarn never appears = this is OFF.' },
      { key: 'overlock_fn', label: 'Overlocking function', kind: 'onoff', typical: 'ON', what: 'The finishing step that hides the yarn ends (overlocking) after the glove is knitted.', up: 'ON = yarn ends hidden automatically.', down: 'OFF = ends left loose, trimmed by hand.', fault: 'Loose yarn ends on finished gloves = turn ON and check Pattern 3.' },
      { key: 'knot_fn', label: 'Knotting function', kind: 'number', typical: '0', what: 'How many knots are tied at a yarn change. 0 = no knot.', up: 'More knots = stronger join, small lump.', down: '0 = no knot, relies on overlocking.', fault: 'Yarn joins opening = set 1.' },
      { key: 'blow_fn', label: 'Blowing function', kind: 'onoff', typical: 'ON', what: 'Air blow that clears lint and yarn ends from the needles.', up: 'ON = cleaner needles.', down: 'OFF = more lint, more needle jams.', fault: 'Lint build-up, lines in the fabric = turn ON (needs air supply).' },
      { key: 'sub_sciss_fn', label: 'Sub scissors function', kind: 'onoff', typical: 'OFF', what: 'Whether the second cutter is used at all. Only needed when a sub yarn or elastic is cut separately.', up: 'ON = sub scissors cut the sub yarn.', down: 'OFF = sub scissors never move.', fault: 'Sub yarn not cut = turn ON (and check the sub scissors version on Scissors & head).' },
      { key: 'cancel_half_needle', label: 'Cancel half needle function', kind: 'onoff', typical: 'OFF', what: 'Turns off the half-needle step used at the small palm.', up: 'ON = half needle step skipped.', down: 'OFF = half needle used as the pattern says.', fault: 'Leave OFF unless the technician says so.' },
      { key: 'seal_seq', label: 'Sealing sequence', kind: 'choice', typical: 'Cut first', what: 'At the finger tip: cut the yarn first then seal, or seal first then cut.', up: 'Cut first = shorter tail inside the tip.', down: 'Seal first = safer hold on thin yarn.', fault: 'Tips opening = try the other order.' },
      { key: 'main_release_seq', label: 'Main scissors releasing sequence', kind: 'choice', typical: 'Successively', what: 'How the main scissors release the yarn: one after the other (successively) or together.', up: '-', down: '-', fault: 'Yarn tangling at release = try the other option.' },
      { key: 'half_needle_dist', label: 'Distance of half needle on small palm', kind: 'choice', typical: 'Short distance', what: 'How far the half-needle step travels on the small palm (short / long).', up: 'Long = wider half-needle area.', down: 'Short = narrower.', fault: 'Small palm shape off = try the other.' },
      { key: 'half_needle_fix', label: 'Half needle function of yarn fixing', kind: 'onoff', typical: 'OFF', what: 'Use the half-needle move while fixing the yarn end.', up: 'ON.', down: 'OFF.', fault: 'Leave as the working machine.' },
      { key: 'head_speed_elastic_on', label: 'Head speed when inserting elastic yarn (on/off)', kind: 'onoff', typical: 'ON', what: 'Whether a special head speed is used while the elastic is fed.', up: 'ON = uses the value below.', down: 'OFF = normal speed while feeding elastic.', fault: 'Elastic breaking as it is fed = ON with a lower value.' },
      { key: 'head_speed_elastic', label: 'Head speed when inserting elastic yarn', kind: 'number', typical: '130', what: 'The head speed used while elastic is fed (when the switch above is ON).', up: 'Faster, more elastic breaks.', down: 'Slower, safer.', fault: 'Elastic snapping at the wrist = lower to 110.' },
      { key: 'laps_release_intact', label: 'Laps of releasing yarn on intact finger', kind: 'number', typical: '2', what: 'Rows over which the yarn is released at the tip of a closed finger.', up: 'More rows = softer tip.', down: 'Fewer rows = tighter tip.', fault: 'Finger tip pointed or tight = raise by 1.' },
      { key: 'laps_release_hole', label: 'Laps of releasing yarn on hole finger', kind: 'number', typical: '3', what: 'Same for an open (fingerless) finger.', up: 'Softer open edge.', down: 'Tighter edge.', fault: 'Open finger edge curling = adjust by 1.' },
      { key: 'rear_density_half', label: 'Rear density value of half needle', kind: 'number', typical: '11', what: 'Stitch tightness on the rear plate during the half-needle step.', up: 'Looser.', down: 'Tighter.', fault: 'Small palm back loose or tight = change by 1.' },
      { key: 'idling_speed', label: 'Idling speed', kind: 'number', typical: '160', what: 'Speed when the machine turns without knitting.', up: 'Faster idle.', down: 'Slower.', fault: 'Leave.' },
      { key: 'jog_speed', label: 'Jogging speed', kind: 'number', typical: '20', what: 'Speed when the operator inches the machine by hand (jog button).', up: 'Faster jog, less control.', down: 'Slower, finer control.', fault: 'Leave at 20.' },
    ],
  },
  {
    id: 'speeds', group: 'Pattern setting', title: 'Pattern 2: Speeds', note: 'Speeds for each stage of the glove, elastic feed, oiling and needle breakage detection.',
    params: [
      { key: 'restart_speed', label: 'Reboot speed', kind: 'number', typical: '120', what: 'Speed after a stop or a yarn fix.', up: 'Restarts faster.', down: 'Gentler restart.', fault: 'Dropped stitches on the first rows after a restart = lower to 100.' },
      { key: 'closing_speed', label: 'Sealing speed', kind: 'number', typical: '120', what: 'Speed while sewing the finger tip closed.', up: 'Faster closing.', down: 'Slower, tighter closing.', fault: 'Holes at finger tips = lower to 100.' },
      { key: 'pre_finger_speed', label: 'Speed before changing fingers', kind: 'number', typical: '120', what: 'Speed on the last rows before the carriage moves to the next finger.', up: 'Faster.', down: 'Slower.', fault: 'Loose or uneven finger joins = lower to 100.' },
      { key: 'yarn_change_speed', label: 'Speed of changing yarn', kind: 'number', typical: '80', what: 'Speed while a second yarn is brought in.', up: 'Faster change.', down: 'Safer change.', fault: 'Yarn breaks at a colour or elastic change = lower to 60.' },
      { key: 'knot_speed', label: 'Knotting speed', kind: 'number', typical: '80', what: 'Speed while the knot is made.', up: 'Faster.', down: 'Surer knot.', fault: 'Knots open or missing = lower to 60.' },
      { key: 'idle_circles', label: 'Idling laps', kind: 'number', typical: '5', what: 'Empty turns before knitting starts.', up: 'More empty turns.', down: 'Fewer.', fault: 'Leave.' },
      { key: 'crawl_speed', label: 'First-run speed', kind: 'number', typical: '40', what: 'Slow speed for positioning and the first stitches.', up: 'Faster first row.', down: 'Slower first row.', fault: 'First row not catching = lower to 30.' },
      { key: 'elastic_speed', label: 'Speed of releasing elastic yarn', kind: 'number', typical: '80', what: 'How fast the elastic is fed in the wrist.', up: 'More elastic fed = looser wrist.', down: 'Less elastic fed = tighter wrist.', fault: 'Wrist too tight = raise by 10. Wrist too loose = lower by 10.' },
      { key: 'elastic_after_wrist', label: 'Number of elastic yarn on the end of wrist', kind: 'number', typical: '1', what: 'Extra rows knitted with elastic after the wrist.', up: 'More elastic rows.', down: 'Fewer.', fault: 'Leave.' },
      { key: 'elastic_after_cut', label: 'Elastic yarn final release value', kind: 'number', typical: '25', what: 'Elastic let out after the cut so it does not snap back into the wrist.', up: 'Longer tail left.', down: 'Shorter tail.', fault: 'Elastic tail pulling back into the wrist = raise by 4.' },
      { key: 'after_oil_speed', label: 'Speed after oiling', kind: 'number', typical: '100', what: 'Speed for a few turns right after self-oiling.', up: 'Faster after oiling.', down: 'Slower.', fault: 'Oil marks on gloves after oiling = lower.' },
      { key: 'after_oil_circles', label: 'Laps of slow running after oiling', kind: 'number', typical: '5', what: 'How many turns run at the "after oiling" speed.', up: 'More slow turns.', down: 'Fewer.', fault: 'Leave.' },
      { key: 'bnd_enable', label: 'Needle breakage detection function', kind: 'onoff', typical: 'OFF', what: 'Whether the machine stops when it detects a broken needle.', up: 'ON = stops at a broken needle.', down: 'OFF = keeps knitting a line of holes until someone sees it.', fault: 'Gloves with a line of holes found late = turn ON and set the interval to 1 or 2.' },
      { key: 'needles_front', label: 'Front needle quantity', kind: 'fixed', typical: '58', what: 'Needle count on the front plate. A machine fact.', up: 'Must equal the real plate.', down: 'Must equal the real plate.', fault: 'Wrong count = the finger widths are wrong.' },
      { key: 'needles_rear', label: 'Rear needle quantity', kind: 'fixed', typical: '58', what: 'Needle count on the rear plate.', up: 'Must equal the real plate.', down: 'Must equal the real plate.', fault: 'Same.' },
      { key: 'bnd_interval', label: 'Needle breakage detection interval', kind: 'number', typical: '0', what: 'How often the broken-needle check runs (in rows). Only matters when detection is ON.', up: 'Checks less often.', down: 'Checks more often (0 = every row).', fault: 'Set 1 or 2 when detection is ON.' },
      { key: 'stop_main_before_reset', label: 'Stop main yarn before resetting', kind: 'onoff', typical: 'OFF', what: 'Whether the main yarn feed stops before the machine resets.', up: 'ON.', down: 'OFF.', fault: 'Leave OFF unless the main yarn tangles on reset.' },
      { key: 'three_finger_circles', label: 'Laps of three-finger conjoined palm', kind: 'number', typical: '0', what: 'Palm rows for three-finger gloves only.', up: 'More palm rows on three-finger gloves.', down: 'Fewer.', fault: '0 is correct for five-finger gloves.' },
      { key: 'press_depth_overlock', label: 'Depth of pressing needle (overlocking)', kind: 'number', typical: '0', what: 'How far the press needle goes down during the overlocking (yarn-end hiding) step. 0 = not used.', up: 'Presses deeper while overlocking.', down: 'Lighter / off.', fault: 'Yarn ends not held down after overlocking = try 10 to 15.' },
      { key: 'wrist_travel', label: 'Distance of yarn fixing on palm', kind: 'number', typical: '0', what: 'How far the carriage moves on the palm with no thread while the yarn end is fixed. 0 = default.', up: 'Longer travel.', down: 'Shorter.', fault: 'Leave unless the yarn end on the palm is fixed in the wrong place.' },
    ],
  },
  {
    id: 'pattern3', group: 'Pattern setting', title: 'Pattern 3: Overlocking & finger tips', note: 'The yarn-end hiding (overlocking) step and extra yarn at each finger tip.',
    params: [
      { key: 'ol_hook_laps', label: 'Hook yarn laps (overlocking)', kind: 'number', typical: '1', what: 'Rows during which the yarn is hooked at the start of overlocking.', up: 'Holds the end over more rows.', down: 'Fewer rows.', fault: 'Yarn end slipping out at the start of overlocking = raise to 2.' },
      { key: 'ol_cut_laps', label: 'Cut yarn laps (overlocking)', kind: 'number', typical: '1', what: 'Rows knitted before the yarn is cut at the end of overlocking.', up: 'Longer hidden tail.', down: 'Shorter.', fault: 'Hidden tail too short and popping out = raise to 2.' },
      { key: 'ol_hide_fn', label: 'Hide yarn ends function (overlocking)', kind: 'onoff', typical: 'ON', what: 'Whether the yarn ends are tucked inside during overlocking.', up: 'ON = ends hidden.', down: 'OFF = ends visible.', fault: 'Visible yarn ends = turn ON.' },
      { key: 'adj_knit_speed', label: 'Adjusting knitting speed', kind: 'onoff', typical: 'OFF', what: 'Lets the operator change the knitting speed from the run screen without entering settings.', up: 'ON = speed knob active.', down: 'OFF = fixed speeds from the pattern.', fault: 'Leave OFF so nobody changes speeds by accident.' },
      { key: 'ol_density_loc', label: 'Density location of hiding yarn ends (overlocking)', kind: 'number', typical: '243', what: 'Where in the turn the density changes for the yarn-end hiding step.', up: 'Later in the turn.', down: 'Earlier.', fault: 'Hidden end sits in the wrong place on the glove = move by 5.' },
      { key: 'ol_density_val', label: 'Density value of hiding yarn ends (overlocking)', kind: 'number', typical: '16', what: 'Stitch tightness used while hiding the yarn ends.', up: 'Looser.', down: 'Tighter.', fault: 'Hidden end bulky = loosen by 1. End not held = tighten by 1.' },
      { key: 'sub_sciss_idle', label: 'Sub scissors idling movement', kind: 'number', typical: '0', what: 'Small movement of the sub scissors while idling, to keep them clear of the yarn. 0 = none.', up: 'Moves more.', down: '0 = stays still.', fault: 'Sub scissors catching yarn while idle = set 1.' },
      { key: 'ol_hook_fn', label: 'Hook yarn function (overlocking)', kind: 'onoff', typical: 'ON', what: 'Whether the yarn is hooked at the start of overlocking (the second "Hook yarn laps" line on the screen is this switch).', up: 'ON.', down: 'OFF = no hook, end may slip.', fault: 'Overlocking misses the yarn end = turn ON.' },
      { key: 'tip_little', label: 'Laps of insert yarn at little finger tip', kind: 'number', typical: '0', what: 'Extra reinforcing rows with the sub yarn at the little finger tip. 0 = none.', up: 'Stronger tip.', down: 'Plain tip.', fault: 'Tips wearing through = set 2 (needs the sub yarn function ON).' },
      { key: 'tip_ring', label: 'Laps of insert yarn at ring finger tip', kind: 'number', typical: '0', what: 'Same for the ring finger.', up: 'Stronger tip.', down: 'Plain.', fault: 'Same.' },
      { key: 'tip_middle', label: 'Laps of insert yarn at middle finger tip', kind: 'number', typical: '0', what: 'Same for the middle finger.', up: 'Stronger tip.', down: 'Plain.', fault: 'Same.' },
      { key: 'tip_index', label: 'Laps of insert yarn at index finger tip', kind: 'number', typical: '0', what: 'Same for the index finger.', up: 'Stronger tip.', down: 'Plain.', fault: 'Same.' },
      { key: 'tip_thumb', label: 'Laps of insert yarn at thumb tip', kind: 'number', typical: '0', what: 'Same for the thumb.', up: 'Stronger tip.', down: 'Plain.', fault: 'Same.' },
    ],
  },
];

interface Row { id?: string; machine: string; param_key: string; value: string }

export default function FactoryMachineGuide() {
  const [rows, setRows] = useState<Row[]>([]);
  const [machines, setMachines] = useState<string[]>([]);
  const [page, setPage] = useState(PAGES[0].id);
  const [open, setOpen] = useState<Param | null>(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);
  async function load() {
    const { data, error } = await supabase.from('factory_machine_settings').select('*').order('machine').order('param_key');
    if (error) { setDbError(error.message); setLoading(false); return; }
    const rs = (data ?? []) as Row[];
    setRows(rs.filter((r) => r.param_key !== '_machine'));
    const names = [...new Set(rs.map((r) => r.machine))];
    setMachines(names);
    setLoading(false);
  }

  const cur = useMemo(() => PAGES.find((p) => p.id === page)!, [page]);
  const valueOf = (m: string, k: string) => rows.find((r) => r.machine === m && r.param_key === k)?.value ?? '';

  async function addMachine() {
    const name = prompt('Machine name (e.g. "Machine 1 — Chinese screen", "Machine 2")');
    if (!name || !name.trim()) return;
    const n = name.trim();
    if (machines.includes(n)) { alert('That machine is already in the list'); return; }
    const { error } = await supabase.from('factory_machine_settings').upsert({ machine: n, param_key: '_machine', value: '' }, { onConflict: 'machine,param_key' });
    if (error) { alert('Could not add the machine: ' + error.message); return; }
    setMachines([...machines, n]);
  }

  async function removeMachine(m: string) {
    if (!confirm(`Remove "${m}" and all its typed values?`)) return;
    const { error } = await supabase.from('factory_machine_settings').delete().eq('machine', m);
    if (error) { alert('Could not remove: ' + error.message); return; }
    setMachines(machines.filter((x) => x !== m)); setRows(rows.filter((r) => r.machine !== m));
  }

  async function save(m: string, k: string, v: string) {
    const val = v.trim();
    if (valueOf(m, k) === val) return;
    setRows((prev) => { const other = prev.filter((r) => !(r.machine === m && r.param_key === k)); return val ? [...other, { machine: m, param_key: k, value: val }] : other; });
    const { error } = val
      ? await supabase.from('factory_machine_settings').upsert({ machine: m, param_key: k, value: val, updated_at: new Date().toISOString() }, { onConflict: 'machine,param_key' })
      : await supabase.from('factory_machine_settings').delete().eq('machine', m).eq('param_key', k);
    if (error) alert('Could not save: ' + error.message);
  }

  if (loading) return <div className="p-6 text-gray-500">Loading…</div>;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2"><Cpu className="w-6 h-6" />Machine Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">The controller pages of the glove machines. Tap a setting name to see what it does and what goes wrong when it is changed. Type each machine's values so you can compare them without photos.</p>
        </div>
        <button onClick={addMachine} className="flex items-center gap-2 bg-gray-900 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800"><Plus className="w-4 h-4" />Add machine</button>
      </div>

      {dbError && <div className="mb-4 text-sm bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-2.5">Values cannot be saved yet: {dbError}. Run <b>factory-machine-settings.sql</b> in Supabase once (MAIN project). The explanations below still work.</div>}

      <div className="space-y-2 mb-4">
        {[...new Set(PAGES.map((p) => p.group))].map((g) => (
          <div key={g} className="flex gap-2 flex-wrap items-center">
            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500 w-28">{g}</span>
            {PAGES.filter((p) => p.group === g).map((p) => <button key={p.id} onClick={() => setPage(p.id)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${page === p.id ? 'bg-[#111] text-white border-[#111]' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>{p.title}</button>)}
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500 mb-3">{cur.note}</p>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#111] text-white text-[10px] uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 w-8">#</th>
              <th className="text-left px-3 py-2">Setting</th>
              <th className="text-right px-3 py-2 whitespace-nowrap">Seen on screen</th>
              {machines.map((m) => <th key={m} className="text-right px-3 py-2 whitespace-nowrap">{m} <button onClick={() => removeMachine(m)} className="ml-1 text-gray-400 hover:text-red-400" title="Remove this machine"><Trash2 className="w-3 h-3 inline" /></button></th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {cur.params.map((p, i) => (
              <tr key={p.key} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-xs text-gray-400">{i + 1}</td>
                <td className="px-3 py-2">
                  <button onClick={() => setOpen(p)} className="text-left font-medium text-gray-900 hover:text-[#e8552a] flex items-start gap-1.5">
                    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-gray-400" /><span>{p.label}{p.zh && <span className="block text-xs text-gray-500 font-normal">{p.zh}</span>}{p.kind === 'fixed' && <span className="ml-2 text-[10px] font-mono uppercase tracking-wide text-gray-400">machine fact</span>}{p.kind === 'onoff' && <span className="ml-2 text-[10px] font-mono uppercase tracking-wide text-gray-400">on / off</span>}{p.kind === 'choice' && <span className="ml-2 text-[10px] font-mono uppercase tracking-wide text-gray-400">choice</span>}</span>
                  </button>
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-500">{p.typical}</td>
                {machines.map((m) => (
                  <td key={m} className="px-2 py-1 text-right">
                    <input defaultValue={valueOf(m, p.key)} onBlur={(e) => save(m, p.key, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      className={`w-24 text-right font-mono text-sm px-2 py-1 border rounded ${valueOf(m, p.key) && valueOf(m, p.key) !== p.typical ? 'border-amber-400 bg-amber-50' : 'border-gray-200'}`} placeholder="—" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-3">"Seen on screen" = the value on the photos you sent. A typed value that differs from it is shown in amber. Changes here do NOT change the machine; this is your notebook. Change one setting at a time on the machine, knit one glove, then write the new value here with the date in Factory Problems.</p>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(null)}>
          <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200">
              <div><div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500">{cur.title}</div><h2 className="text-lg font-bold text-gray-900 leading-tight mt-0.5">{open.label}</h2>{open.zh && <div className="text-sm text-gray-500">{open.zh}</div>}</div>
              <button onClick={() => setOpen(null)} className="p-1 text-gray-400 hover:text-gray-900"><X className="w-5 h-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-4 text-sm">
              <div><div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500 mb-1">What it is</div><p className="text-gray-800">{open.what}</p></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-[#f4f3f1] rounded-lg p-3"><div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500 mb-1">Value UP ▲</div><p className="text-gray-800">{open.up}</p></div>
                <div className="bg-[#f4f3f1] rounded-lg p-3"><div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500 mb-1">Value DOWN ▼</div><p className="text-gray-800">{open.down}</p></div>
              </div>
              <div className="border-l-4 border-[#e8552a] pl-3"><div className="text-[10px] font-mono uppercase tracking-[0.14em] text-gray-500 mb-1">Glove fault that points here</div><p className="text-gray-800">{open.fault}</p></div>
              <div className="flex items-center gap-2 text-xs text-gray-500"><ChevronRight className="w-3 h-3" />Seen on screen: <span className="font-mono text-gray-800">{open.typical}</span>{machines.map((m) => <span key={m} className="ml-3">{m}: <span className="font-mono text-gray-800">{valueOf(m, open.key) || '—'}</span></span>)}</div>
              {open.kind === 'fixed' && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">Machine fact: set by the maker to match the parts fitted. Do not change it to fix a glove fault.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
