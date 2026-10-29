// The demo level: one challenge with two steps, shaped like the challenges
// PortalLevelRunner builds from Firestore in the Training Manager site.
//  Step 1 asks for blocks and is auto-checked (see public/blocklyTestWorker.js).
//  Step 2 says "Create a flowchart of the previous step", which turns the
//  canvas into the flowchart editor, checked against Step 1's blocks.

export const LEVEL_ID = "demo-basic-level";
export const LEVEL_NAME = "Demo Basic Level";
export const UNIT_ID = "unit-1";
export const UNIT_NAME = "Unit 1 - Getting Started";
export const CHALLENGE_ID = "beep-and-display";
export const CHALLENGE_NAME = "Beep and Display";

export const demoChallenges = [
  {
    id: `${CHALLENGE_ID}_step_0`,
    challengeName: `${CHALLENGE_NAME} - Step 1`,
    description: `
      <h3><b>Question 1: Build the program with blocks</b></h3>
      <p>Make the robot beep <b>3 times</b> and then show <b>Done</b> on the LCD.</p>
      <ol>
        <li>Use a <b>Repeat</b> block (Loops) set to <b>3</b> times.</li>
        <li>Inside the loop, play a note with a <b>Buzzer</b> block, then <b>Wait</b> 0.5 seconds.</li>
        <li>After the loop, use an <b>LCD</b> block to display <b>Done</b>.</li>
      </ol>
      <p>Press <b>Run Program</b> to try it on the simulator, then <b>Submit</b>. Submit runs the auto-check.</p>
    `,
    starterCode: "",
    hint: "Loops → Repeat 3 times. Put the buzzer and wait blocks inside it, and the LCD block underneath.",
    unitName: UNIT_NAME,
    unitId: UNIT_ID,
    stepDocId: "step-0",
    tests: [
      {
        name: "Beeps 3 times, then shows Done",
        scenario: { duration: 10 },
        match: { trace: false },
        checks: [
          { type: "code", pattern: "for \\(", min: 1, message: "Use a Repeat block for the beeps." },
          { type: "sound", min: 3, max: 3, message: "The robot should beep exactly 3 times." },
          { type: "lcdShows", pattern: "Done", flags: "i", message: "The LCD should show Done after the beeps." },
        ],
      },
    ],
  },
  {
    id: `${CHALLENGE_ID}_step_1`,
    challengeName: `${CHALLENGE_NAME} - Step 2`,
    description: `
      <h3><b>Question 2: Create a flowchart of the previous step</b></h3>
      <p>Create a flowchart of the previous step's program, using the shapes in the flowchart editor:</p>
      <ul>
        <li><b>Start</b> and <b>End</b> terminals.</li>
        <li>A <b>decision</b> for the loop ("Repeated 3 times?"), with a <b>Yes</b> and a <b>No</b> path.</li>
        <li><b>Process</b> shapes for the beep, the wait and showing Done.</li>
      </ul>
      <p>Press <b>Check Flowchart</b> to compare it with your Step 1 blocks, then <b>Submit</b>.</p>
    `,
    starterCode: "",
    hint: "The loop becomes a decision whose Yes path goes through the beep and wait and back up to the decision.",
    unitName: UNIT_NAME,
    unitId: UNIT_ID,
    stepDocId: "step-1",
    tests: [],
  },
];

// Documents the IDE reads and updates on submit (the challenge's review
// acknowledgements), created on first load
export const demoSeedDocs = {
  [`codingLevels/${LEVEL_ID}`]: { name: LEVEL_NAME, category: "basic" },
  [`codingLevels/${LEVEL_ID}/units_new/${UNIT_ID}`]: { unitName: UNIT_NAME, orderIndex: 0 },
  [`codingLevels/${LEVEL_ID}/units_new/${UNIT_ID}/challenges/${CHALLENGE_ID}`]: {
    challengeName: CHALLENGE_NAME,
    orderIndex: 0,
    acknowledgements: {},
  },
};
