import React, { useState } from "react";
import { ListChecks, Save } from "lucide-react";

const EXAMPLE = `[
  {
    "name": "Presses D22",
    "scenario": {
      "duration": 5,
      "buttons": [{ "button": "D22", "at": 1, "hold": 0.3 }],
      "distance": [{ "at": 0, "cm": 50 }]
    },
    "match": { "ignoreCase": true }
  }
]`;

// Tests as the admin edits them: without the recorded expected results
const toText = (tests) =>
  tests.length ? JSON.stringify(tests.map(({ expected, ...test }) => test), null, 2) : "";

const describeRecording = (expected) => {
  if (!expected) return "not recorded";
  const count = (list, word) => `${(list || []).length} ${word}${(list || []).length === 1 ? "" : "s"}`;
  return `${count(expected.lcd, "screen")}, ${count(expected.tones, "sound")}, ${count(expected.motors, "motor change")}${
    expected.ended != null ? `, ends at ${expected.ended} s` : ""
  }`;
};

// Admin/trainer editor for a Blockly step's auto-check tests. The expected
// result of each test is recorded from the blocks on the canvas, so put a
// correct answer there before saving. See public/blocklyTestWorker.js for the
// scenario and match fields.
export const BlocklyTestEditor = ({ tests, onRecordAndSave, onCheckSavedAnswers, busy }) => {
  const [text, setText] = useState(() => toText(tests));
  const [status, setStatus] = useState(null); // { ok, message }
  const [answers, setAnswers] = useState(null);
  const [working, setWorking] = useState(false);

  const parse = () => {
    if (!text.trim()) return [];
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Tests must be a list: [ { ... }, ... ]");
    parsed.forEach((test, i) => {
      if (!test || typeof test !== "object" || !test.scenario) throw new Error(`Test ${i + 1} needs a "scenario".`);
    });
    return parsed;
  };

  const handleSave = async () => {
    setStatus(null);
    setAnswers(null);
    let parsed;
    try {
      parsed = parse();
    } catch (error) {
      setStatus({ ok: false, message: `The tests aren't valid JSON: ${error.message}` });
      return;
    }
    setWorking(true);
    try {
      const recorded = await onRecordAndSave(parsed);
      setText(toText(recorded));
      setStatus({
        ok: true,
        message: recorded.length
          ? `Saved ${recorded.length} test${recorded.length === 1 ? "" : "s"}, recorded from the blocks on the canvas.`
          : "Removed this step's tests. Submit sends it for review without a check.",
      });
    } catch (error) {
      setStatus({ ok: false, message: error.message });
    } finally {
      setWorking(false);
    }
  };

  const handleCheck = async () => {
    setStatus(null);
    setWorking(true);
    try {
      setAnswers(await onCheckSavedAnswers());
    } catch (error) {
      setStatus({ ok: false, message: error.message });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-300 bg-slate-50 p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-slate-800 text-sm">Auto-check tests (admin)</h3>
        <p className="text-xs text-slate-500 mt-1">
          Instructors can only pass this step when their program does what the tests expect. Each test lists the
          inputs to give (button presses, ultrasonic readings, how long to watch); its expected result is recorded
          from the blocks on the canvas, so put a correct answer there first. Leave empty for a step that is
          reviewed by hand.
        </p>
      </div>
      {tests.length > 0 && (
        <ul className="text-xs text-slate-600 space-y-0.5">
          {tests.map((test, i) => (
            <li key={`${test.name}-${i}`}>
              <span className="font-medium">{test.name || `Test ${i + 1}`}:</span> {describeRecording(test.expected)}
            </li>
          ))}
        </ul>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={EXAMPLE}
        spellCheck={false}
        className="w-full h-48 p-2 font-mono text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-400"
      />
      <div className="flex flex-wrap gap-2">
        <button
          onClick={handleSave}
          disabled={working || busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-semibold rounded-md transition-colors">
          <Save size={14} />
          Record from these blocks &amp; save
        </button>
        <button
          onClick={handleCheck}
          disabled={working || busy || tests.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-700 border border-slate-300 text-xs font-semibold rounded-md transition-colors">
          <ListChecks size={14} />
          Check approved answers
        </button>
      </div>
      {working && <p className="text-xs text-slate-500">Working...</p>}
      {status && (
        <p className={`text-xs ${status.ok ? "text-emerald-700" : "text-rose-700"}`}>{status.message}</p>
      )}
      {answers && (
        <ul className="space-y-1">
          {answers.length === 0 && <li className="text-xs text-slate-500">No saved answers to check yet.</li>}
          {answers.map((row) => (
            <li key={row.user} className="text-xs">
              <span className={row.passed ? "text-emerald-700" : row.passed === null ? "text-slate-500" : "text-rose-700 font-medium"}>
                {row.passed ? "✅" : row.passed === null ? "–" : "❌"} {row.user}
                {row.approved ? " (approved)" : ""}
              </span>
              {row.message && <span className="text-slate-600 whitespace-pre-wrap"> {row.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
