/* ============================================================
 * blocklyTestWorker.js — auto-check for Blockly robot steps
 * Runs a program's generated JavaScript against a simulated robot on a
 * virtual clock, records what it does (LCD screens, sounds, motor speeds,
 * printed text) and compares that with the step's expected result. A 30
 * second program is checked in a moment, and a program stuck in a loop
 * without a wait is stopped by the page terminating this worker.
 * ============================================================ */

const DEFAULT_DURATION = 20; // seconds of program time a test watches
const MAX_DURATION = 120;
const MAX_EVENTS = 5000; // recorded screens/sounds before a run is cut off
const MAX_STEPS = 500000; // clock advances before a run is cut off
// Shorter screens are flicker nobody can read: a clear and reprint in a loop
// leaves the LCD blank for a 50 ms clock tick or two
const MIN_SCREEN_TIME = 0.1;
const MIN_BLANK_TIME = 0.15;
const LCD_COLUMNS = 16;
const BLANK_ROW = ' '.repeat(LCD_COLUMNS);

// Lists print like the simulator's ['a',1] (see the Array.prototype.toString
// override in BlocklyRobotSimulator.js, active while a program runs)
// eslint-disable-next-line no-extend-native
Array.prototype.toString = function () {
    const items = this.map((item) => {
        if (typeof item === 'string') return `'${item}'`;
        if (item === null || item === undefined) return '';
        if (Array.isArray(item)) return item.toString();
        return String(item);
    });
    return `[${items.join(',')}]`;
};

// Lets the program's ready code run before the clock moves on. A macrotask
// runs only after every pending microtask, so all code that can run has run.
const nextTask = typeof setImmediate === 'function'
    ? () => new Promise((resolve) => setImmediate(resolve))
    : typeof MessageChannel === 'function'
        ? (() => {
            const channel = new MessageChannel();
            const waiting = [];
            channel.port1.onmessage = () => waiting.shift()();
            return () => new Promise((resolve) => {
                waiting.push(resolve);
                channel.port2.postMessage(null);
            });
        })()
        : () => new Promise((resolve) => setTimeout(resolve, 0));

const round = (t) => Math.round(t * 1000) / 1000;

// The simulator's wait() and playTone() check the clock every 50 ms, so a
// wait or sound lasts until the first check at or after its time: at least
// 0.05 s, and 0.125 s lasts 0.15 s
const TICK = 0.05;
const ticks = (seconds) => Math.max(TICK, Math.ceil((Number(seconds) || 0) / TICK - 1e-9) * TICK);

