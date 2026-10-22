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
    id: 'positions', group: 'Machine setting', title: 'Positions & oiling', note: 'Where the hook, scissors, fork and elastic act in each turn of the cylinder, the press needle depth, and self-oiling.',
    params: [
      { key: 'slots', label: 'Slots number', kind: 'fixed', typical: '52', what: 'How many needle slots the cylinder has. A machine fact, set by the maker.', up: 'Not changed. Must equal the real cylinder.', down: 'Not changed.', fault: 'If it does not match the cylinder, every position on this page is wrong.' },
      { key: 'hook_angle', label: 'Angle at which the hook blade hooks down', kind: 'number', typical: '185', what: 'The point in the turn where the hook blade comes down to catch the yarn at a yarn change.', up: 'Hooks later in the turn.', down: 'Hooks earlier.', fault: 'Yarn missed at the start of a finger or colour change: move by 2 or 3 either way and knit one glove.' },
      { key: 'cut_angle', label: 'Angle at which the scissors cut the yarn', kind: 'number', typical: '90', what: 'The point in the turn where the yarn is cut.', up: 'Cuts later: shorter tail, but the yarn can pull out of the fabric.', down: 'Cuts earlier: longer tail that must be trimmed.', fault: 'Long yarn tails = lower by 3 to 5. Yarn end pulling out of the glove = raise by 3 to 5.' },
      { key: 'fork_dist', label: 'Distance run by the fork motor (circle)', kind: 'number', typical: '32', what: 'How far the yarn fork travels to bring the yarn to the hook.', up: 'Fork goes further in.', down: 'Fork stays further out.', fault: 'Yarn not reaching the hook = raise by 1 or 2. Fork touching the needles = lower by 1.' },
      { key: 'sciss_dist', label: 'Distance run by the scissors motor (circle)', kind: 'number', typical: '32', what: 'How far the scissors travel to reach the yarn.', up: 'Scissors go further in.', down: 'Scissors stay further out.', fault: 'Scissors missing the yarn = raise by 1 or 2. Scissors hitting needles = lower by 1.' },
      { key: 'elastic_start', label: 'Starting position for releasing elastic yarn', kind: 'number', typical: '262', what: 'Where in the turn the elastic starts to be fed into the wrist.', up: 'Elastic starts later.', down: 'Elastic starts earlier.', fault: 'Elastic visible on one side of the wrist only = move start and end together by the same amount.' },
      { key: 'elastic_end', label: 'Ending position for releasing elastic yarn', kind: 'number', typical: '240', what: 'Where in the turn the elastic feed stops.', up: 'Elastic stops later (longer feed).', down: 'Elastic stops earlier (shorter feed).', fault: 'Wrist uneven: narrow or widen the gap between start and end. Keep the two values the same distance apart as the working machine.' },
      { key: 'fork_alarm', label: 'Fork alarm deviation', kind: 'number', typical: '5', what: 'How far the fork may wander from its expected position before the machine alarms.', up: 'Fewer alarms, less protection.', down: 'More alarms, more protection.', fault: 'Frequent fork alarms with good gloves = raise to 8. Fork crashing into needles without an alarm = lower to 3.' },
      { key: 'press_front', label: 'Depth of front press needle', kind: 'number', typical: '18', what: 'How far the front press needle pushes down when sealing the hot-melt wrist.', up: 'Presses deeper: stronger seal, more needle wear.', down: 'Presses less: weaker seal.', fault: 'Wrist seam opening on the front side = raise by 1. Needles bending or fabric marked = lower by 1.' },
      { key: 'press_rear', label: 'Depth of rear press needle', kind: 'number', typical: '18', what: 'Same as the front, for the rear press needle.', up: 'Deeper seal on the back.', down: 'Lighter seal on the back.', fault: 'Wrist seam opening on the back side = raise by 1. Front and rear can be different (18 / 17) if one plate seals weaker.' },
      { key: 'oil_interval', label: 'Oiling interval (min)', kind: 'number', typical: '150', what: 'How many minutes between self-oiling.', up: 'Oils less often.', down: 'Oils more often.', fault: 'Squeaking, heat or needle wear = shorten to 120. Oil spots on gloves = lengthen.' },
      { key: 'oil_time', label: 'Oiling time (s)', kind: 'number', typical: '4', what: 'How many seconds the oil pump runs each time.', up: 'More oil per cycle.', down: 'Less oil.', fault: 'Oil spots on gloves = lower to 3. Dry needles = raise to 5.' },
      { key: 'screen_off', label: 'Screen off time (min)', kind: 'number', typical: '1', what: 'Minutes before the display goes dark. Cosmetic.', up: 'Screen stays on longer.', down: 'Screen sleeps sooner.', fault: 'None.' },
      { key: 'production', label: 'Accumulated production', kind: 'fixed', typical: '46202', what: 'Total gloves this machine has made. The machine counts it.', up: 'Not typed.', down: 'Not typed.', fault: 'Use it to plan servicing: compare machines and note the count when a needle plate or cutter is changed.' },
      { key: 'spd_press_front', label: 'Front press needle unit speed', kind: 'number', typical: '300', what: 'Motor speed of the front press needle unit.', up: 'Faster movement.', down: 'Slower, safer.', fault: 'Motor stalls or alarms = lower this one only, to 250.' },
      { key: 'spd_density_front', label: 'Front density unit speed', kind: 'number', typical: '300', what: 'Motor speed of the front stitch-density (tightness) unit.', up: 'Faster density change.', down: 'Slower.', fault: 'Density motor alarm = lower to 250.' },
      { key: 'spd_press_rear', label: 'Rear press needle unit speed', kind: 'number', typical: '300', what: 'Motor speed of the rear press needle unit.', up: 'Faster.', down: 'Slower.', fault: 'Motor stalls = lower to 250.' },
      { key: 'spd_density_rear', label: 'Rear density unit speed', kind: 'number', typical: '300', what: 'Motor speed of the rear stitch-density unit.', up: 'Faster.', down: 'Slower.', fault: 'Density motor alarm = lower to 250.' },
      { key: 'spd_fork', label: 'Fork motor speed', kind: 'number', typical: '300', what: 'Speed of the yarn fork motor.', up: 'Faster yarn change, can overshoot.', down: 'Slower, surer.', fault: 'Fork alarm or fork overshooting the hook = lower to 250.' },
      { key: 'spd_sciss', label: 'Scissors motor speed', kind: 'number', typical: '300', what: 'Speed of the scissors motor.', up: 'Faster cut, can overshoot.', down: 'Slower cut.', fault: 'Scissors alarm = lower to 250.' },
    ],
  },
  {
    id: 'scissors', group: 'Machine setting', title: 'Scissors & head', note: 'The two cutters (main yarn and sub yarn = elastic or second colour), the knitting speeds, finger-tip sealing rods and the home positions.',
    params: [
      { key: 'main_sciss_speed', label: 'Main scissors speed', kind: 'number', typical: '200', what: 'Speed of the motor that moves the main yarn cutter.', up: 'Cuts faster, can overshoot or jam.', down: 'Slower cycle, safer.', fault: 'Main scissors motor alarm, or cutter hitting the needles = lower to 150.' },
      { key: 'sub_sciss_speed', label: 'Sub scissors speed', kind: 'number', typical: '200', what: 'Speed of the motor that moves the second cutter (elastic / second colour).', up: 'Faster.', down: 'Slower, safer.', fault: 'Sub scissors motor alarm = lower to 150.' },
      { key: 'cyl_finger', label: 'Cylinder speed (finger)', kind: 'number', typical: '400', what: 'Knitting speed while making the fingers.', up: 'More gloves per hour, more dropped stitches.', down: 'Cleaner fingers, slower.', fault: 'Holes or ladders in the fingers, yarn breaking on fingers = lower to 350.' },
      { key: 'cyl_palm', label: 'Cylinder speed (palm)', kind: 'number', typical: '300', what: 'Knitting speed on the palm and back (wider, so slower than fingers).', up: 'Faster, rougher.', down: 'Slower, cleaner.', fault: 'Holes or uneven rows on the palm = lower to 250.' },
      { key: 'rod_front', label: 'Front rod sealing position', kind: 'number', typical: '10', what: 'Where the front press rod sits when the finger tip is sewn closed.', up: 'Presses further in.', down: 'Presses less.', fault: 'Finger tip open or weak on the front side = change by 1.' },
      { key: 'rod_rear', label: 'Rear rod sealing position', kind: 'number', typical: '10', what: 'Where the rear press rod sits when sealing the finger tip.', up: 'Presses further in.', down: 'Presses less.', fault: 'Finger tip open on the back side = change by 1. Your two machines differ here (10 and 4): copy the value from the machine that seals well.' },
      { key: 'fork_home', label: 'Fork homing distance', kind: 'fixed', typical: '5.1', what: 'How far the yarn fork travels back to its home sensor. Set at the factory.', up: 'Not normally changed.', down: 'Not normally changed.', fault: '"Fork home" alarm at start-up: this is the value to check with the technician.' },
      { key: 'sciss_home', label: 'Scissors homing distance', kind: 'fixed', typical: '4.1', what: 'How far the scissors travel back to home. Set at the factory.', up: 'Not normally changed.', down: 'Not normally changed.', fault: '"Scissors home" alarm at start-up.' },
      { key: 'head_version', label: 'Head version', kind: 'fixed', typical: '2', what: 'Which type of knitting head is fitted.', up: 'Must match the machine. Do not change.', down: 'Do not change.', fault: 'Wrong version = head moves wrongly from the first row.' },
      { key: 'head_home', label: 'Head homing distance', kind: 'fixed', typical: '3', what: 'Home travel for the head. Set at the factory.', up: 'Do not change.', down: 'Do not change.', fault: 'Head home alarm.' },
      { key: 'little_finger_pos', label: 'Cylinder location when knitting first row of little finger with sub yarn set', kind: 'number', typical: '0', what: 'The needle position where the little finger starts when the second yarn is in. 0 = the machine default.', up: 'Start point moves round the cylinder.', down: 'Moves the other way.', fault: 'Little finger joined in the wrong place when a second yarn is used.' },
      { key: 'idle_first_row', label: 'Cylinder location when idling the first row', kind: 'number', typical: '51', what: 'Where the cylinder stops before the first row starts. On a 52-slot cylinder 51 is the last slot.', up: 'Stops one slot later.', down: 'Stops earlier.', fault: 'Leave it unless the first row starts in the wrong place.' },
      { key: 'sub_release_v0', label: 'Sub scissors releasing yarn angle (v0)', kind: 'number', typical: '0', what: 'How far the sub scissors open to release the yarn. Used ONLY when "Sub scissors version" is 0.', up: 'Opens wider on release.', down: '0 = does not open on release.', fault: 'Elastic or second yarn not released cleanly, tails pulled out (with version 0) = set to 8.' },
      { key: 'main_version', label: 'Main scissors version', kind: 'fixed', typical: '1', what: 'The type of main cutter fitted. 1 = the newer type; its two angles below are used.', up: 'Must match the physical part.', down: 'Must match the physical part.', fault: 'Wrong version = the angles below are ignored or wrong.' },
      { key: 'main_hook_angle', label: 'Angle of the main scissors when hooked at the highest point (v1, v2)', kind: 'number', typical: '40', what: 'How far the main scissors turn to catch the main yarn.', up: 'Catches more surely, can grab the wrong yarn.', down: 'Can miss the yarn.', fault: 'Main yarn not cut, long tails = raise by 2 or 3.' },
      { key: 'main_release_angle', label: 'Angle of the main scissors when released yarn (v1, v2)', kind: 'number', typical: '8', what: 'How far the main scissors turn back to let the yarn go.', up: 'Releases wider.', down: 'May keep hold of the yarn.', fault: 'Main yarn pulled back into the glove after the cut = raise by 2.' },
      { key: 'sub_version', label: 'Sub scissors version', kind: 'fixed', typical: '0', what: 'The type of sub cutter fitted. 0 = old type: the v0 release angle is used and the two sub angles below are IGNORED. 1 or 2 = newer type: the two angles below are used.', up: 'Set 1 only if the sub cutter is the same newer part as the main one.', down: 'Keep 0 for the old part.', fault: 'If the fitted sub cutter is the newer type but this says 0, the elastic cut and release misbehave: elastic not cut, elastic tail hanging at the wrist.' },
      { key: 'sub_hook_angle', label: 'Angle of the sub scissors when hooked at the highest point (v1, v2)', kind: 'number', typical: '40', what: 'How far the sub scissors turn to catch the second yarn. Only works with version 1 or 2.', up: 'Catches more surely.', down: 'Can miss.', fault: 'Second yarn / elastic not cut = raise by 2 or 3.' },
      { key: 'sub_release_angle', label: 'Angle of the sub scissors when released yarn (v1, v2)', kind: 'number', typical: '8', what: 'How far the sub scissors turn back to release. Only works with version 1 or 2.', up: 'Releases wider.', down: 'May hold on.', fault: 'Elastic tail pulled back after the cut = raise by 2.' },
    ],
  },
  {
    id: 'needle', group: 'Machine setting', title: 'Broken needle detection', note: 'Where in the turn the machine listens for a broken needle, front and back, and which solenoid logic the yarn feeders use.',
    params: [
      { key: 'bnd_back_start', label: 'Effective starting position of broken needle detection signal (back)', kind: 'number', typical: '285', what: 'The point in the turn where the machine starts listening to the rear broken-needle sensor.', up: 'Starts later.', down: 'Starts earlier.', fault: 'False "broken needle" stops on the back with good needles = narrow the window (start later / end earlier). Broken needles on the back not caught = widen it.' },
      { key: 'bnd_back_end', label: 'Effective ending position of broken needle detection signal (back)', kind: 'number', typical: '90', what: 'Where the machine stops listening to the rear sensor.', up: 'Ends later (wider window).', down: 'Ends earlier (narrower window).', fault: 'Same as above.' },
      { key: 'bnd_front_start', label: 'Effective starting position of broken needle detection signal (front)', kind: 'number', typical: '20', what: 'Start of the listening window for the front sensor.', up: 'Starts later.', down: 'Starts earlier.', fault: 'False stops on the front = narrow the window. Broken front needles not caught = widen it.' },
      { key: 'bnd_front_end', label: 'Effective ending position of broken needle detection signal (front)', kind: 'number', typical: '192', what: 'End of the listening window for the front sensor.', up: 'Wider window.', down: 'Narrower window.', fault: 'Same as above.' },
      { key: 'bnd_loc1', label: 'Cylinder location during broken needle detection (1)', kind: 'number', typical: '50', what: 'First cylinder position used for the check.', up: 'Moves the check point.', down: 'Moves it the other way.', fault: 'Leave unless the technician says otherwise.' },
      { key: 'bnd_loc2', label: 'Cylinder location during broken needle detection (2)', kind: 'number', typical: '51', what: 'Second cylinder position used for the check.', up: 'Moves the check point.', down: 'Moves it.', fault: 'Leave.' },
      { key: 'sol_primary', label: 'Primary and secondary switching solenoid running logic', kind: 'onoff', typical: '0', what: 'Whether the solenoid that switches between main and second yarn works normally (0) or inverted (1).', up: '1 = inverted signal.', down: '0 = normal.', fault: 'Only change if the yarn switch works backwards after a solenoid or board replacement.' },
      { key: 'sol_sub', label: 'Sub yarn solenoid running logic', kind: 'onoff', typical: '0', what: 'Normal (0) or inverted (1) logic for the sub-yarn solenoid.', up: '1 = inverted.', down: '0 = normal.', fault: 'Sub yarn feeds when it should not, or never feeds, after a part change.' },
      { key: 'sol_tricolor', label: 'Tricolor yarn solenoid running logic', kind: 'onoff', typical: '0', what: 'Normal (0) or inverted (1) logic for the third-colour solenoid.', up: '1 = inverted.', down: '0 = normal.', fault: 'Only for three-colour gloves.' },
      { key: 'language', label: 'Languages', kind: 'fixed', typical: 'English', what: 'Display language of the controller.', up: '-', down: '-', fault: 'None.' },
    ],
  },
  {
    id: 'pattern3', group: 'Pattern setting', title: 'Pattern: Overlocking & finger tips', note: 'The yarn-end hiding (overlocking) step and extra yarn at each finger tip.',
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
  {
    id: 'speeds', group: 'Pattern setting', title: 'Pattern: Speeds', note: 'Speeds for each stage of the glove. Some machines show this page in Chinese: the Chinese text is under each name.',
    params: [
      { key: 'restart_speed', label: 'Reboot speed', zh: '重启速度', kind: 'number', typical: '120', what: 'Speed after a stop or a yarn fix.', up: 'Restarts faster.', down: 'Gentler restart.', fault: 'Dropped stitches on the first rows after a restart = lower to 100.' },
      { key: 'closing_speed', label: 'Sealing speed', zh: '封口速度', kind: 'number', typical: '120', what: 'Speed while sewing the finger tip closed.', up: 'Faster closing.', down: 'Slower, tighter closing.', fault: 'Holes at finger tips = lower to 100.' },
      { key: 'pre_finger_speed', label: 'Speed before changing fingers', zh: '换指前速度', kind: 'number', typical: '120', what: 'Speed on the last rows before the carriage moves to the next finger.', up: 'Faster.', down: 'Slower.', fault: 'Loose or uneven finger joins = lower to 100.' },
      { key: 'yarn_change_speed', label: 'Speed of changing yarn', zh: '换纱速度', kind: 'number', typical: '80', what: 'Speed while a second yarn is brought in.', up: 'Faster change.', down: 'Safer change.', fault: 'Yarn breaks at a colour or elastic change = lower to 60.' },
      { key: 'knot_speed', label: 'Knotting speed', zh: '打结速度', kind: 'number', typical: '80', what: 'Speed while the knot is made.', up: 'Faster.', down: 'Surer knot.', fault: 'Knots open or missing = lower to 60.' },
      { key: 'idle_circles', label: 'Idling laps', zh: '空跑圈数', kind: 'number', typical: '5', what: 'Empty turns before knitting starts.', up: 'More empty turns.', down: 'Fewer.', fault: 'Leave.' },
      { key: 'crawl_speed', label: 'First-run speed', zh: '首行速度', kind: 'number', typical: '40', what: 'Slow speed for positioning and the first stitches.', up: 'Faster first row.', down: 'Slower first row.', fault: 'First row not catching = lower to 30.' },
      { key: 'elastic_speed', label: 'Speed of releasing elastic yarn', zh: '橡筋放线速度', kind: 'number', typical: '80', what: 'How fast the elastic is fed in the wrist.', up: 'More elastic fed = looser wrist.', down: 'Less elastic fed = tighter wrist.', fault: 'Wrist too tight = raise by 10. Wrist too loose = lower by 10.' },
      { key: 'elastic_after_wrist', label: 'Number of elastic yarn on the end of wrist', zh: '手腕最后橡筋数', kind: 'number', typical: '1', what: 'Extra rows knitted with elastic after the wrist.', up: 'More elastic rows.', down: 'Fewer.', fault: 'Leave.' },
      { key: 'elastic_after_cut', label: 'Elastic yarn final release value', zh: '橡筋最后放线', kind: 'number', typical: '20', what: 'Elastic let out after the cut so it does not snap back into the wrist.', up: 'Longer tail left.', down: 'Shorter tail.', fault: 'Elastic tail pulling back into the wrist = raise (your machines have 16, 20 and 25).' },
      { key: 'after_oil_speed', label: 'Speed after oiling', zh: '加油后速度', kind: 'number', typical: '100', what: 'Speed for a few turns right after self-oiling.', up: 'Faster after oiling.', down: 'Slower.', fault: 'Oil marks on gloves after oiling = lower.' },
      { key: 'after_oil_circles', label: 'Laps of slow running after oiling', zh: '加油后慢速圈数', kind: 'number', typical: '5', what: 'How many turns run at the "after oiling" speed.', up: 'More slow turns.', down: 'Fewer.', fault: 'Leave.' },
      { key: 'bnd_enable', label: 'Needle breakage detection function', zh: '断针检测功能', kind: 'onoff', typical: 'OFF', what: 'Whether the machine stops when it detects a broken needle.', up: 'ON = stops at a broken needle.', down: 'OFF = keeps knitting a line of holes until someone sees it.', fault: 'Gloves with a line of holes found late = turn ON and set the check interval to 1 or 2.' },
      { key: 'needles_front', label: 'Front needle quantity', zh: '前针板针数', kind: 'fixed', typical: '58', what: 'Needle count on the front plate. A machine fact.', up: 'Must equal the real plate.', down: 'Must equal the real plate.', fault: 'Wrong count = the finger widths are wrong.' },
      { key: 'needles_rear', label: 'Rear needle quantity', zh: '后针板针数', kind: 'fixed', typical: '58', what: 'Needle count on the rear plate.', up: 'Must equal the real plate.', down: 'Must equal the real plate.', fault: 'Same.' },
      { key: 'bnd_interval', label: 'Needle breakage detection interval', zh: '断针检测间隔', kind: 'number', typical: '0', what: 'How often the broken-needle check runs (in rows). Only matters when detection is ON.', up: 'Checks less often.', down: 'Checks more often (0 = every row).', fault: 'Set 1 or 2 when detection is ON.' },
      { key: 'stop_main_before_reset', label: 'Stop main yarn before resetting', zh: '复位前先停主纱', kind: 'onoff', typical: 'OFF', what: 'Whether the main yarn feed stops before the machine resets.', up: 'ON.', down: 'OFF.', fault: 'Leave OFF unless the main yarn tangles on reset.' },
      { key: 'three_finger_circles', label: 'Laps of three-finger conjoined palm', zh: '三指掌圈数', kind: 'number', typical: '0', what: 'Palm rows for three-finger gloves only.', up: 'More palm rows on three-finger gloves.', down: 'Fewer.', fault: '0 is correct for five-finger gloves.' },
      { key: 'press_depth_hot', label: 'Depth of pressing needle (hot melt)', zh: '压针深度(热熔)', kind: 'number', typical: '17', what: 'How far the needle presses down in the hot-melt wrist.', up: 'Stronger seal, more wear.', down: 'Weaker seal.', fault: 'Wrist seam not sealing = raise by 1. Needles bending or fabric marked = lower by 1.' },
      { key: 'press_depth_overlock', label: 'Depth of pressing needle (overlocking)', kind: 'number', typical: '0', what: 'How far the press needle goes down during the overlocking (yarn-end hiding) step. 0 = not used.', up: 'Presses deeper while overlocking.', down: 'Lighter / off.', fault: 'Yarn ends not held down after overlocking = try 10 to 15 (copy a machine that does it well).' },
      { key: 'wrist_travel', label: 'Distance of yarn fixing on palm', zh: '手掌无线头行程', kind: 'number', typical: '292', what: 'How far the carriage moves on the palm with no thread while the yarn end is fixed. The Chinese machine shows 292, the English one 0 (= default).', up: 'Longer travel.', down: 'Shorter.', fault: 'Leave unless the yarn end on the palm is fixed in the wrong place.' },
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
