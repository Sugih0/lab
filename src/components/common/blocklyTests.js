// Auto-check for Blockly robot steps. A step's tests are stored on its step
// document as `blocklyTests`: [{ name, scenario, match, expected }], and run in
// public/blocklyTestWorker.js, which documents the scenario and match fields.
// Each run gets its own worker, so a program stuck in a loop without a Wait
// block can be stopped.

const TIMEOUT_MS = 10000;

export const runBlocklyTests = (code, tests, noteFrequencies) =>
  new Promise((resolve) => {
    const worker = new Worker("/blocklyTestWorker.js");
    const failAll = (message) =>
      tests.map((test) => ({ name: test.name || "", passed: false, message, trace: null }));
    const finish = (results) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(results);
    };
    const timer = setTimeout(
      () => finish(failAll("Your program took too long to check. A loop may be running without a Wait block.")),
      TIMEOUT_MS
    );
    worker.onmessage = (e) => {
      if (e.data.type === "results") finish(e.data.results);
    };
    worker.onerror = (e) => finish(failAll(`The check couldn't run: ${e.message || "worker error"}`));
    worker.postMessage({ type: "run", id: 1, code, tests, noteFrequencies });
  });

const secs = (n) => `${Math.round(Number(n) * 100) / 100} s`;

// What a test does, for instructors: "Presses D22 at 1 s for 0.3 s · Ultrasonic
// reads 50 cm, then 15 cm at 2 s · Watches 10 s"
export const describeScenario = (scenario = {}) => {
  const parts = [];
  const presses = {};
  (scenario.buttons || []).forEach((p) => {
    const key = `${p.at}|${p.hold}`;
    (presses[key] = presses[key] || { at: p.at, hold: p.hold, buttons: [] }).buttons.push(p.button);
  });
  Object.values(presses)
    .sort((a, b) => a.at - b.at)
    .forEach((p) => parts.push(`Presses ${p.buttons.join(" + ")} at ${secs(p.at)} for ${secs(p.hold || 0)}`));
  const readings = (changes, key, unit, label) => {
    if (!changes || !changes.length) return;
    const sorted = [...changes].sort((a, b) => a.at - b.at);
    parts.push(
      `${label} reads ${sorted
        .map((c, i) => `${c[key]}${unit}${i === 0 && Number(c.at) === 0 ? "" : ` at ${secs(c.at)}`}`)
        .join(", then ")}`
    );
  };
  readings(scenario.distance, "cm", " cm", "Ultrasonic");
  readings(scenario.color, "color", "", "Colour sensor");
  if (scenario.random != null) {
    const r = Number(scenario.random);
    const pick = r === 0 ? "the lowest number" : r >= 0.99 ? "the highest number" : `a number ${Math.round(r * 100)}% of the way up`;
    parts.push(`Random blocks always pick ${pick}`);
  }
  parts.push(`Watches ${secs(scenario.duration || 20)}`);
  return parts.join(" · ");
};