// Seeded Math.random, so random blocks pick the same numbers in every run
function seededRandom(seed) {
    let a = (Number(seed) || 1) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// The input that applies at time t from a list of { at, ...value } changes
function valueAt(changes, t, key, fallback) {
    let value = fallback;
    for (const change of changes || []) {
        if (Number(change.at) <= t + 1e-9) value = change[key];
    }
    return value;
}

// ── Running a program ────────────────────────────────────────

// Runs `code` with the robot functions the Run button gives it, against the
// inputs in `scenario`:
//   duration  seconds to watch (the program may end sooner)
//   buttons   [{ button: 'D22', at: 1, hold: 0.3 }]  pressed at `at` for `hold` s
//   distance  [{ at: 0, cm: 50 }]  ultrasonic reading from `at` on (default 100)
//   color     [{ at: 0, color: 'red' }]  colour sensor from `at` on (default none)
//   seed      for the Random blocks
//   random    a number from 0 to 1 every Random block uses instead (so the
//             result doesn't depend on the order a program draws them in)
// Returns the trace: { lcd, tones, motors, prints, error, ended, end, cutOff,
// pose }, pose being where the robot ended up (see advancePose)
async function runProgram(code, scenario = {}, noteFrequencies = {}) {
    const limit = Math.min(Number(scenario.duration) || DEFAULT_DURATION, MAX_DURATION);
    const trace = { lcd: [], tones: [], motors: [], prints: [], error: null, ended: null, end: limit, cutOff: null, pose: null };
    const isRunning = { current: true };
    let now = 0;
    let seq = 0;
    let events = 0;
    const timers = [];

    const sleep = (seconds) => new Promise((resolve, reject) => {
        timers.push({ at: now + Math.max(0, Number(seconds) || 0), seq: seq++, resolve, reject });
    });
    const count = () => {
        events += 1;
        if (events > MAX_EVENTS && !trace.cutOff) trace.cutOff = 'events';
    };

    // LCD: one 16-character string per row; a screen is recorded each time
    // what's shown changes, keeping only the last state of any moment
    const lcd = [BLANK_ROW.split(''), BLANK_ROW.split('')];
    const recordScreen = () => {
        if (!isRunning.current) return;
        const rows = lcd.map((row) => row.join(''));
        const screens = trace.lcd;
        const last = screens[screens.length - 1];
        const t = round(now);
        if (last && last.t === t) {
            last.rows = rows;
            const before = screens[screens.length - 2];
            const shownBefore = before ? before.rows : [BLANK_ROW, BLANK_ROW];
            if (shownBefore[0] === rows[0] && shownBefore[1] === rows[1]) screens.pop();
            return;
        }
        const shown = last ? last.rows : [BLANK_ROW, BLANK_ROW];
        if (shown[0] === rows[0] && shown[1] === rows[1]) return;
        screens.push({ t, rows });
        count();
    };

    // Motors, and where they take the robot: the simulator's model (see its
    // physics loop) at 60 frames a second. Per frame it turns 0.02 * (left -
    // right) degrees clockwise, then moves (left + right) / 2 * 0.018 px.
    // A stopped wheel gets 0.001 when the other runs, as in the simulator.
    let speeds = { left: 0, right: 0 };
    const pose = { x: 0, y: 0, heading: 0, turned: 0, t: 0 };
    const advancePose = (toTime) => {
        const frames = Math.round((toTime - pose.t) * 60);
        pose.t = toTime;
        if (frames <= 0 || (speeds.left === 0 && speeds.right === 0)) return;
        const nudge = (speed, other) => (speed === 0 && other !== 0 ? 0.001 : speed);
        const left = nudge(speeds.left, speeds.right);
        const right = nudge(speeds.right, speeds.left);
        for (let i = 0; i < frames; i++) {
            pose.heading += 0.02 * (left - right);
            pose.turned += 0.02 * (left - right);
            const rad = (pose.heading * Math.PI) / 180;
            const dist = ((left + right) / 2) * 0.03 * 3 * 0.2;
            pose.x += Math.cos(rad) * dist;
            pose.y += Math.sin(rad) * dist;
        }
    };
    // Speeds recorded like screens: only the last setting of a moment counts
    const setSpeeds = (left, right) => {
        if (!isRunning.current || (speeds.left === left && speeds.right === right)) return;
        advancePose(now);
        speeds = { left, right };
        const t = round(now);
        const last = trace.motors[trace.motors.length - 1];
        if (last && last.t === t) {
            const before = trace.motors[trace.motors.length - 2] || { left: 0, right: 0 };
            if (before.left === left && before.right === right) trace.motors.pop();
            else Object.assign(last, { left, right });
            return;
        }
        trace.motors.push({ t, left, right });
        count();
    };

    // Buzzer: every sound with when it started and how long it was heard
    const playing = [];
    let buzzerLoopId = 0;
    const endTone = (tone) => {
        const index = playing.indexOf(tone);
        if (index > -1) playing.splice(index, 1);
        tone.dur = round(Math.min(tone.dur, now - tone.t));
    };

    const wait = async (seconds) => {
        if (!isRunning.current) throw new Error('Simulation stopped');
        await sleep(ticks(seconds));
        if (!isRunning.current) throw new Error('Simulation stopped');
    };
    const moveIndefinitely = (left, right) => {
        if (!isRunning.current) return;
        const clamp = (speed) => Math.max(-100, Math.min(100, Number(speed) || 0));
        setSpeeds(clamp(left), clamp(right));
    };
    const stopMoving = () => setSpeeds(0, 0);
    const move = async (left, right, seconds) => {
        if (!isRunning.current) return;
        moveIndefinitely(left, right);
        try {
            await wait(seconds);
        } finally {
            stopMoving();
        }
    };
    const isButtonPressed = (button) => (scenario.buttons || []).some((press) =>
        press.button === button &&
        now >= Number(press.at) - 1e-9 &&
        now < Number(press.at) + (Number(press.hold) || 0) - 1e-9
    );
    const waitUntilButton = async (button, state) => {
        if (!isRunning.current) return;
        const pressed = state === 'PRESSED';
        while (isButtonPressed(button) !== pressed) {
            if (!isRunning.current) throw new Error('Simulation stopped');
            await wait(0.01);
        }
    };
    let timerStart = 0;
    const gyroOffset = { X: 0, Y: 0, Z: 0 };
    // As in the simulator: text from column 16 on is off the screen
    const lcdPrint = (row, col, text) => {
        const r = Math.max(0, Math.min(1, Math.round(row)));
        let c = Math.max(0, Math.round(col));
        const str = String(text);
        for (let i = 0; i < str.length && c < LCD_COLUMNS; i++, c++) {
            lcd[r][c] = str[i];
        }
        recordScreen();
    };
    const lcdClear = () => {
        lcd.forEach((row) => row.fill(' '));
        recordScreen();
    };
    const playTone = (freq, sec, vol = 100) => {
        if (!isRunning.current) return Promise.resolve();
        const tone = { t: round(now), freq: Number(freq) || 0, dur: ticks(sec), vol: Number(vol) };
        trace.tones.push(tone);
        playing.push(tone);
        count();
        return sleep(tone.dur).then(() => endTone(tone));
    };
    const stopAllTones = () => {
        buzzerLoopId += 1;
        [...playing].forEach(endTone);
    };
    const playBuzzer = (freq, sec, playType = 'WAIT', vol = 100) => {
        if (playType === 'LOOP') {
            stopAllTones(); // One buzzer: a new loop replaces whatever is playing
            const loopId = buzzerLoopId;
            (async () => {
                while (isRunning.current && buzzerLoopId === loopId) {
                    await playTone(freq, sec, vol);
                    if (buzzerLoopId !== loopId) break;
                    await wait(sec);
                }
            })().catch(() => {});
            return Promise.resolve();
        }
        const tone = playTone(freq, sec, vol);
        if (playType === 'ONCE') {
            tone.catch(() => {}); // Nobody awaits it, so swallow "Simulation stopped"
            return Promise.resolve();
        }
        return tone;
    };

    const scope = {
        move,
        moveIndefinitely,
        stopMoving,
        wait,
        getUltrasonicDistance: () => Number(valueAt(scenario.distance, now, 'cm', 100)),
        getColorSensor: () => valueAt(scenario.color, now, 'color', 'none'),
        getReflectedLightIntensity: () => 0,
        getAmbientLightIntensity: () => 0,
        isButtonPressed,
        getGyroAngle: (axis) => 0 - (gyroOffset[axis] || 0),
        resetGyro: () => {},
        getTimerValue: () => now - timerStart,
        resetTimer: () => { timerStart = now; },
        lcdPrint,
        lcdClear,
        lcdPrintForDuration: async (row, col, text, seconds) => {
            lcdPrint(row, col, text);
            await wait(seconds);
            lcdClear();
            await sleep(0); // the simulator waits for a paint here
        },
        playTone,
        playBuzzer,
        playNote: (note, sec, playType, vol) =>
            playBuzzer(noteFrequencies[String(note).toUpperCase()] || 440, sec, playType, vol),
        stopAllTones,
        waitUntilButton,
        logToConsole: (msg) => {
            if (!isRunning.current) return;
            trace.prints.push({ t: round(now), text: String(msg) });
            count();
        },
        isRunning,
    };

    const originalRandom = Math.random;
    const fixed = Number(scenario.random);
    Math.random = scenario.random != null && fixed >= 0 && fixed < 1 ? () => fixed : seededRandom(scenario.seed);
    let finished = false;
    try {
        let program;
        try {
            // eslint-disable-next-line no-new-func
            program = new Function(...Object.keys(scope), `return (async () => {\n${code}\n})();`)(...Object.values(scope));
        } catch (err) {
            trace.error = { t: 0, message: err.message || String(err) };
            return trace;
        }
        program.then(
            () => { finished = true; },
            (err) => {
                finished = true;
                if (err && err.message !== 'Simulation stopped') {
                    trace.error = { t: round(now), message: err.message || String(err) };
                }
            }
        );
        await nextTask();
        let steps = 0;
        while (!finished && !trace.cutOff) {
            if (timers.length === 0) break; // waiting for something that can't happen
            timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
            if (timers[0].at > limit + 1e-9) break;
            const timer = timers.shift();
            now = timer.at;
            timer.resolve();
            await nextTask();
            steps += 1;
            if (steps > MAX_STEPS) trace.cutOff = 'steps';
        }
        if (finished) {
            trace.ended = round(now);
            trace.end = round(now);
        } else {
            now = limit;
        }
        // Whatever still plays stops with the program, as in the simulator
        [...playing].forEach(endTone);
        advancePose(trace.end);
        trace.pose = {
            x: round(pose.x), y: round(pose.y),
            heading: round(pose.heading), turned: round(pose.turned),
        };
    } finally {
        isRunning.current = false;
        timers.forEach((timer) => timer.reject(new Error('Simulation stopped')));
        Math.random = originalRandom;
    }
    return trace;
}

// ── Comparing with the expected result ───────────────────────

// Screens shown for less than MIN_SCREEN_TIME are dropped (a clear just
// before printing the same text again), then repeats are merged. The last
// screen of a program that ended stays on the LCD.
function visibleScreens(trace) {
    const screens = trace.lcd || [];
    const kept = [];
    screens.forEach((screen, i) => {
        const until = i + 1 < screens.length ? screens[i + 1].t : trace.ended != null ? Infinity : trace.end;
        const shortest = screen.rows[0] === BLANK_ROW && screen.rows[1] === BLANK_ROW ? MIN_BLANK_TIME : MIN_SCREEN_TIME;
        if (until - screen.t < shortest - 1e-9) return;
        const last = kept[kept.length - 1];
        if (last && last.rows[0] === screen.rows[0] && last.rows[1] === screen.rows[1]) return;
        kept.push(screen);
    });
    // A screen that only shows the blank LCD it started with isn't a change
    if (kept.length && kept[0].rows[0] === BLANK_ROW && kept[0].rows[1] === BLANK_ROW) kept.shift();
    return kept;
}

const fmt = (t) => `${(Math.round(t * 100) / 100).toFixed(2)} s`;
const showScreen = (rows) => {
    const [top, bottom] = rows.map((row) => row.replace(/\s+$/, ''));
    if (!top && !bottom) return 'a blank screen';
    return bottom ? `"${top}" on top and "${bottom}" below` : `"${top}"`;
};
const showTone = (tone, sound) => sound === 'count'
    ? 'a sound'
    : sound === 'any'
        ? `a ${tone.dur} s sound`
        : `a ${Math.round(tone.freq * 100) / 100} Hz sound for ${tone.dur} s`;

const isBlank = (rows) => rows[0] === BLANK_ROW && rows[1] === BLANK_ROW;
const screenKey = (rows, match) => {
    // place 'any': where the text sits on its row doesn't matter
    const placed = match.place === 'any' ? rows.map((row) => row.trim()) : rows;
    // rowsAnyOrder: a random row doesn't matter, only what each row shows
    const key = (match.rowsAnyOrder ? [...placed].sort() : placed).join('\n');
    return match.ignoreCase ? key.toLowerCase() : key;
};

// The screens to compare under the step's match rules
function screensToCompare(trace, match) {
    // Screens the rules make the same (e.g. "Walk" then "walk") are one
    let screens = visibleScreens(trace)
        .filter((s, i, list) => i === 0 || screenKey(s.rows, match) !== screenKey(list[i - 1].rows, match));
    // A blank LCD (a pause, or clearing before a beep) isn't a change
    if (match.ignoreBlank) {
        screens = screens.filter((s) => !isBlank(s.rows))
            .filter((s, i, list) => i === 0 || screenKey(s.rows, match) !== screenKey(list[i - 1].rows, match));
    }
    // "The program ends": whether its last message is cleared doesn't matter
    if (match.final === 'any' && trace.ended != null && screens.length) {
        const last = screens[screens.length - 1];
        if (last.rows[0] === BLANK_ROW && last.rows[1] === BLANK_ROW) screens = screens.slice(0, -1);
    }
    // Each different screen once, in the order it first appeared: for an
    // animation whose speed is up to the instructor
    if (match.timing === 'appearance' || match.timing === 'set') {
        const seen = new Set();
        screens = screens.filter((s) => {
            const key = screenKey(s.rows, match);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    return screens;
}

// match:
//   timing      'strict' (default): when things happen counts, within tolerance;
//               'order': only what happens, in what order;
//               'appearance': each different screen, in the order it first shows;
//               'set': each different screen, in any order
//   tolerance   seconds a time may be off (default 0.15 + 2% of the time)
//   ignoreCase  compare LCD text without letter case
//   ignoreBlank a blank LCD isn't a change
//   text        'any': the wording is the instructor's, but each different
//               expected message needs its own message (e.g. "Open Gate A")
//   sound       'exact' (default) | 'any' (any pitch) | 'count' (only how many
//               sounds and when) | 'ignore'
//   final       'any': a program that ends may clear its last message or not
//   rowsAnyOrder a screen may show its rows the other way round (random rows)
//   place       'any': the text may sit anywhere on its row
//   lcd, motors 'ignore': leave the LCD / motor speeds out (checks can test
//               them instead)
//   trace       false: don't compare with the expected result at all, only
//               run the test's checks (see runChecks)
function compareTraces(expected, actual, match = {}) {
    const timing = ['order', 'appearance', 'set'].includes(match.timing) ? 'order' : 'strict';
    const tolerance = (t) => (match.tolerance != null ? Number(match.tolerance) : 0.15 + 0.02 * t);
    const timeOk = (e, a) => timing === 'order' || Math.abs(e - a) <= tolerance(e) + 1e-9;
    const sameText = (a, b) => (match.ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b);
    // With text 'any', expected and actual messages pair up one to one
    const toActual = new Map();
    const toExpected = new Map();
    const sameScreen = (e, a) => {
        if (match.text !== 'any') return screenKey(e, match) === screenKey(a, match);
        if (isBlank(e) || isBlank(a)) return isBlank(e) && isBlank(a);
        const ek = screenKey(e, match);
        const ak = screenKey(a, match);
        if (toActual.has(ek) || toExpected.has(ak)) return toActual.get(ek) === ak;
        toActual.set(ek, ak);
        toExpected.set(ak, ek);
        return true;
    };
    const like = (rows) => (match.text === 'any' && !isBlank(rows) ? 'a message like ' : '');

    const problem = programProblem(actual);
    if (problem) return problem;

    // LCD
    const exp = match.lcd === 'ignore' ? [] : screensToCompare(expected, match);
    const act = match.lcd === 'ignore' ? [] : screensToCompare(actual, match);
    if (match.timing === 'set') {
        const missing = exp.find((e) => !act.some((a) => sameScreen(e.rows, a.rows)));
        if (missing) return { passed: false, message: `The LCD should show ${like(missing.rows)}${showScreen(missing.rows)} at some point, but it never did.` };
        const extra = act.find((a) => !exp.some((e) => sameScreen(e.rows, a.rows)));
        if (extra) return { passed: false, message: `The LCD showed ${showScreen(extra.rows)}, which isn't expected.` };
    }
    for (let i = 0; match.timing !== 'set' && i < Math.max(exp.length, act.length); i++) {
        const e = exp[i];
        const a = act[i];
        if (!a) {
            return { passed: false, message: `The LCD should then show ${like(e.rows)}${showScreen(e.rows)}${timing === 'strict' ? ` at ${fmt(e.t)}` : ''}, but it didn't change.` };
        }
        if (!e) {
            return { passed: false, message: `At ${fmt(a.t)} the LCD changed to ${showScreen(a.rows)}, which isn't expected.` };
        }
        if (!sameScreen(e.rows, a.rows)) {
            return { passed: false, message: `${timing === 'strict' ? `At ${fmt(a.t)} t` : 'T'}he LCD should show ${like(e.rows)}${showScreen(e.rows)}, but it showed ${showScreen(a.rows)}.` };
        }
        if (!timeOk(e.t, a.t)) {
            return { passed: false, message: `The LCD showed ${showScreen(a.rows)} at ${fmt(a.t)}, but it should show it at ${fmt(e.t)}.` };
        }
    }

    // Sounds
    if (match.sound !== 'ignore') {
        const et = expected.tones || [];
        const at = actual.tones || [];
        for (let i = 0; i < Math.max(et.length, at.length); i++) {
            const e = et[i];
            const a = at[i];
            if (!a) return { passed: false, message: `Your program played ${at.length} sound${at.length === 1 ? '' : 's'}; it should play ${et.length}. Next it should play ${showTone(e, match.sound)}${timing === 'strict' ? ` at ${fmt(e.t)}` : ''}.` };
            if (!e) return { passed: false, message: `Your program played ${at.length} sounds; it should play ${et.length}. The extra one is ${showTone(a, match.sound)} at ${fmt(a.t)}.` };
            const pitchOk = match.sound === 'any' || match.sound === 'count' || Math.abs(e.freq - a.freq) <= Math.max(1, e.freq * 0.01);
            const lengthOk = timing === 'order' || match.sound === 'count' || Math.abs(e.dur - a.dur) <= Math.max(0.02, e.dur * 0.1) + 1e-9;
            if (!pitchOk || !lengthOk) {
                return { passed: false, message: `Sound ${i + 1} should be ${showTone(e, match.sound)}, but yours was ${showTone(a, match.sound)}.` };
            }
            if (!timeOk(e.t, a.t)) {
                return { passed: false, message: `Sound ${i + 1} started at ${fmt(a.t)}, but it should start at ${fmt(e.t)}.` };
            }
        }
    }

    // Motors
    const em = match.motors === 'ignore' ? [] : expected.motors || [];
    const am = match.motors === 'ignore' ? [] : actual.motors || [];
    for (let i = 0; i < Math.max(em.length, am.length); i++) {
        const e = em[i];
        const a = am[i];
        if (!a) return { passed: false, message: `The motors should then run at ${e.left} / ${e.right}${timing === 'strict' ? ` at ${fmt(e.t)}` : ''}, but they didn't change.` };
        if (!e) return { passed: false, message: `At ${fmt(a.t)} the motors changed to ${a.left} / ${a.right}, which isn't expected.` };
        if (e.left !== a.left || e.right !== a.right) return { passed: false, message: `The motors should run at ${e.left} / ${e.right}, but they ran at ${a.left} / ${a.right}.` };
        if (!timeOk(e.t, a.t)) return { passed: false, message: `The motors changed to ${a.left} / ${a.right} at ${fmt(a.t)}, but they should at ${fmt(e.t)}.` };
    }

    // Printed text
    const ep = expected.prints || [];
    const ap = actual.prints || [];
    for (let i = 0; i < Math.max(ep.length, ap.length); i++) {
        const e = ep[i];
        const a = ap[i];
        if (!a) return { passed: false, message: `Your program should then print "${e.text}".` };
        if (!e) return { passed: false, message: `Your program printed "${a.text}", which isn't expected.` };
        if (!sameText(e.text, a.text)) return { passed: false, message: `Your program should print "${e.text}", but it printed "${a.text}".` };
        if (!timeOk(e.t, a.t)) return { passed: false, message: `Your program printed "${a.text}" at ${fmt(a.t)}, but it should at ${fmt(e.t)}.` };
    }

    return { passed: true, message: '' };
}

// A program that crashed or ran away fails whatever it was meant to do
function programProblem(trace) {
    if (trace.error) {
        return { passed: false, message: `Your program stopped with an error at ${fmt(trace.error.t)}: ${trace.error.message}` };
    }
    if (trace.cutOff) {
        return { passed: false, message: 'Your program did too many things to check (a loop may be running too fast without a wait).' };
    }
    return null;
}

// ── Checks: requirements a trace must meet, for steps where the instructor
// chooses the path, buttons, speeds or random values ─────────────

// What the motors make the robot do, from the simulator's model: a wheel
// difference turns it, the average moves it
function motionClass(left, right) {
    if (Math.abs(left) < 0.5 && Math.abs(right) < 0.5) return 'stop';
    if (left > 0 && right < 0) return 'spin-right';
    if (left < 0 && right > 0) return 'spin-left';
    const straight = Math.abs(left - right) <= 0.1 * Math.max(Math.abs(left), Math.abs(right));
    if ((left + right) / 2 > 0) return straight ? 'forward' : left > right ? 'right' : 'left';
    return straight ? 'backward' : left > right ? 'back-right' : 'back-left';
}
const MOTION_GROUPS = {
    'left-turn': ['left', 'spin-left'],
    'right-turn': ['right', 'spin-right'],
    reversing: ['backward', 'back-left', 'back-right'],
    turning: ['left', 'right', 'spin-left', 'spin-right', 'back-left', 'back-right'],
    moving: ['forward', 'backward', 'left', 'right', 'spin-left', 'spin-right', 'back-left', 'back-right'],
    'not-forward': ['stop', 'backward', 'left', 'right', 'spin-left', 'spin-right', 'back-left', 'back-right'],
};
const MOTION_WORDS = {
    forward: 'go forward', backward: 'reverse', left: 'turn left', right: 'turn right',
    'spin-left': 'spin left', 'spin-right': 'spin right', 'back-left': 'reverse to the left',
    'back-right': 'reverse to the right', stop: 'stop', 'left-turn': 'turn left', 'right-turn': 'turn right',
    reversing: 'reverse', turning: 'turn', moving: 'move', 'not-forward': 'stop going straight ahead',
};
const MOTION_DOING = {
    forward: 'was going forward', backward: 'was reversing', left: 'was turning left', right: 'was turning right',
    'spin-left': 'was spinning left', 'spin-right': 'was spinning right', 'back-left': 'was reversing to the left',
    'back-right': 'was reversing to the right', stop: 'had stopped',
};
const expandMotion = (names) => [].concat(names).flatMap((name) => MOTION_GROUPS[name] || [name]);
const describeMotion = (names) => [].concat(names).map((name) => MOTION_WORDS[name] || name).join(' or ');
// Motor speeds over time without blips: a state held for no more than a
// clock tick (a stop between two Motor-on-for-second blocks in a loop) is
// jerky driving, not a stop
const steadyMotors = (trace) => {
    const motors = trace.motors || [];
    const blip = (m, i) => m.left === 0 && m.right === 0 && i < motors.length - 1 && motors[i + 1].t - m.t <= TICK + 0.01;
    return motors
        .filter((m, i) => !blip(m, i))
        .filter((m, i, kept) => i === 0 || m.left !== kept[i - 1].left || m.right !== kept[i - 1].right);
};
const speedsAt = (motors, t) => {
    let speeds = { left: 0, right: 0 };
    motors.forEach((m) => { if (m.t <= t + 1e-9) speeds = m; });
    return speeds;
};
const screenAt = (trace, t) => {
    let rows = [BLANK_ROW, BLANK_ROW];
    (trace.lcd || []).forEach((s) => { if (s.t <= t + 1e-9) rows = s.rows; });
    return rows;
};
const lead = (label) => (label ? `${label[0].toUpperCase()}${label.slice(1)}, t` : 'T');
// When screen i is replaced; the last screen of a program that ended stays
const shownUntil = (trace, i) => {
    const screens = trace.lcd || [];
    if (i + 1 < screens.length) return screens[i + 1].t;
    return trace.ended != null ? Infinity : trace.end;
};

// checks, each { type, ..., label?, message? } (message replaces the default):
//   code     { pattern, min = 1, max }: how many times the program's code
//            matches a regular expression (e.g. Comment blocks, functions)
//   motion   { from, to, is, speed? }: what the robot does all through a time
//            window (forward, backward, left, right, spin-left, spin-right,
//            back-left, back-right, stop, or a group: left-turn, right-turn,
//            reversing, turning, moving, not-forward); speed: its forward speed
//   motion   { windows: [{ from, to }, ...], includes }: across those windows
//            the robot does each of `includes` at least once (e.g. one button
//            turns left and another right, whichever they are)
//   pose     { turned: [min, max], facing: [min, max], within }: where the
//            robot ends up: degrees turned in all, degrees from its starting
//            direction (0 to 180), px from its starting point
//   lcdRows  { from, to, rows: [regexTop, regexBottom], flags }: every screen
//            shown in the window matches
//   lcdCount { at, char, min, max }: how many times a character is on the LCD
//   lcdShows { from, to, pattern, flags }: some screen shown in the window
//            matches (its two rows joined by a line break)
//   sound    { from, to, min = 1, max }: how many sounds start in the window
//   lcdChanges { from, to, min = 1, max }: how many times the LCD changes in
//            the window (an animation, or a screen that should stay still)
//   quiz    { yes, no, right, wrong, within = 1.5, mixed, question }: a quiz
//            round for each press of the yes / no button in the scenario. Just
//            before the press the LCD shows a sum like 3x4=12 (question: a
//            regex for number, operator, number, answer); within `within` s
//            after it, the LCD shows `right` if the player was right, else
//            `wrong` (words, any case). mixed: the questions shown must
//            include both correct and wrong answers. at: only the presses at
//            these times are answers (the button may do other things too)
const QUIZ_QUESTION = '(-?\\d+)\\s*([-+xX*×])\\s*(-?\\d+)\\s*=\\s*(-?\\d+)';
const QUIZ_OPS = { '+': (a, b) => a + b, '-': (a, b) => a - b, x: (a, b) => a * b, X: (a, b) => a * b, '*': (a, b) => a * b, '×': (a, b) => a * b };
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function runChecks(checks, trace, code, scenario = {}) {
    const fail = (check, message) => ({ passed: false, message: check.message || message });
    const motors = steadyMotors(trace);
    for (const check of checks || []) {
        if (check.type === 'code') {
            const count = (code.match(new RegExp(check.pattern, 'gm')) || []).length;
            const min = check.min != null ? check.min : 1;
            if (count < min || (check.max != null && count > check.max)) {
                return fail(check, `Your blocks don't match what this step asks for (${check.pattern}).`);
            }
        } else if (check.type === 'motion' && check.windows) {
            const seen = new Set();
            check.windows.forEach(({ from, to }) => {
                for (let t = from; t <= to + 1e-9; t += 0.05) {
                    const s = speedsAt(motors, t);
                    seen.add(motionClass(s.left, s.right));
                }
            });
            const missing = [].concat(check.includes).find((name) => !expandMotion(name).some((c) => seen.has(c)));
            if (missing) {
                return fail(check, `${lead(check.label)}he robot should ${describeMotion(missing)} at some point, but it never did.`);
            }
        } else if (check.type === 'motion') {
            const allowed = expandMotion(check.is);
            for (let t = check.from; t <= check.to + 1e-9; t += 0.05) {
                const s = speedsAt(motors, t);
                const cls = motionClass(s.left, s.right);
                const speedOk = check.speed == null || Math.abs((s.left + s.right) / 2 - check.speed) <= 1;
                if (!allowed.includes(cls) || !speedOk) {
                    const want = `${describeMotion(check.is)}${check.speed != null ? ` at speed ${check.speed}` : ''}`;
                    return fail(check, `${lead(check.label)}he robot should ${want}, but at ${fmt(t)} it ${MOTION_DOING[cls]} (motors ${s.left} / ${s.right}).`);
                }
            }
        } else if (check.type === 'pose') {
            const p = trace.pose || { x: 0, y: 0, heading: 0, turned: 0 };
            const turned = Math.abs(p.turned);
            const h = ((p.heading % 360) + 360) % 360;
            const facing = h > 180 ? 360 - h : h;
            const away = Math.hypot(p.x, p.y);
            if (check.turned && (turned < check.turned[0] || turned > check.turned[1])) {
                return fail(check, `${lead(check.label)}he robot should turn ${check.turned[0]}° to ${check.turned[1]}° in all, but it turned ${Math.round(turned)}°.`);
            }
            if (check.facing && (facing < check.facing[0] || facing > check.facing[1])) {
                return fail(check, `${lead(check.label)}he robot should end up facing ${check.facing[0]}° to ${check.facing[1]}° from where it started, but it faced ${Math.round(facing)}°.`);
            }
            if (check.within != null && away > check.within) {
                return fail(check, `${lead(check.label)}he robot should end up back near where it started, but it ended ${Math.round(away)} px away.`);
            }
        } else if (check.type === 'lcdRows') {
            const patterns = check.rows.map((r) => new RegExp(r, check.flags || ''));
            const screens = trace.lcd || [];
            for (let i = 0; i < screens.length; i++) {
                const s = screens[i];
                const until = shownUntil(trace, i);
                if (until < (check.from || 0) || s.t > (check.to != null ? check.to : trace.end)) continue;
                if (until - s.t < MIN_SCREEN_TIME - 1e-9) continue;
                if (!patterns.every((p, r) => p.test(s.rows[r]))) {
                    return fail(check, `At ${fmt(s.t)} the LCD showed ${showScreen(s.rows)}, which doesn't fit this step.`);
                }
            }
        } else if (check.type === 'lcdCount') {
            const rows = screenAt(trace, check.at);
            const count = rows.join('').split(check.char).length - 1;
            if (count < (check.min || 0) || (check.max != null && count > check.max)) {
                return fail(check, `At ${fmt(check.at)} the LCD should show ${check.max != null ? `${check.min || 0} to ${check.max}` : `at least ${check.min}`} "${check.char}", but it showed ${count}.`);
            }
        } else if (check.type === 'lcdShows') {
            const pattern = new RegExp(check.pattern, check.flags || '');
            const from = check.from || 0;
            const to = check.to != null ? check.to : trace.end;
            const screens = trace.lcd || [];
            const shown = screens.some((s, i) => {
                const until = shownUntil(trace, i);
                return until >= from && s.t <= to && pattern.test(s.rows.join('\n'));
            });
            if (!shown) {
                return fail(check, `${lead(check.label)}he LCD never showed what this step asks for (${check.pattern}).`);
            }
        } else if (check.type === 'lcdChanges') {
            const from = check.from || 0;
            const to = check.to != null ? check.to : trace.end;
            const count = visibleScreens(trace).filter((s) => s.t > from + 1e-9 && s.t <= to + 1e-9).length;
            const min = check.min != null ? check.min : check.max != null ? 0 : 1;
            if (count < min) {
                return fail(check, `${lead(check.label)}he LCD should keep changing, but it changed ${count === 0 ? 'no times' : count === 1 ? 'only once' : `only ${count} times`}.`);
            }
            if (check.max != null && count > check.max) {
                return fail(check, `${lead(check.label)}he LCD should ${check.max === 0 ? 'stay the same' : `change at most ${check.max} times`}, but it changed ${count} times.`);
            }
        } else if (check.type === 'quiz') {
            const question = new RegExp(check.question || QUIZ_QUESTION);
            const word = { right: new RegExp(escapeRegExp(check.right), 'i'), wrong: new RegExp(escapeRegExp(check.wrong), 'i') };
            const within = check.within != null ? check.within : 1.5;
            const screens = visibleScreens(trace);
            const answers = new Set();
            const presses = (scenario.buttons || []).filter((p) => (p.button === check.yes || p.button === check.no)
                && (!check.at || check.at.some((t) => Math.abs(t - p.at) < 1e-6)));
            for (const press of presses) {
                const before = screens.filter((s) => s.t < press.at - 1e-9).pop();
                const asked = before && before.rows.join('\n').match(question);
                if (!asked) {
                    return fail(check, `Just before ${press.button} was pressed at ${fmt(press.at)}, the LCD should show a question, but it showed ${before ? showScreen(before.rows) : 'a blank screen'}.`);
                }
                const [a, op, b, answer] = asked.slice(1);
                const correct = QUIZ_OPS[op](Number(a), Number(b)) === Number(answer);
                answers.add(correct);
                const want = correct === (press.button === check.yes) ? 'right' : 'wrong';
                const other = want === 'right' ? 'wrong' : 'right';
                const after = screens.filter((s) => s.t >= press.at - 1e-9 && s.t <= press.at + within + 1e-9).map((s) => s.rows.join('\n'));
                if (!after.some((rows) => word[want].test(rows)) || after.some((rows) => word[other].test(rows))) {
                    const sum = `${a}${op}${b}=${answer}`;
                    return fail(check, `${sum} is ${correct ? 'correct' : 'not correct'}, so pressing ${press.button} at ${fmt(press.at)} should show "${check[want]}", but it didn't.`);
                }
            }
            if (check.mixed && answers.size < 2) {
                return fail(check, `The questions should sometimes show the correct answer and sometimes a wrong one, but every one was ${answers.has(true) ? 'correct' : 'wrong'}.`);
            }
        } else if (check.type === 'sound') {
            const from = check.from || 0;
            const to = check.to != null ? check.to : trace.end;
            const count = (trace.tones || []).filter((tone) => tone.t >= from - 1e-9 && tone.t <= to + 1e-9).length;
            const min = check.min != null ? check.min : 1;
            if (count < min) {
                return fail(check, `${lead(check.label)}here should be a sound, but your program was silent.`);
            }
            if (check.max != null && count > check.max) {
                return fail(check, `${lead(check.label)}here should be ${check.max === 0 ? 'no sound' : `at most ${check.max} sounds`}, but your program played ${count}.`);
            }
        }
    }
    return { passed: true, message: '' };
}

// Runs every test. A test without an expected result only records the trace,
// unless it is checked by its checks alone (match.trace false).
async function runTests(code, tests, noteFrequencies) {
    const results = [];
    for (const test of tests || []) {
        const match = test.match || {};
        const trace = await runProgram(code, test.scenario || {}, noteFrequencies);
        let verdict;
        if (match.trace === false) {
            verdict = programProblem(trace) || runChecks(test.checks, trace, code, test.scenario);
        } else if (test.expected) {
            verdict = compareTraces(test.expected, trace, match);
            if (verdict.passed) verdict = runChecks(test.checks, trace, code, test.scenario);
        } else {
            verdict = { passed: null, message: '' };
        }
        results.push({ name: test.name || '', passed: verdict.passed, message: verdict.message, trace });
    }
    return results;
}

// ── Message handler ──────────────────────────────────────────

self.onmessage = async (e) => {
    const msg = e.data;
    if (msg.type === 'run') {
        const results = await runTests(msg.code || '', msg.tests || [], msg.noteFrequencies || {});
        self.postMessage({ type: 'results', id: msg.id, results });
    }
};
