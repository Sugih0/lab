import React from "react";
import BlocklyRobotSimulator from "./components/common/BlocklyRobotSimulator";
import { seedDocs } from "./firebase/firestore";
import { demoChallenges, demoSeedDocs, LEVEL_ID, LEVEL_NAME } from "./data/demoLevel";

seedDocs(demoSeedDocs);

const App = () => (
  <BlocklyRobotSimulator challenges={demoChallenges} levelId={LEVEL_ID} levelName={LEVEL_NAME} />
);

export default App;
