# Blockly Robot IDE (standalone)

A standalone copy of the Blockly Robot Simulator IDE from the Training Manager site
(`training-manager/src/components/common/BlocklyRobotSimulator.js` and the files it uses),
running on Vite with no Firebase.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5180

- `?role=admin` opens it as staff: every step unlocked and the auto-check test editor shown.
- Progress, saves and submissions are kept in the browser's localStorage. To start over,
  clear the site data for localhost:5180, or use the IDE's own reset-progress button.

## What was copied, and what was swapped

Copied unchanged from `training-manager`:

- `src/components/common/` — `BlocklyRobotSimulator.js`, `FlowchartEditor.js`, `flowchartEngine.js`,
  `blocklyTests.js`, `BlocklyTestEditor.js`, `ImageViewer.js`, `sanitizeHtml.js`, `feedbackSound.js`
- `public/blocklyTestWorker.js` — the auto-check worker
- `src/index.css`, `tailwind.config.js`, `postcss.config.js`

Swapped:

- `src/firebase/firestore.js` — a localStorage stand-in for the Firestore calls the IDE makes
  (`doc`, `collection`, `getDoc`, `getDocs`, `setDoc`, `updateDoc`, `deleteDoc`, `writeBatch`,
  `serverTimestamp`, `arrayUnion`). `BlocklyRobotSimulator.js` imports it instead of `firebase/firestore`.
- `src/context/AppStateContext.js` — a fixed demo user instead of the site's login.

Blockly itself still loads from unpkg at runtime, as on the site, so the page needs internet access.

## Questions

Defined in `src/data/demoLevel.js`, in the shape `PortalLevelRunner` builds from Firestore:

1. **Build the program with blocks** — beep 3 times with a Repeat block, then show "Done" on the LCD.
   Submit runs the auto-check (Repeat block used, exactly 3 sounds, LCD shows Done).
2. **Create a flowchart of the previous step** — that wording switches the canvas to the flowchart
   editor. Check Flowchart / Submit compare the drawing's decisions, loops and actions with the
   Step 1 blocks.

Step 2 unlocks once Step 1 is submitted (as a teacher).
