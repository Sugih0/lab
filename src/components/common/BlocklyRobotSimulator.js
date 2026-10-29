import React, { useEffect, useRef, useState, useCallback } from "react";
import Editor from "@monaco-editor/react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsRight, ChevronsLeft, BookOpen, Home, CheckCircle, AlertCircle, Lock, Send, RotateCcw, Save, Play, Square, ListChecks } from "lucide-react";
import { doc, setDoc, getDoc, serverTimestamp, collection, getDocs, deleteDoc, writeBatch, updateDoc, arrayUnion } from "../../firebase/firestore";
import { db, useAppState } from "../../context/AppStateContext";
import { FlowchartEditor } from "./FlowchartEditor";
import {
  analyzeBlocklyXml,
  compareWithBlocks,
  createStarterFlowchart,
  describeBlocks,
  flowchartToText,
  formatCheckReport,
  isFlowchartStep,
  parseFlowchart,
  serializeFlowchart,
} from "./flowchartEngine";
import { sanitizeHtml } from "./sanitizeHtml";
import { ZoomableHtml } from "./ImageViewer";
import { describeScenario, runBlocklyTests } from "./blocklyTests";
import { BlocklyTestEditor } from "./BlocklyTestEditor";
import { playSound } from "./feedbackSound";

// --- Override Array.prototype.toString for Blockly execution ---
const originalArrayToString = Array.prototype.toString;
// eslint-disable-next-line no-extend-native
Array.prototype.toString = function () {
  if (window._blocklySimulationActive) {
    const items = this.map(item => {
      if (typeof item === 'string') return `'${item}'`;
      if (item === null || item === undefined) return '';
      if (Array.isArray(item)) return item.toString();
      return String(item);
    });
    return `[${items.join(',')}]`;
  }
  return originalArrayToString.call(this);
};

// --- Script Loading Utility ---
const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
      } else {
        existingScript.addEventListener("load", () => resolve());
        existingScript.addEventListener("error", reject);
      }
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

// --- Toolbox XML ---
const TOOLBOX_XML = `
<xml id="toolbox" style="display: none">
    <category name="Logic" colour="#5b80a5">
        <block type="controls_if"></block>
        <block type="controls_if">
            <mutation else="1"></mutation>
        </block>
        <block type="controls_if">
            <mutation elseif="1" else="1"></mutation>
        </block>
        <sep gap="50"></sep>
        <block type="logic_compare"><field name="OP">EQ</field></block>
        <block type="logic_compare"><field name="OP">NEQ</field></block>
        <block type="logic_compare"><field name="OP">LT</field></block>
        <block type="logic_compare"><field name="OP">LTE</field></block>
        <block type="logic_compare"><field name="OP">GT</field></block>
        <block type="logic_compare"><field name="OP">GTE</field></block>
        <sep gap="50"></sep>
        <block type="logic_operation"><field name="OP">AND</field></block>
        <block type="logic_operation"><field name="OP">OR</field></block>
        <sep gap="50"></sep>
        <block type="logic_negate"></block>
        <block type="logic_boolean"></block>
        <block type="logic_null"></block>
    </category>
    <category name="Loops" colour="#5ba55b">
        <block type="controls_repeat_ext">
            <value name="TIMES">
                <shadow type="math_number"><field name="NUM">10</field></shadow>
            </value>
        </block>
        <block type="forever_loop"></block>
        <sep gap="50"></sep>
        <block type="controls_whileUntil"><field name="MODE">WHILE</field></block>
        <block type="controls_whileUntil"><field name="MODE">UNTIL</field></block>
        <sep gap="50"></sep>
        <block type="controls_for">
            <value name="FROM"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <value name="TO"><shadow type="math_number"><field name="NUM">10</field></shadow></value>
            <value name="BY"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
        </block>
        <block type="controls_forEach"></block>
        <block type="controls_flow_statements"></block>
    </category>
    <category name="Math" colour="#5b67a5">
        <block type="math_number"><field name="NUM">1</field></block>
        <sep gap="50"></sep>
        <block type="math_arithmetic">
            <value name="A"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <value name="B"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <field name="OP">ADD</field>
        </block>
        <block type="math_arithmetic">
            <value name="A"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <value name="B"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <field name="OP">MINUS</field>
        </block>
        <block type="math_arithmetic">
            <value name="A"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <value name="B"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <field name="OP">MULTIPLY</field>
        </block>
        <block type="math_arithmetic">
            <value name="A"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <value name="B"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <field name="OP">DIVIDE</field>
        </block>
        <block type="math_arithmetic">
            <value name="A"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <value name="B"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <field name="OP">POWER</field>
        </block>
        <block type="math_modulo">
            <value name="DIVIDEND"><shadow type="math_number"><field name="NUM">64</field></shadow></value>
            <value name="DIVISOR"><shadow type="math_number"><field name="NUM">10</field></shadow></value>
        </block>
        <sep gap="50"></sep>
        <block type="math_number_property">
            <value name="NUMBER_TO_CHECK"><shadow type="math_number"><field name="NUM">0</field></shadow></value>
        </block>
        <block type="math_round">
            <value name="NUM"><shadow type="math_number"><field name="NUM">3.1</field></shadow></value>
        </block>
        <block type="math_on_list"></block>
        <sep gap="50"></sep>
        <block type="math_random_float"></block>
        <block type="math_random_int">
            <value name="FROM"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <value name="TO"><shadow type="math_number"><field name="NUM">100</field></shadow></value>
        </block>
        <block type="math_constrain">
            <value name="VALUE"><shadow type="math_number"><field name="NUM">50</field></shadow></value>
            <value name="LOW"><shadow type="math_number"><field name="NUM">1</field></shadow></value>
            <value name="HIGH"><shadow type="math_number"><field name="NUM">100</field></shadow></value>
        </block>
    </category>
    <category name="Text" colour="#5ba58c">
        <block type="text"></block>
        <block type="text_join"></block>
        <block type="text_append">
            <value name="TEXT"><shadow type="text"></shadow></value>
        </block>
        <block type="text_length">
            <value name="VALUE"><shadow type="text"><field name="TEXT">abc</field></shadow></value>
        </block>
        <block type="text_isEmpty">
            <value name="VALUE"><shadow type="text"><field name="TEXT"></field></shadow></value>
        </block>
        <block type="text_indexOf">
            <value name="VALUE"><block type="variables_get"><field name="VAR">text</field></block></value>
            <value name="FIND"><shadow type="text"><field name="TEXT">abc</field></shadow></value>
        </block>
        <block type="text_charAt">
            <value name="VALUE"><block type="variables_get"><field name="VAR">text</field></block></value>
        </block>
        <block type="text_getSubstring">
            <value name="STRING"><block type="variables_get"><field name="VAR">text</field></block></value>
        </block>
        <block type="text_changeCase">
            <value name="TEXT"><shadow type="text"><field name="TEXT">abc</field></shadow></value>
        </block>
        <block type="text_trim">
            <value name="TEXT"><shadow type="text"><field name="TEXT">abc</field></shadow></value>
        </block>
        <block type="text_print">
            <value name="TEXT"><shadow type="text"><field name="TEXT">abc</field></shadow></value>
        </block>
        <block type="text_prompt_ext">
            <value name="TEXT"><shadow type="text"><field name="TEXT">abc</field></shadow></value>
        </block>
    </category>
    <category name="Lists" colour="#745ba5">
        <block type="lists_create_with">
            <mutation items="0"></mutation>
        </block>
        <block type="lists_create_with"></block>
        <block type="lists_repeat">
            <value name="NUM"><shadow type="math_number"><field name="NUM">5</field></shadow></value>
        </block>
        <sep gap="50"></sep>
        <block type="lists_length">
            <value name="VALUE"><block type="variables_get"><field name="VAR">list</field></block></value>
        </block>
        <block type="lists_isEmpty">
            <value name="VALUE"><block type="variables_get"><field name="VAR">list</field></block></value>
        </block>
        <block type="lists_indexOf">
            <value name="VALUE"><block type="variables_get"><field name="VAR">list</field></block></value>
        </block>
        <block type="lists_getIndex">
            <value name="VALUE"><block type="variables_get"><field name="VAR">list</field></block></value>
            <field name="MODE">GET</field>
        </block>
        <block type="lists_getIndex">
            <value name="VALUE"><block type="variables_get"><field name="VAR">list</field></block></value>
            <field name="MODE">GET_REMOVE</field>
        </block>
        <block type="lists_getIndex">
            <value name="VALUE"><block type="variables_get"><field name="VAR">list</field></block></value>
            <field name="MODE">REMOVE</field>
        </block>
        <sep gap="50"></sep>
        <block type="lists_setIndex">
            <value name="LIST"><block type="variables_get"><field name="VAR">list</field></block></value>
            <field name="MODE">SET</field>
        </block>
        <block type="lists_setIndex">
            <value name="LIST"><block type="variables_get"><field name="VAR">list</field></block></value>
            <field name="MODE">INSERT</field>
        </block>
        <sep gap="50"></sep>
        <block type="lists_getSublist">
            <value name="LIST"><block type="variables_get"><field name="VAR">list</field></block></value>
        </block>
        <block type="lists_split">
            <value name="DELIM"><shadow type="text"><field name="TEXT">,</field></shadow></value>
        </block>
        <block type="lists_sort"></block>
    </category>
    <category name="Comments" colour="#5ba58c">
        <block type="project_description"></block>
        <block type="line_comment"></block>
    </category>
    <sep></sep>
    <category name="Variables" colour="#a55b80" custom="VARIABLE"></category>
    <category name="Functions" colour="#995ba5" custom="PROCEDURE"></category>
    <sep></sep>
    <category name="Wait / Time" colour="#a5a55b">
        <block type="timer_value"></block>
        <block type="timer_reset"></block>
        <block type="wait_seconds">
            <value name="SECONDS"><shadow type="seconds_number"><field name="NUM">1</field></shadow></value>
        </block>
        <block type="wait_until_button">
            <field name="BUTTON">D18</field>
            <field name="STATE">PRESSED</field>
        </block>
        <block type="wait_until_distance">
            <field name="PORT">D26</field>
            <field name="OP">GT</field>
            <value name="DISTANCE"><shadow type="distance_number"><field name="NUM">1</field></shadow></value>
        </block>
        <block type="wait_until_color"><field name="COLOR">'red'</field></block>
        <block type="wait_until_gyro">
            <field name="AXIS">X</field>
            <field name="OP">GT</field>
            <value name="ANGLE"><shadow type="gyro_angle_number"><field name="NUM">1</field></shadow></value>
        </block>
        <block type="wait_until_gyro">
            <field name="AXIS">Y</field>
            <field name="OP">GT</field>
            <value name="ANGLE"><shadow type="gyro_angle_number"><field name="NUM">1</field></shadow></value>
        </block>
        <block type="wait_until_gyro">
            <field name="AXIS">Z</field>
            <field name="OP">GT</field>
            <value name="ANGLE"><shadow type="gyro_angle_number"><field name="NUM">1</field></shadow></value>
        </block>
    </category>
    <category name="Motor" colour="#5b67a5">
        <block type="motor_control">
            <value name="TYPE"><shadow type="motor_type_menu"><field name="TYPE">ON_FOR_SECOND</field></shadow></value>
            <value name="LEFT_SPEED"><shadow type="motor_speed_number"><field name="NUM">75</field></shadow></value>
            <value name="RIGHT_SPEED"><shadow type="motor_speed_number"><field name="NUM">75</field></shadow></value>
            <value name="SECONDS_INPUT"><shadow type="seconds_number"><field name="NUM">1</field></shadow></value>
        </block>
        <block type="stop_moving"></block>
    </category>
    <category name="LCD" colour="#5ba58c">
        <block type="lcd_display">
            <value name="TYPE"><shadow type="lcd_type_menu"><field name="TYPE">ON_FOR_SECOND</field></shadow></value>
            <value name="TEXT"><shadow type="text"><field name="TEXT"></field></shadow></value>
            <value name="ROW"><shadow type="lcd_row_number"><field name="NUM">0</field></shadow></value>
            <value name="COL"><shadow type="lcd_column_number"><field name="NUM">0</field></shadow></value>
            <value name="SECOND_INPUT"><shadow type="seconds_number"><field name="NUM">1</field></shadow></value>
            <value name="CLEAR_INPUT"><shadow type="lcd_clear_checkbox"><field name="CLEAR">TRUE</field></shadow></value>
        </block>
        <block type="clear_screen"></block>
    </category>
    <category name="Buzzer" colour="#5ba55b">
        <block type="play_note_simple">
             <value name="NOTE"><shadow type="buzzer_note_menu"><field name="NOTE">A4</field></shadow></value>
             <value name="PORT"><shadow type="buzzer_port_menu"><field name="PORT">PWM</field></shadow></value>
             <value name="SECOND"><shadow type="buzzer_number"><field name="NUM">1</field></shadow></value>
             <value name="PLAY_TYPE"><shadow type="buzzer_play_type_menu"><field name="PLAY_TYPE">WAIT</field></shadow></value>
        </block>
        <block type="play_tone_simple">
             <value name="TONE"><shadow type="buzzer_tone_number"><field name="NUM">440</field></shadow></value>
             <value name="PORT"><shadow type="buzzer_port_menu"><field name="PORT">PWM</field></shadow></value>
             <value name="SECOND"><shadow type="buzzer_number"><field name="NUM">1</field></shadow></value>
             <value name="PLAY_TYPE"><shadow type="buzzer_play_type_menu"><field name="PLAY_TYPE">WAIT</field></shadow></value>
        </block>
        <block type="play_note_volume">
             <value name="NOTE"><shadow type="buzzer_note_menu"><field name="NOTE">A4</field></shadow></value>
             <value name="PORT"><shadow type="buzzer_port_menu"><field name="PORT">PWM</field></shadow></value>
             <value name="VOLUME"><shadow type="buzzer_volume_number"><field name="NUM">100</field></shadow></value>
             <value name="SECOND"><shadow type="buzzer_number"><field name="NUM">1</field></shadow></value>
             <value name="PLAY_TYPE"><shadow type="buzzer_play_type_menu"><field name="PLAY_TYPE">WAIT</field></shadow></value>
        </block>
        <block type="play_tone_volume">
             <value name="TONE"><shadow type="buzzer_tone_number"><field name="NUM">440</field></shadow></value>
             <value name="PORT"><shadow type="buzzer_port_menu"><field name="PORT">PWM</field></shadow></value>
             <value name="VOLUME"><shadow type="buzzer_volume_number"><field name="NUM">100</field></shadow></value>
             <value name="SECOND"><shadow type="buzzer_number"><field name="NUM">1</field></shadow></value>
             <value name="PLAY_TYPE"><shadow type="buzzer_play_type_menu"><field name="PLAY_TYPE">WAIT</field></shadow></value>
        </block>
        <block type="stop_buzzer"></block>
    </category>
    <category name="Color Sensor" colour="#745ba5">
        <block type="color_name"></block>
        <block type="color_reflected_light"></block>
        <block type="color_ambient_light"></block>
        <block type="wait_until_color"><field name="COLOR">'red'</field></block>
        <block type="color_dropdown"><field name="COLOR">'red'</field></block>
    </category>
    <category name="Button Sensor" colour="#5b80a5">
        <block type="return_button_value">
            <field name="BUTTON">D18</field>
        </block>
        <block type="wait_until_button">
            <field name="BUTTON">D18</field>
            <field name="STATE">PRESSED</field>
        </block>
    </category>
    <category name="Ultrasonic Sensor" colour="#995ba5">
        <block type="get_ultrasonic_distance"><field name="PORT">D26</field></block>
        <block type="wait_until_distance">
            <field name="PORT">D26</field>
            <field name="OP">GT</field>
            <value name="DISTANCE"><shadow type="distance_number"><field name="NUM">1</field></shadow></value>
        </block>
    </category>
    <category name="Gyro Sensor" colour="#a55b80">
        <block type="get_gyro_angle"><field name="AXIS">X</field></block>
        <block type="get_gyro_angle"><field name="AXIS">Y</field></block>
        <block type="get_gyro_angle"><field name="AXIS">Z</field></block>
        <block type="wait_until_gyro">
            <field name="AXIS">X</field>
            <field name="OP">GT</field>
            <value name="ANGLE"><shadow type="gyro_angle_number"><field name="NUM">1</field></shadow></value>
        </block>
        <block type="wait_until_gyro">
            <field name="AXIS">Y</field>
            <field name="OP">GT</field>
            <value name="ANGLE"><shadow type="gyro_angle_number"><field name="NUM">1</field></shadow></value>
        </block>
        <block type="wait_until_gyro">
            <field name="AXIS">Z</field>
            <field name="OP">GT</field>
            <value name="ANGLE"><shadow type="gyro_angle_number"><field name="NUM">1</field></shadow></value>
        </block>
        <block type="reset_gyro"></block>
    </category>
</xml>
`;

// --- Buzzer ---
const BUZZER_NOTE_FREQUENCIES = {
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.0,
  A4: 440.0,
  B4: 493.88,
  C5: 523.25,
};

// The buzzer blocks used to keep NOTE, PORT and PLAY_TYPE as dropdown fields on
// the block itself, with math_number shadows on their number inputs; every
// input is now a value input with a green buzzer shadow. Rewrite old saved XML
// into the new shape before loading it, otherwise Blockly drops the unknown
// fields and the blocks lose their settings.
const LEGACY_BUZZER_PLAY_TYPES = { WAIT: "WAIT", NO_WAIT: "ONCE" };

const BUZZER_SHADOWS = {
  NOTE: { type: "buzzer_note_menu", field: "NOTE", value: "A4" },
  TONE: { type: "buzzer_tone_number", field: "NUM", value: "440" },
  PORT: { type: "buzzer_port_menu", field: "PORT", value: "PWM" },
  VOLUME: { type: "buzzer_volume_number", field: "NUM", value: "100" },
  SECOND: { type: "buzzer_number", field: "NUM", value: "1" },
  PLAY_TYPE: {
    type: "buzzer_play_type_menu",
    field: "PLAY_TYPE",
    value: "WAIT",
    fromLegacy: (v) => LEGACY_BUZZER_PLAY_TYPES[v] || "WAIT",
  },
};

const BUZZER_BLOCK_INPUTS = {
  play_note_simple: ["NOTE", "PORT", "SECOND", "PLAY_TYPE"],
  play_tone_simple: ["TONE", "PORT", "SECOND", "PLAY_TYPE"],
  play_note_volume: ["NOTE", "PORT", "VOLUME", "SECOND", "PLAY_TYPE"],
  play_tone_volume: ["TONE", "PORT", "VOLUME", "SECOND", "PLAY_TYPE"],
};

const migrateLegacyBuzzerXml = (xmlDom) => {
  const buzzerBlocks = Array.from(xmlDom.getElementsByTagName("block")).filter(
    (el) => BUZZER_BLOCK_INPUTS[el.getAttribute("type")]
  );
  buzzerBlocks.forEach((block) => {
    const ns = block.namespaceURI;
    const create = (tag) => block.ownerDocument.createElementNS(ns, tag);
    const findChild = (parent, tag, name) =>
      Array.from(parent.children).find(
        (el) => el.nodeName.toLowerCase() === tag && el.getAttribute("name") === name
      );

    BUZZER_BLOCK_INPUTS[block.getAttribute("type")].forEach((inputName) => {
      const shadowDef = BUZZER_SHADOWS[inputName];
      const existingValue = findChild(block, "value", inputName);
      if (existingValue) {
        // Number inputs already were value inputs; only their shadow changes.
        const legacyShadow = Array.from(existingValue.children).find(
          (el) => el.nodeName.toLowerCase() === "shadow" && el.getAttribute("type") === "math_number"
        );
        if (legacyShadow) legacyShadow.setAttribute("type", shadowDef.type);
        return;
      }

      const legacyField = findChild(block, "field", inputName);
      const fromLegacy = shadowDef.fromLegacy || ((v) => v);
      const fieldValue = legacyField ? fromLegacy(legacyField.textContent) : shadowDef.value;
      if (legacyField) block.removeChild(legacyField);
      const value = create("value");
      value.setAttribute("name", inputName);
      const shadow = create("shadow");
      shadow.setAttribute("type", shadowDef.type);
      const field = create("field");
      field.setAttribute("name", shadowDef.field);
      field.textContent = fieldValue;
      shadow.appendChild(field);
      value.appendChild(shadow);
      block.appendChild(value);
    });
  });
  return xmlDom;
};

// The robot blocks' inputs hold shadows like the reference GroveHat editor's:
// number inputs used to get math_number shadows, and the Motor / LCD type
// dropdown and the LCD Clear Screen checkbox used to be fields on the block
// itself. Rewrite old saved XML into that shape so loaded programs keep their
// settings and match the toolbox. `field` marks the shadows that replace an
// old field of the same name.
const LEGACY_SHADOW_INPUTS = {
  wait_seconds: { SECONDS: { type: "seconds_number" } },
  motor_control: {
    TYPE: { type: "motor_type_menu", field: "TYPE" },
    LEFT_SPEED: { type: "motor_speed_number" },
    RIGHT_SPEED: { type: "motor_speed_number" },
    SECONDS_INPUT: { type: "seconds_number" },
  },
  lcd_display: {
    TYPE: { type: "lcd_type_menu", field: "TYPE" },
    ROW: { type: "lcd_row_number" },
    COL: { type: "lcd_column_number" },
    SECOND_INPUT: { type: "seconds_number" },
    CLEAR_INPUT: { type: "lcd_clear_checkbox", field: "CLEAR" },
  },
  wait_until_distance: { DISTANCE: { type: "distance_number" } },
};

const migrateLegacyShadowInputsXml = (xmlDom) => {
  Array.from(xmlDom.getElementsByTagName("block")).forEach((block) => {
    const inputs = LEGACY_SHADOW_INPUTS[block.getAttribute("type")];
    if (!inputs) return;
    const findChild = (tag, name) =>
      Array.from(block.children).find(
        (el) => el.nodeName.toLowerCase() === tag && el.getAttribute("name") === name
      );

    Object.entries(inputs).forEach(([inputName, shadowDef]) => {
      const existingValue = findChild("value", inputName);
      if (existingValue) {
        Array.from(existingValue.children).forEach((el) => {
          if (el.nodeName.toLowerCase() === "shadow" && el.getAttribute("type") === "math_number") {
            el.setAttribute("type", shadowDef.type);
          }
        });
        return;
      }

      const legacyField = shadowDef.field && findChild("field", shadowDef.field);
      if (!legacyField) return;
      const create = (tag) => block.ownerDocument.createElementNS(block.namespaceURI, tag);
      const value = create("value");
      value.setAttribute("name", inputName);
      const shadow = create("shadow");
      shadow.setAttribute("type", shadowDef.type);
      const field = create("field");
      field.setAttribute("name", shadowDef.field);
      field.textContent = legacyField.textContent;
      block.removeChild(legacyField);
      shadow.appendChild(field);
      value.appendChild(shadow);
      block.appendChild(value);
    });
  });
  return xmlDom;
};

// The step a refresh comes back to. The simulator keeps it in the URL as
// ?step=N, counted from 1 like the "N / 37" counter.
const getStepIndexFromUrl = (challengeCount) => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('previewMode') === 'true' || challengeCount === 0) return 0;
  const step = parseInt(params.get('step'), 10);
  if (!step || step < 1) return 0;
  return Math.min(step, challengeCount) - 1;
};

// Blocks that haven't been saved with Save Progress yet are kept in
// localStorage per user, level and challenge, so a refresh doesn't lose them.
// Drafts never touch the submission docs in Firebase.
const getDraftKey = (username, levelId, challengeId) =>
  `blocklyDraft:${(username || '').toLowerCase()}:${levelId}:${challengeId}`;

const readDraft = (key) => {
  try {
    const draft = JSON.parse(localStorage.getItem(key));
    return draft && typeof draft.xml === 'string' ? draft : null;
  } catch (e) {
    return null;
  }
};

const writeDraft = (key, xml) => {
  try {
    localStorage.setItem(key, JSON.stringify({ xml, savedAt: Date.now() }));
  } catch (e) {
    console.warn('Could not keep Blockly draft:', e);
  }
};

const removeDraft = (key) => {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    // Storage unavailable; nothing to remove.
  }
};

// Flowcharts drawn on flowchart steps get drafts of their own, the same way
const getFlowchartDraftKey = (username, levelId, challengeId) =>
  `flowchartDraft:${(username || '').toLowerCase()}:${levelId}:${challengeId}`;

const readFlowchartDraft = (key) => {
  try {
    const draft = JSON.parse(localStorage.getItem(key));
    return draft && typeof draft.json === 'string' ? draft : null;
  } catch (e) {
    return null;
  }
};

const writeFlowchartDraft = (key, chart) => {
  try {
    localStorage.setItem(key, JSON.stringify({ json: serializeFlowchart(chart), savedAt: Date.now() }));
  } catch (e) {
    console.warn('Could not keep flowchart draft:', e);
  }
};

const removeLevelDrafts = (username, levelId) => {
  try {
    const prefixes = [getDraftKey(username, levelId, ''), getFlowchartDraftKey(username, levelId, '')];
    Object.keys(localStorage)
      .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
      .forEach((key) => localStorage.removeItem(key));
  } catch (e) {
    // Storage unavailable; nothing to remove.
  }
};

const workspaceToXmlText = (workspace) =>
  window.Blockly.Xml.domToText(window.Blockly.Xml.workspaceToDom(workspace));

// The canvas without block ids or positions, for telling whether the blocks
// really changed: blocks can shift a little when a program loads.
const workspaceContentText = (workspace) =>
  window.Blockly.Xml.domToText(window.Blockly.Xml.workspaceToDom(workspace, true))
    .replace(/ x="[^"]*" y="[^"]*"/g, '');

// --- Icons ---
const ConeIcon = ({ className }) => (
  <svg
    viewBox="0 0 100 100"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg">
    <path d="M20 90 H80 L85 95 H15 L20 90 Z" fill="#FF6B00" />
    <path d="M25 90 L50 10 L75 90 H25 Z" fill="#FF8533" />
    <path d="M38 50 H62 L59 40 H41 L38 50 Z" fill="white" />
    <path d="M33 70 H67 L64 60 H36 L33 70 Z" fill="white" />
  </svg>
);

const TrashIcon = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round">
    <path d="M3 6h18" stroke="#86EFAC" strokeWidth="3" />
    <path
      d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
      stroke="#86EFAC"
      fill="#86EFAC"
      fillOpacity="0.2"
    />
    <line x1="10" y1="11" x2="10" y2="17" stroke="#86EFAC" />
    <line x1="14" y1="11" x2="14" y2="17" stroke="#86EFAC" />
  </svg>
);

// The previous step's blocks, shown read-only beside the flowchart that
// describes them. Blockly makes every injected workspace the "main" one, so
// the simulator's own workspace is handed back afterwards.
const ReadOnlyBlocks = ({ xml, mainWorkspaceRef, height = 280 }) => {
  const divRef = useRef(null);

  useEffect(() => {
    const Blockly = window.Blockly;
    if (!Blockly || !divRef.current || !xml) return undefined;
    const restoreMain = () => {
      if (mainWorkspaceRef.current && Blockly.common?.setMainWorkspace) {
        Blockly.common.setMainWorkspace(mainWorkspaceRef.current);
      }
    };
    const workspace = Blockly.inject(divRef.current, {
      readOnly: true,
      renderer: "geras",
      scrollbars: true,
      zoom: { controls: true, wheel: true, startScale: 0.7, maxScale: 2, minScale: 0.3, scaleSpeed: 1.2 },
      move: { scrollbars: true, drag: true, wheel: true },
    });
    try {
      const xmlUtils = Blockly.utils?.xml || Blockly.Xml;
      Blockly.Xml.domToWorkspace(
        migrateLegacyShadowInputsXml(migrateLegacyBuzzerXml(xmlUtils.textToDom(xml))),
        workspace
      );
      workspace.scrollCenter();
    } catch (e) {
      console.error("Error showing the previous step's blocks:", e);
    }
    restoreMain();
    return () => {
      workspace.dispose();
      restoreMain();
    };
  }, [xml, mainWorkspaceRef]);

  return <div ref={divRef} className="w-full rounded-lg border border-gray-200 overflow-hidden" style={{ height }} />;
};

// --- Main Component ---
const BlocklyRobotSimulator = ({ challenges = [], levelId, levelName }) => {
  const { currentUser, clearCache } = useAppState();
  const [isBlocklyLoaded, setIsBlocklyLoaded] = useState(false);
  const [pythonCode, setPythonCode] = useState("");
  const [varModal, setVarModal] = useState(null); // { message, defaultVal, callback }
  const [activeTab, setActiveTab] = useState(challenges.length > 0 ? "task" : "robot");
  const [currentChallengeIndex, setCurrentChallengeIndex] = useState(() =>
    getStepIndexFromUrl(challenges.length)
  );
  const [consoleOutput, setConsoleOutput] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [zoom, setZoom] = useState(1.2); // Zoom state
  const zoomRef = useRef(1.2); // Ref to access zoom inside loops without dependency issues
  const [completedChallenges, setCompletedChallenges] = useState([]);
  // Submit waits for the saved progress: until it has loaded, the steps
  // already completed aren't known
  const [isProgressLoaded, setIsProgressLoaded] = useState(false);
  const [progressLoadFailed, setProgressLoadFailed] = useState(false);
  const [progressLoadAttempt, setProgressLoadAttempt] = useState(0);
  const [savedSubmissions, setSavedSubmissions] = useState({});
  const [isWorkspaceReady, setIsWorkspaceReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resettingProgress, setResettingProgress] = useState(false);
  const [previewSnippet, setPreviewSnippet] = useState(null);

  // Steps that ask for a flowchart of the previous step ("Create a flowchart
  // of the previous step") draw one over the Blockly canvas instead of blocks
  const isFlowchartChallenge = isFlowchartStep(challenges[currentChallengeIndex]?.description);
  const previousChallenge = isFlowchartChallenge && currentChallengeIndex > 0 ? challenges[currentChallengeIndex - 1] : null;
  const [flowchart, setFlowchart] = useState(createStarterFlowchart);
  const [flowchartKey, setFlowchartKey] = useState(0);
  const [flowchartCheck, setFlowchartCheck] = useState(null); // { result, blockedSubmit }
  const [previousBlocksXml, setPreviousBlocksXml] = useState('');

  // Auto-check: other steps with tests run them on Submit, and only a pass is
  // sent for review. Tests an admin saved here win over the loaded ones.
  const isStaff = currentUser?.role === 'admin' || currentUser?.role === 'trainer';
  const [testsOverride, setTestsOverride] = useState({}); // challenge id -> tests
  const currentTests =
    testsOverride[challenges[currentChallengeIndex]?.id] || challenges[currentChallengeIndex]?.tests || [];
  const [testCheck, setTestCheck] = useState(null); // { results, blockedSubmit }
  const [checkingTests, setCheckingTests] = useState(false);
  // A result only stands for the blocks it was run on
  useEffect(() => setTestCheck(null), [currentChallengeIndex, generatedCode]);

  // Check for preview mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('previewMode') === 'true') {
      const snippetData = sessionStorage.getItem('previewSnippet');
      if (snippetData) {
        const snippet = JSON.parse(snippetData);
        setPreviewSnippet(snippet);
        // Set the generated code from the snippet
        if (snippet.code) {
          setGeneratedCode(snippet.code);
        }
      }
    }
  }, []);

  // Jump to specific challenge for preview mode
  useEffect(() => {
    if (previewSnippet && challenges.length > 0) {
      const levelIdStr = levelId || previewSnippet.levelId || '';
      const rawSnippetId = previewSnippet.id || '';
      const cleanSnippetId = (levelIdStr && rawSnippetId.startsWith(levelIdStr + '_'))
        ? rawSnippetId.substring(levelIdStr.length + 1)
        : rawSnippetId;

      let index = -1;
      if (cleanSnippetId) {
        index = challenges.findIndex(c => {
          const cIdClean = (c.id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
          const targetClean = cleanSnippetId.replace(/[^a-zA-Z0-9_-]/g, '_');
          return cIdClean === targetClean || c.id === cleanSnippetId;
        });
      }

      if (index === -1 && previewSnippet.challengeId) {
        const stepId = previewSnippet.ackKey?.includes('--') ? previewSnippet.ackKey.split('--')[1] : (previewSnippet.stepId || null);
        const targetChallengeId = stepId ? `${previewSnippet.challengeId}_step_${stepId}` : previewSnippet.challengeId;
        // The exact step first; otherwise any step of the challenge would match
        // and a review of Step 3 would open Step 1
        index = challenges.findIndex(c => c.id === targetChallengeId);
        if (index === -1) {
          index = challenges.findIndex(c =>
            c.id === previewSnippet.id ||
            c.id === previewSnippet.challengeId ||
            (c.id.includes('_step_') && c.id.split('_step_')[0] === previewSnippet.challengeId)
          );
        }
      }

      if (index === -1 && previewSnippet.unitName && previewSnippet.title) {
        index = challenges.findIndex(c => 
          (c.unitName || '').toLowerCase() === previewSnippet.unitName.toLowerCase() &&
          (c.title || '').toLowerCase() === previewSnippet.title.toLowerCase()
        );
      }

      if (index === -1 && previewSnippet.title) {
        index = challenges.findIndex(c => 
          (c.title || '').toLowerCase() === previewSnippet.title.toLowerCase()
        );
      }

      if (index !== -1) {
        setCurrentChallengeIndex(index);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewSnippet, challenges.length]);

  // Load completed challenges from Firebase. A failed load stays failed (with
  // a retry) rather than counting as "nothing completed yet".
  useEffect(() => {
    if (!levelId) return undefined;
    if (!currentUser?.id) {
      if (currentUser?.role === 'teacher') setProgressLoadFailed(true);
      return undefined;
    }
    let cancelled = false;
    setIsProgressLoaded(false);
    setProgressLoadFailed(false);
    Promise.resolve()
      .then(() => getDoc(doc(db, 'teachers', currentUser.id, 'blocklyProgress', levelId)))
      .then((progressDoc) => {
        if (cancelled) return;
        setCompletedChallenges(progressDoc.exists() ? progressDoc.data().completedChallenges || [] : []);
        setIsProgressLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Error loading progress:', error);
        setProgressLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, currentUser?.role, levelId, progressLoadAttempt]);

  // Load submissions from Firebase
  useEffect(() => {
    const loadSubmissions = async () => {
      if (!currentUser?.username || !levelId) return;
      try {
        const submissionsRef = collection(db, 'users', currentUser.username.toLowerCase(), 'submissions');
        const submissionsSnap = await getDocs(submissionsRef);
        const map = {};
        submissionsSnap.docs.forEach(doc => {
          const data = doc.data();
          if (doc.id.startsWith(levelId + '_')) {
            const challengeId = doc.id.substring(levelId.length + 1);
            map[challengeId] = {
              code: data.code,
              blocklyXml: data.blocklyXml,
              flowchartJson: data.flowchartJson,
              savedAt: data.timestamp?.toMillis?.() || 0
            };
          }
        });
        setSavedSubmissions(map);
      } catch (error) {
        console.error('Error loading submissions:', error);
      }
    };

    loadSubmissions();
  }, [currentUser, levelId]);

  // Draft key of the challenge whose blocks are on the canvas. It is null while
  // the canvas is being cleared or loaded, so those changes are never kept as
  // another challenge's draft.
  const workspaceDraftKeyRef = useRef(null);
  // The canvas content right after loading, and whether it came from a draft.
  const workspaceBaselineRef = useRef({ content: '', fromDraft: false });

  // Called on every non-UI canvas change. Keeps the blocks as a draft, or drops
  // the draft once the canvas matches what is saved in Firebase again.
  const keepWorkspaceDraft = () => {
    const key = workspaceDraftKeyRef.current;
    if (!key || !workspaceRef.current || !window.Blockly) return;
    const baseline = workspaceBaselineRef.current;
    if (workspaceContentText(workspaceRef.current) === baseline.content && !baseline.fromDraft) {
      removeDraft(key);
    } else {
      writeDraft(key, workspaceToXmlText(workspaceRef.current));
    }
  };

  // Keep ?step= in the URL so a refresh comes back to the same step
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('previewMode') === 'true' || challenges.length === 0) return;
    params.set('step', String(currentChallengeIndex + 1));
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}?${params.toString()}${window.location.hash}`
    );
  }, [currentChallengeIndex, challenges.length]);

  // Load the current challenge's blocks: the local draft if it is newer than
  // what was last saved to Firebase, otherwise the saved submission. Waits for
  // the canvas to exist, otherwise the blocks have nowhere to go after a refresh.
  useEffect(() => {
    if (!isWorkspaceReady) return;
    workspaceDraftKeyRef.current = null;

    const params = new URLSearchParams(window.location.search);
    const isPreviewMode = params.get('previewMode') === 'true';
    
    if (challenges.length === 0) return;
    const challenge = challenges[currentChallengeIndex];
    if (!challenge) return;

    // In preview mode, if we are on the challenge that is being previewed, do not overwrite the workspace
    // The previewSnippet useEffect handles it.
    if (isPreviewMode && previewSnippet) {
      const stepId = previewSnippet.ackKey?.includes('--') ? previewSnippet.ackKey.split('--')[1] : null;
      const targetChallengeId = stepId ? `${previewSnippet.challengeId}_step_${stepId}` : previewSnippet.challengeId;
      
      const isTargetPreviewChallenge = stepId
        ? (challenge.id === targetChallengeId)
        : (challenge.id === previewSnippet.id || 
           challenge.id === previewSnippet.challengeId ||
           (challenge.id.includes('_step_') && challenge.id.split('_step_')[0] === previewSnippet.challengeId));
        
      if (isTargetPreviewChallenge) {
        return; // Let the preview snippet logic handle it
      }
    }

    const challengeIdStr = challenge.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const saved = savedSubmissions[challengeIdStr];
    const draftKey = getDraftKey(currentUser?.username, levelId, challenge.id);
    const draft = readDraft(draftKey);
    const fromDraft = !!draft && draft.savedAt > (saved?.savedAt || 0);
    const blocklyXml = fromDraft ? draft.xml : saved?.blocklyXml;

    const attachWorkspace = () => {
      // Motor and LCD blocks set to "On" only drop their On For Second inputs
      // on the next change event; settle them now so the baseline doesn't
      // differ from the canvas a moment later.
      workspaceRef.current.getAllBlocks(false).forEach((block) => {
        if (block.type === 'motor_control' || block.type === 'lcd_display') block.updateShape_();
      });
      workspaceBaselineRef.current = {
        content: workspaceContentText(workspaceRef.current),
        fromDraft,
      };
      workspaceDraftKeyRef.current = draftKey;
      // Loading doesn't always end on a change event, which would leave Run
      // and the auto-check with the previous program
      if (updateCodeRef.current) updateCodeRef.current();
    };

    if (blocklyXml) {
      const timer = setTimeout(() => {
        try {
          const Blockly = window.Blockly;
          const xmlUtils = Blockly.utils?.xml || Blockly.Xml;
          if (Blockly && xmlUtils && xmlUtils.textToDom) {
            workspaceRef.current.clear();
            const xml = migrateLegacyShadowInputsXml(
              migrateLegacyBuzzerXml(xmlUtils.textToDom(blocklyXml))
            );
            if (Blockly.Xml && Blockly.Xml.domToWorkspace) {
              Blockly.Xml.domToWorkspace(xml, workspaceRef.current);
            } else if (Blockly.serialization && Blockly.serialization.workspaces) {
              Blockly.serialization.workspaces.load(
                Blockly.Xml.workspaceToDom ? null : JSON.parse(blocklyXml),
                workspaceRef.current
              );
            }
          }
        } catch (e) {
          console.error('Error loading saved Blockly XML:', e);
        }
        attachWorkspace();
      }, 50);
      // Don't let a load for a step the user already left land on the next one
      return () => clearTimeout(timer);
    }

    // Clear workspace if no saved submission
    workspaceRef.current.clear();
    setGeneratedCode('');
    attachWorkspace();
  }, [currentChallengeIndex, challenges, savedSubmissions, isWorkspaceReady, previewSnippet, currentUser, levelId]);

  // The step a review/snippet preview opened, whose drawing is shown read-only
  const isPreviewChallenge = (challenge) => {
    if (!previewSnippet || !challenge) return false;
    const stepId = previewSnippet.ackKey?.includes('--') ? previewSnippet.ackKey.split('--')[1] : null;
    return stepId
      ? challenge.id === `${previewSnippet.challengeId}_step_${stepId}`
      : challenge.id === previewSnippet.id || challenge.id === previewSnippet.challengeId;
  };

  // Load the current flowchart step's drawing: the previewed submission, the
  // local draft if it is newer than what was saved, or the saved submission
  useEffect(() => {
    const challenge = challenges[currentChallengeIndex];
    if (!challenge || !isFlowchartStep(challenge.description)) return;
    let json = null;
    if (isPreviewChallenge(challenge)) {
      json = previewSnippet.flowchartJson;
    } else {
      const saved = savedSubmissions[challenge.id.replace(/[^a-zA-Z0-9_-]/g, '_')];
      const draft = readFlowchartDraft(getFlowchartDraftKey(currentUser?.username, levelId, challenge.id));
      json = draft && draft.savedAt > (saved?.savedAt || 0) ? draft.json : saved?.flowchartJson;
    }
    setFlowchart(parseFlowchart(json) || createStarterFlowchart());
    setFlowchartKey((key) => key + 1);
    setFlowchartCheck(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChallengeIndex, challenges, savedSubmissions, previewSnippet, currentUser, levelId]);

  // The blocks the flowchart should describe: the previous step's submission
  // (the reviewed instructor's in a preview), or the instructor's own draft
  useEffect(() => {
    setPreviousBlocksXml('');
    if (!previousChallenge) return undefined;
    if (!previewSnippet) {
      const saved = savedSubmissions[previousChallenge.id.replace(/[^a-zA-Z0-9_-]/g, '_')];
      const draft = readDraft(getDraftKey(currentUser?.username, levelId, previousChallenge.id));
      setPreviousBlocksXml(saved?.blocklyXml || draft?.xml || '');
      return undefined;
    }
    let cancelled = false;
    const owner = (previewSnippet.username || '').toLowerCase();
    if (!owner) return undefined;
    const submissionId = `${levelId}_${previousChallenge.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    getDoc(doc(db, 'users', owner, 'submissions', submissionId))
      .then((snap) => {
        if (!cancelled && snap.exists()) setPreviousBlocksXml(snap.data().blocklyXml || '');
      })
      .catch((error) => console.error("Error loading the previous step's blocks:", error));
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previousChallenge?.id, previewSnippet, savedSubmissions, currentUser, levelId]);

  const handleFlowchartChange = (next) => {
    setFlowchart(next);
    setFlowchartCheck(null);
    const challenge = challenges[currentChallengeIndex];
    if (challenge && !isPreviewChallenge(challenge)) {
      writeFlowchartDraft(getFlowchartDraftKey(currentUser?.username, levelId, challenge.id), next);
    }
  };

  // Compares the drawing's decisions, loops and actions with the previous
  // step's blocks. Shape text is plain words, so it isn't compared.
  const runFlowchartCheck = () => compareWithBlocks(flowchart, analyzeBlocklyXml(previousBlocksXml));

  const handleCheckFlowchart = () => {
    const result = runFlowchartCheck();
    setFlowchartCheck({ result, blockedSubmit: false });
    playSound(result.ok ? 'success' : 'error');
    setActiveTab('task');
  };

  const flowchartSubmissionFields = () => ({
    code: flowchartToText(flowchart),
    blocklyXml: '',
    flowchartJson: serializeFlowchart(flowchart),
    type: 'flowchart',
  });

  // Check if a challenge is unlocked. In this standalone demo every question
  // can be picked from the header's question menu, so none are locked.
  const isChallengeUnlocked = () => true;

  // Opens a question picked from the header's question menu
  const handleSelectQuestion = (index) => {
    if (index === currentChallengeIndex) return;
    resetSimulation();
    setCurrentChallengeIndex(index);
    setActiveTab('task');
  };

  // Get the index of the last progress (first uncompleted challenge)
  const getLastProgressIndex = () => {
    if (challenges.length === 0) return 0;
    for (let i = 0; i < challenges.length; i++) {
      if (!completedChallenges.includes(challenges[i]?.id)) {
        return i;
      }
    }
    // All completed — go to the last one
    return challenges.length - 1;
  };

  // A ?step= in the URL can't open a step that is still locked
  useEffect(() => {
    if (isProgressLoaded && !isChallengeUnlocked(currentChallengeIndex)) {
      setCurrentChallengeIndex(getLastProgressIndex());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProgressLoaded]);

  // Save progress
  const handleSaveProgress = async () => {
    if (!currentUser || saving) return;
    
    const challenge = challenges[currentChallengeIndex];
    if (!challenge) return;

    setSaving(true);
    try {
      // Get Blockly XML (graphical representation)
      let blocklyXml = '';
      if (window.Blockly && workspaceRef.current) {
        const xml = window.Blockly.Xml.workspaceToDom(workspaceRef.current);
        blocklyXml = window.Blockly.Xml.domToText(xml);
      }

      // A flowchart step saves the drawing instead of the (hidden) blocks
      const flowchartFields = isFlowchartChallenge ? flowchartSubmissionFields() : null;

      // Save to snippets with both code and Blockly XML
      const submissionId = `${levelId}_${challenge.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      await setDoc(doc(db, 'users', currentUser.username.toLowerCase(), 'submissions', submissionId), {
        code: generatedCode,
        blocklyXml: blocklyXml,
        title: challenge.challengeName,
        description: challenge.description || '',
        levelName: levelName || 'Unknown',
        unitName: challenge.unitName || '',
        timestamp: serverTimestamp(),
        type: 'blockly',
        isDraft: true,
        ...flowchartFields
      });

      // Update local savedSubmissions map
      const challengeIdStr = challenge.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      setSavedSubmissions(prev => ({
        ...prev,
        [challengeIdStr]: {
          code: flowchartFields ? flowchartFields.code : generatedCode,
          blocklyXml: flowchartFields ? '' : blocklyXml,
          flowchartJson: flowchartFields?.flowchartJson,
          savedAt: Date.now()
        }
      }));
      removeDraft(getDraftKey(currentUser.username, levelId, challenge.id));
      removeDraft(getFlowchartDraftKey(currentUser.username, levelId, challenge.id));

      alert('Progress saved successfully!');
    } catch (error) {
      console.error('Error saving progress:', error);
      alert('Failed to save progress. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Runs the step's auto-check on the blocks on the canvas, generated now
  // rather than taken from generatedCode, which can lag behind the canvas
  const runStepTests = async (tests = currentTests) => {
    setCheckingTests(true);
    try {
      let code = generatedCode;
      try {
        code = makeProceduresAsync(window.Blockly.JavaScript.workspaceToCode(workspaceRef.current));
      } catch (error) {
        console.warn('Using the last generated code for the auto-check:', error.message);
      }
      return await runBlocklyTests(code, tests, BUZZER_NOTE_FREQUENCIES);
    } finally {
      setCheckingTests(false);
    }
  };

  const handleCheckProgram = async () => {
    const results = await runStepTests();
    setTestCheck({ results, blockedSubmit: false });
    if (results.length > 0) playSound(results.every((r) => r.passed) ? 'success' : 'error');
    setActiveTab('task');
  };

  // Submit challenge. A flowchart step's drawing is checked against the
  // previous step's blocks, and a step with tests runs its auto-check; only a
  // pass is sent for review and unlocks the next step.
  const handleSubmitChallenge = async () => {
    if (!currentUser || submitting || checkingTests || !isProgressLoaded) return;

    const challenge = challenges[currentChallengeIndex];
    if (!challenge) return;

    let flowchartFields = null;
    let checkedFields = null;
    if (isFlowchartChallenge) {
      const result = runFlowchartCheck();
      if (!result.ok) {
        setFlowchartCheck({ result, blockedSubmit: true });
        playSound('error');
        setActiveTab('task');
        return;
      }
      flowchartFields = {
        ...flowchartSubmissionFields(),
        actualOutput: formatCheckReport(result, previousChallenge?.challengeName),
      };
    } else if (currentTests.length > 0) {
      const results = await runStepTests();
      setTestCheck({ results, blockedSubmit: true });
      if (!results.every((r) => r.passed)) {
        playSound('error');
        setActiveTab('task');
        return;
      }
      checkedFields = { actualOutput: `Auto-check passed: ${results.map((r) => r.name).join(', ')}` };
    }

    // Was this challenge already completed? If so, this is a resubmit — stay
    // on the current challenge instead of auto-advancing so the instructor
    // can keep reviewing/revising it.
    const wasAlreadyCompleted = completedChallenges.includes(challenge.id);

    setSubmitting(true);
    try {
      // Get Blockly XML (graphical representation)
      let blocklyXml = '';
      if (window.Blockly && workspaceRef.current) {
        const xml = window.Blockly.Xml.workspaceToDom(workspaceRef.current);
        blocklyXml = window.Blockly.Xml.domToText(xml);
      }

      // Save to snippets with both code and Blockly XML
      const submissionId = `${levelId}_${challenge.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      await setDoc(doc(db, 'users', currentUser.username.toLowerCase(), 'submissions', submissionId), {
        code: generatedCode,
        blocklyXml: blocklyXml,
        title: challenge.challengeName,
        description: challenge.description || '',
        levelName: levelName || 'Unknown',
        unitName: challenge.unitName || '',
        timestamp: serverTimestamp(),
        type: 'blockly',
        ...checkedFields,
        ...flowchartFields
      });

      // Coming back to this step should show what was just submitted
      const challengeIdStr = challenge.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      setSavedSubmissions(prev => ({
        ...prev,
        [challengeIdStr]: {
          code: flowchartFields ? flowchartFields.code : generatedCode,
          blocklyXml: flowchartFields ? '' : blocklyXml,
          flowchartJson: flowchartFields?.flowchartJson,
          savedAt: Date.now()
        }
      }));
      removeDraft(getDraftKey(currentUser.username, levelId, challenge.id));
      removeDraft(getFlowchartDraftKey(currentUser.username, levelId, challenge.id));

      // Create pending review for admin
      if (challenge.unitId) {
        // For step-based challenges, extract the base challenge ID
        const baseChallengeId = challenge.id.includes('_step_') 
          ? challenge.id.split('_step_')[0] 
          : challenge.id;
        
        const challengeRef = doc(
          db,
          'codingLevels',
          levelId,
          'units_new',
          challenge.unitId,
          'challenges',
          baseChallengeId
        );
        
        const challengeSnap = await getDoc(challengeRef);
        if (challengeSnap.exists()) {
          const challengeData = challengeSnap.data();
          const acknowledgements = challengeData.acknowledgements || {};
          // Clean up large fields (code, blocklyXml, output, questionInstructions) for all users in the acknowledgements map
          Object.keys(acknowledgements).forEach(key => {
            if (acknowledgements[key]) {
              delete acknowledgements[key].code;
              delete acknowledgements[key].blocklyXml;
              delete acknowledgements[key].output;
              delete acknowledgements[key].questionInstructions;
            }
          });

          // For step-based challenges, store per-step ack key (username--stepNum)
          // so each step can be reviewed independently
          const isStepChallenge = challenge.id.includes('_step_');
          const stepSuffix = isStepChallenge ? challenge.id.split('_step_')[1] : null;
          const ackKey = stepSuffix !== null 
            ? `${currentUser.username.toLowerCase()}--${stepSuffix}` 
            : currentUser.username.toLowerCase();

          acknowledgements[ackKey] = {
            status: 'pending',
            submittedAt: serverTimestamp(),
            questionTitle: challenge.challengeName,
            type: flowchartFields ? 'flowchart' : 'blockly',
          };
          
          await updateDoc(challengeRef, { acknowledgements });
        } else {
          console.warn('Challenge document not found:', baseChallengeId);
        }
      } else {
        console.warn('Challenge missing unitId, cannot create pending review');
      }

      // Save progress, then mark as completed locally: the next challenge only
      // unlocks once the save worked. arrayUnion adds this step to what is
      // saved, so a stale local list can never overwrite completed steps.
      if (!completedChallenges.includes(challenge.id)) {
        if (currentUser.id) {
          await setDoc(
            doc(db, 'teachers', currentUser.id, 'blocklyProgress', levelId),
            { completedChallenges: arrayUnion(challenge.id), lastUpdated: serverTimestamp() },
            { merge: true }
          );
        }
        setCompletedChallenges((prev) => (prev.includes(challenge.id) ? prev : [...prev, challenge.id]));
      }

      // Auto-advance to next challenge — only for a first-time submission.
      // On a resubmit of an already-completed challenge, stay put.
      if (!wasAlreadyCompleted && currentChallengeIndex < challenges.length - 1) {
        setTimeout(() => {
          // Clear Blockly workspace for the next challenge, without keeping
          // the empty canvas as this challenge's draft
          workspaceDraftKeyRef.current = null;
          if (workspaceRef.current) {
            workspaceRef.current.clear();
          }
          setGeneratedCode('');
          resetSimulation();
          setCurrentChallengeIndex(currentChallengeIndex + 1);
          setActiveTab('task'); // Show the next challenge instructions
        }, 1000);
      }

      clearCache();
      playSound('success');
      alert(
        wasAlreadyCompleted
          ? 'Challenge resubmitted successfully! Waiting for admin review.'
          : 'Challenge submitted successfully! Waiting for admin review.'
      );
    } catch (error) {
      console.error('Error submitting challenge:', error);
      playSound('error');
      alert('Failed to submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewAction = async (status) => {
    if (!previewSnippet) return;
    
    const { levelId, unitId, challengeId, username, ackKey } = previewSnippet;
    
    if (!levelId || !unitId || !challengeId) {
      alert("Missing required review data (levelId, unitId, or challengeId)");
      return;
    }
    
    let comment = "";
    if (status === "needs_revision") {
      comment = window.prompt("Please enter comment/feedback for revision request:");
      if (comment === null) return; // Cancelled
      if (!comment.trim()) {
        alert("A comment/feedback is required for revisions.");
        return;
      }
    } else {
      const confirmApprove = window.confirm(`Approve ${username || 'User'}'s submission?`);
      if (!confirmApprove) return;
    }
    
    try {
      const chRef = doc(
        db,
        "codingLevels",
        levelId,
        "units_new",
        unitId,
        "challenges",
        challengeId
      );
      
      const snap = await getDoc(chRef);
      if (snap.exists()) {
        const data = snap.data();
        const acks = data.acknowledgements || {};
        const comments = data.submissionComments || {};
        
        const keyToUpdate = ackKey || username?.toLowerCase();
        if (!keyToUpdate) {
          alert("Could not determine key to update");
          return;
        }
        
        acks[keyToUpdate] = {
          ...acks[keyToUpdate],
          status,
          reviewedAt: serverTimestamp(),
        };
        
        if (comment) {
          comments[keyToUpdate] = comment;
        }
        
        await updateDoc(chRef, {
          acknowledgements: acks,
          submissionComments: comments,
        });
        
        clearCache();
        alert(status === "approved" ? "Submission approved successfully!" : "Revision requested successfully!");
        
        sessionStorage.removeItem('previewMode');
        sessionStorage.removeItem('previewSnippet');
        sessionStorage.removeItem('reviewPreview');
        window.close();
      } else {
        alert("Challenge document not found in database.");
      }
    } catch (error) {
      console.error("Error updating review status:", error);
      alert("Error updating review status: " + error.message);
    }
  };

  // --- Auto-check tests (admin/trainer) ---
  const challengeDocRef = (challenge) =>
    doc(
      db,
      'codingLevels',
      levelId,
      'units_new',
      challenge.unitId,
      'challenges',
      challenge.id.includes('_step_') ? challenge.id.split('_step_')[0] : challenge.id
    );

  // The JavaScript saved blocks generate, as the Run button would run it
  const xmlToCode = (blocklyXml) => {
    const Blockly = window.Blockly;
    const workspace = new Blockly.Workspace();
    try {
      const xml = migrateLegacyShadowInputsXml(migrateLegacyBuzzerXml(Blockly.utils.xml.textToDom(blocklyXml)));
      Blockly.Xml.domToWorkspace(xml, workspace);
      workspace.getAllBlocks(false).forEach((block) => {
        if (block.type === 'motor_control' || block.type === 'lcd_display') block.updateShape_();
      });
      return makeProceduresAsync(Blockly.JavaScript.workspaceToCode(workspace));
    } finally {
      workspace.dispose();
    }
  };

  // Records each test's expected result from the blocks on the canvas and
  // saves the tests on the step
  const handleRecordAndSaveTests = async (tests) => {
    const challenge = challenges[currentChallengeIndex];
    const results = await runStepTests(tests.map(({ expected, ...test }) => test));
    const failed = results.find((r) => !r.trace || r.trace.error || r.trace.cutOff);
    if (failed) {
      throw new Error(`"${failed.name}" couldn't be recorded: ${failed.trace?.error?.message || failed.message || 'the program ran too long'}`);
    }
    const recorded = tests.map(({ expected, ...test }, i) => ({ ...test, expected: results[i].trace }));
    const ref = challenge.stepDocId
      ? doc(challengeDocRef(challenge), 'steps', challenge.stepDocId)
      : challengeDocRef(challenge);
    await updateDoc(ref, { blocklyTests: recorded });
    setTestsOverride((prev) => ({ ...prev, [challenge.id]: recorded }));
    setTestCheck(null);
    clearCache();
    return recorded;
  };

  // Runs the step's tests on the saved blocks of every instructor whose
  // submission was approved, and the signed-in trainer's own
  const handleCheckSavedAnswers = async () => {
    const challenge = challenges[currentChallengeIndex];
    const stepSuffix = challenge.id.includes('_step_') ? challenge.id.split('_step_')[1] : null;
    const snap = await getDoc(challengeDocRef(challenge));
    const acks = (snap.exists() && snap.data().acknowledgements) || {};
    const approved = Object.entries(acks)
      .filter(([key, ack]) => ack?.status === 'approved' && (stepSuffix !== null ? key.endsWith(`--${stepSuffix}`) : !key.includes('--')))
      .map(([key]) => key.split('--')[0]);
    const submissionId = `${levelId}_${challenge.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const rows = [];
    for (const user of [...new Set([currentUser.username.toLowerCase(), ...approved])]) {
      const sub = await getDoc(doc(db, 'users', user, 'submissions', submissionId));
      const blocklyXml = sub.exists() ? sub.data().blocklyXml : '';
      if (!blocklyXml) {
        if (approved.includes(user)) rows.push({ user, approved: true, passed: null, message: 'No saved blocks' });
        continue;
      }
      let code;
      try {
        code = xmlToCode(blocklyXml);
      } catch (error) {
        rows.push({ user, approved: approved.includes(user), passed: false, message: `Blocks couldn't be read: ${error.message}` });
        continue;
      }
      const results = await runBlocklyTests(code, currentTests, BUZZER_NOTE_FREQUENCIES);
      const failed = results.find((r) => !r.passed);
      rows.push({ user, approved: approved.includes(user), passed: !failed, message: failed ? `${failed.name}: ${failed.message}` : '' });
    }
    return rows;
  };

  // Reset progress for current user (admin/trainer only)
  const handleResetProgress = async () => {
    if (currentUser?.role !== 'admin' && currentUser?.role !== 'trainer') return;
    
    if (!window.confirm(`Reset ALL Blockly progress for this level?\n\nThis will:\n• Clear completed challenges\n• Remove acknowledgements\n• Delete submissions\n\nThis cannot be undone!`)) {
      return;
    }

    setResettingProgress(true);
    try {
      const batch = writeBatch(db);
      
      // 1. Clear local blockly progress
      const progressRef = doc(db, 'teachers', currentUser.id, 'blocklyProgress', levelId);
      batch.delete(progressRef);

      // 2. Clear acknowledgements from challenges for this user
      const unitsRef = collection(db, 'codingLevels', levelId, 'units_new');
      const unitsSnap = await getDocs(unitsRef);
      
      for (const unitDoc of unitsSnap.docs) {
        const challengesRef = collection(unitDoc.ref, 'challenges');
        const challengesSnap = await getDocs(challengesRef);
        
        for (const challengeDoc of challengesSnap.docs) {
          const data = challengeDoc.data();
          const acks = data.acknowledgements || {};
          const comments = data.submissionComments || {};
          
          // Find keys belonging to current user
          const userAckKeys = Object.keys(acks).filter(key => {
            const keyUsername = key.includes('--') ? key.split('--')[0] : key;
            return keyUsername.toLowerCase() === currentUser.username.toLowerCase();
          });
          
          if (userAckKeys.length > 0) {
            const newAcks = { ...acks };
            const newComments = { ...comments };
            userAckKeys.forEach(key => {
              delete newAcks[key];
              delete newComments[key];
            });
            batch.update(challengeDoc.ref, { 
              acknowledgements: newAcks,
              submissionComments: newComments
            });
          }
        }
      }

      await batch.commit();

      // 3. Delete submissions
      const submissionsRef = collection(db, 'users', currentUser.username.toLowerCase(), 'submissions');
      const submissionsSnap = await getDocs(submissionsRef);
      for (const subDoc of submissionsSnap.docs) {
        const subData = subDoc.data();
        if (subData.levelName === levelName) {
          await deleteDoc(subDoc.ref);
        }
      }

      // Clear local state
      removeLevelDrafts(currentUser.username, levelId);
      setSavedSubmissions({});
      setCompletedChallenges([]);
      setCurrentChallengeIndex(0);
      
      alert('Progress reset successfully!');
    } catch (error) {
      console.error('Error resetting progress:', error);
      alert('Failed to reset progress. Please try again.');
    } finally {
      setResettingProgress(false);
    }
  };

  // Automatically switch to "task" tab when challenges are loaded
  useEffect(() => {
    if (challenges.length > 0) {
      setActiveTab("task");
    }
  }, [challenges]);

  // Refs
  const blocklyDivRef = useRef(null);
  const simulationAreaRef = useRef(null);
  const robotRef = useRef(null);
  const trashRef = useRef(null);
  const colorPatchContainerRef = useRef(null);
  const ultraValueRef = useRef(null);
  const lSpeedValueRef = useRef(null);
  const rSpeedValueRef = useRef(null);

  // Simulation State Refs
  const workspaceRef = useRef(null);
  // Regenerates generatedCode/pythonCode from the canvas (set up with the workspace)
  const updateCodeRef = useRef(null);
  const robotState = useRef({
    x: 0,
    y: 0,
    angle: 0,
    leftSpeed: 0,
    rightSpeed: 0,
  });
  const robotAtStartRef = useRef(true); // Robot hasn't moved since its last reset
  const lastTimeRef = useRef(Date.now()); // Track time for physics loop

  // Cones: Using Refs for physics loop, State for rendering list. The map
  // starts with only the robot; cones are dragged in from the toolbar.
  const [cones, setCones] = useState([]);
  const conesDataRef = useRef([]);
  const coneDomRefs = useRef({});

  const animationFrameId = useRef(null);
  const detectedColorRef = useRef("none"); // For physics loop
  const [uiSelectedColor, setUiSelectedColor] = useState("none"); // For UI

  const audioCtx = useRef(null);
  const activeOscillators = useRef([]);
  const buzzerLoopId = useRef(0); // Bumped to cancel a running "Loop" play type
  const timerStart = useRef(0);
  const gyroOffset = useRef({ X: 0, Y: 0, Z: 0 }); // Set by Reset Gyro Sensor
  const buttonStates = useRef({ D18: false, D22: false, D24: false });
  const [uiPressedButtons, setUiPressedButtons] = useState({ D18: false, D22: false, D24: false });
  const isRunning = useRef(false); // Tracks if simulation is active
  const lcdCells = useRef([]);
  const lastAreaSize = useRef({ width: 600, height: 400 }); // Stores last known canvas size

  // --- Helper Functions ---
  const logToConsole = useCallback((msg) => {
    setConsoleOutput((prev) => prev + `> ${msg}\n`);
  }, []);

  const updateRobotPosition = useCallback(() => {
    if (robotRef.current) {
      robotRef.current.style.left = `${robotState.current.x}px`;
      robotRef.current.style.top = `${robotState.current.y}px`;
      robotRef.current.style.transform = `rotate(${robotState.current.angle + 90
        }deg)`;
    }
  }, []);



  // Directly update DOM for performance during loop
  const updateConesPosition = useCallback(() => {
    conesDataRef.current.forEach((cone) => {
      const el = coneDomRefs.current[cone.id];
      if (el) {
        el.style.left = `${cone.x}px`;
        el.style.top = `${cone.y}px`;
      }
    });
  }, []);

  // Update zoom ref when state changes
  useEffect(() => {
    zoomRef.current = zoom;
    // Force a position update to handle any immediate layout shifts
    updateConesPosition();
    updateRobotPosition();
  }, [zoom, updateRobotPosition, updateConesPosition]);

  const lcdClear = useCallback(() => {
    lcdCells.current.forEach((cell) => {
      if (cell) cell.textContent = "\u00A0"; // Non-breaking space
    });
  }, []);

  const resetTimer = useCallback(() => {
    timerStart.current = Date.now();
  }, []);

  const stopAllTones = useCallback(() => {
    buzzerLoopId.current += 1;
    activeOscillators.current.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) { }
    });
    activeOscillators.current = [];
  }, []);

  // Puts the robot in the middle of the map, facing up.
  const placeRobotAtStart = useCallback(() => {
    const { width, height } = lastAreaSize.current;
    Object.assign(robotState.current, { x: width / 2 - 20, y: height / 2 - 20, angle: -90 });
    robotAtStartRef.current = true;
    updateRobotPosition();
  }, [updateRobotPosition]);

  // The map is hidden until the Robot tab opens, so a reset before that uses
  // a guessed size. Measure it and re-centre the robot as long as it hasn't
  // moved since its last reset (speeds already set by a starting program are
  // kept).
  const fitRobotToMap = useCallback(() => {
    const rect = simulationAreaRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    lastAreaSize.current = { width: rect.width, height: rect.height };
    if (robotAtStartRef.current) placeRobotAtStart();
  }, [placeRobotAtStart]);

  const resetSimulation = useCallback(() => {
    isRunning.current = false;
    if (animationFrameId.current)
      cancelAnimationFrame(animationFrameId.current);
    animationFrameId.current = null;
    stopAllTones();

    robotState.current.leftSpeed = 0;
    robotState.current.rightSpeed = 0;
    placeRobotAtStart();
    lcdClear();
    resetTimer();
    gyroOffset.current = { X: 0, Y: 0, Z: 0 };
    setConsoleOutput("");
    logToConsole("Simulation Reset.");

    // Reset Display
    if (ultraValueRef.current) ultraValueRef.current.innerText = "0";
    if (lSpeedValueRef.current) lSpeedValueRef.current.innerText = "0";
    if (rSpeedValueRef.current) rSpeedValueRef.current.innerText = "0";

    // Restart loop immediately
    lastTimeRef.current = Date.now();
    animationFrameId.current = requestAnimationFrame(loopRef.current);
  }, [
    logToConsole,
    placeRobotAtStart,
    lcdClear,
    resetTimer,
    stopAllTones,
  ]);

  // --- Runtime Helpers (exposed to generated code) ---
  const wait = (seconds) => {
    return new Promise((resolve, reject) => {
      // Measured on the clock, not by counting ticks, so timed moves last as
      // long as asked even when the browser delays the interval.
      const start = Date.now();
      const interval = setInterval(() => {
        if (!isRunning.current) {
          clearInterval(interval);
          reject(new Error("Simulation stopped"));
          return;
        }
        if ((Date.now() - start) / 1000 >= seconds) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });
  };

  const moveIndefinitely = (left, right) => {
    if (!isRunning.current) return;
    // Clamped like the reference robot's Motor.setSpeed
    const clampSpeed = (speed) => Math.max(-100, Math.min(100, Number(speed) || 0));
    robotState.current.leftSpeed = clampSpeed(left);
    robotState.current.rightSpeed = clampSpeed(right);
  };

  const move = async (left, right, seconds) => {
    if (!isRunning.current) return;
    moveIndefinitely(left, right);
    try {
      await wait(seconds);
    } finally {
      stopMoving();
    }
  };

  const stopMoving = () => {
    robotState.current.leftSpeed = 0;
    robotState.current.rightSpeed = 0;
  };

  // Ultrasonic sensor of the reference GroveHat virtual robot (web.thelab.id
  // map.js): it only sees cones overlapping a beam as wide as the robot that
  // runs straight ahead from its front, and reads the distance from the middle
  // of the robot's front to the nearest such cone's centre as
  // map units / 10 - 7 cm, from 0 to 100. Sizes are the reference's: a
  // 187 x 188 unit car and 128 unit cones, at 0.2px per unit (its grid dot
  // every 100 units is our 20px one). Our robot's x/y is its top-left and a
  // cone's x/y its centre.
  const getUltrasonicDistance = () => {
    const PX_PER_UNIT = 0.2;
    const carHalfWidth = 93.5 * PX_PER_UNIT;
    const carHalfLength = 94.1 * PX_PER_UNIT;
    const coneHalf = 64 * PX_PER_UNIT;
    const { x, y, angle } = robotState.current;
    const rad = (angle * Math.PI) / 180;
    const ahead = { x: Math.cos(rad), y: Math.sin(rad) };
    const side = { x: -ahead.y, y: ahead.x };
    const front = {
      x: x + 20 + ahead.x * carHalfLength,
      y: y + 20 + ahead.y * carHalfLength,
    };
    const beam = [-carHalfWidth, carHalfWidth].flatMap((across) =>
      [0, 2000].map((along) => ({
        x: front.x + side.x * across + ahead.x * along,
        y: front.y + side.y * across + ahead.y * along,
      }))
    );

    let nearest = Infinity;
    conesDataRef.current.forEach((cone) => {
      const box = [-coneHalf, coneHalf].flatMap((dx) =>
        [-coneHalf, coneHalf].map((dy) => ({ x: cone.x + dx, y: cone.y + dy }))
      );
      // Separating axis test between the beam and the cone's box
      const overlaps = [ahead, side, { x: 1, y: 0 }, { x: 0, y: 1 }].every((axis) => {
        const beamSpan = beam.map((p) => p.x * axis.x + p.y * axis.y);
        const coneSpan = box.map((p) => p.x * axis.x + p.y * axis.y);
        return (
          Math.min(...beamSpan) < Math.max(...coneSpan) &&
          Math.min(...coneSpan) < Math.max(...beamSpan)
        );
      });
      if (overlaps) {
        nearest = Math.min(nearest, Math.hypot(cone.x - front.x, cone.y - front.y));
      }
    });

    const units = Math.min(nearest / PX_PER_UNIT, 1070);
    return Math.max(0, Math.round(units / 10) - 7);
  };

  const getColorSensor = () => detectedColorRef.current;
  const getReflectedLightIntensity = () => 0;
  const getAmbientLightIntensity = () => 0;
  const isButtonPressed = (btn) => buttonStates.current[btn];

  const getRawGyroAngle = (axis) => {
    if (axis === "Z") return Math.round(robotState.current.angle % 360);
    return 0;
  };

  const getGyroAngle = (axis) => getRawGyroAngle(axis) - gyroOffset.current[axis];

  const resetGyro = () => {
    gyroOffset.current = { X: getRawGyroAngle("X"), Y: getRawGyroAngle("Y"), Z: getRawGyroAngle("Z") };
  };

  const getTimerValue = () => (Date.now() - timerStart.current) / 1000;

  // Like the real 16x2 LCD, text from column 16 on is off the screen (not
  // squeezed into the last column)
  const lcdPrint = (row, col, text) => {
    const r = Math.max(0, Math.min(1, Math.round(row)));
    let c = Math.max(0, Math.round(col));
    const str = String(text);
    for (let i = 0; i < str.length && c < 16; i++, c++) {
      const cell = lcdCells.current[r * 16 + c];
      if (cell) cell.textContent = str[i];
    }
  };

  const lcdPrintForDuration = async (row, col, text, seconds) => {
    lcdPrint(row, col, text);
    await wait(seconds);
    lcdClear();
    // Yield a paint frame so the cleared state is actually drawn. Without
    // this, two back-to-back lcdPrintForDuration calls (or any
    // print-then-clear-then-print sequence) collapse into a single visible
    // display because the browser only paints the final synchronous state.
    if (typeof requestAnimationFrame === "function") {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
    }
  };

  const getMouseWorldPos = (e, containerRect) => {
    // Screen-space center of the container
    const centerX = containerRect.left + containerRect.width / 2;
    const centerY = containerRect.top + containerRect.height / 2;
    // Mouse offset from screen center
    const mouseOffsetX = e.clientX - centerX;
    const mouseOffsetY = e.clientY - centerY;
    // Convert screen offset to wrapper-local offset by dividing by zoom
    const scaledOffsetX = mouseOffsetX / zoomRef.current;
    const scaledOffsetY = mouseOffsetY / zoomRef.current;

    // The wrapper div is width:100% height:100% (same size as container),
    // so its center in local coords is containerWidth/2, containerHeight/2
    const finalX = containerRect.width / 2 + scaledOffsetX;
    const finalY = containerRect.height / 2 + scaledOffsetY;

    return { x: finalX, y: finalY };
  };

  const handleConeMouseDown = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    const containerRect = simulationAreaRef.current.getBoundingClientRect();
    let coneIndex = conesDataRef.current.findIndex((c) => c.id === id);
    if (coneIndex === -1) return;
    const cone = conesDataRef.current[coneIndex];
    const startMousePos = getMouseWorldPos(e, containerRect);
    const startOffsetX = startMousePos.x - cone.x;
    const startOffsetY = startMousePos.y - cone.y;

    const onMouseMove = (moveEvent) => {
      coneIndex = conesDataRef.current.findIndex((c) => c.id === id);
      if (coneIndex === -1) return;
      const currentMousePos = getMouseWorldPos(moveEvent, containerRect);
      let newX = currentMousePos.x - startOffsetX;
      let newY = currentMousePos.y - startOffsetY;

      // Calculate visible area bounds in wrapper coords based on zoom
      // When zoomed out, visible area extends beyond [0, containerWidth]
      const halfW = containerRect.width / 2;
      const halfH = containerRect.height / 2;
      const z = zoomRef.current;
      const minBoundsX = halfW - halfW / z;
      const maxBoundsX = halfW + halfW / z - 40;
      const minBoundsY = halfH - halfH / z;
      const maxBoundsY = halfH + halfH / z - 40;

      newX = Math.max(minBoundsX, Math.min(newX, maxBoundsX));
      newY = Math.max(minBoundsY, Math.min(newY, maxBoundsY));

      conesDataRef.current[coneIndex].x = newX;
      conesDataRef.current[coneIndex].y = newY;
      const el = coneDomRefs.current[id];
      if (el) {
        el.style.left = `${newX}px`;
        el.style.top = `${newY}px`;
      }
    };

    const onMouseUp = (upEvent) => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (trashRef.current) {
        const trashRect = trashRef.current.getBoundingClientRect();
        if (
          upEvent.clientX >= trashRect.left &&
          upEvent.clientX <= trashRect.right &&
          upEvent.clientY >= trashRect.top &&
          upEvent.clientY <= trashRect.bottom
        ) {
          conesDataRef.current = conesDataRef.current.filter(
            (c) => c.id !== id
          );
          setCones((prev) => prev.filter((c) => c.id !== id));
        }
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const handleToolbarConeMouseDown = (e) => {
    e.preventDefault();
    if (!simulationAreaRef.current) return;
    const newId = Date.now();
    const containerRect = simulationAreaRef.current.getBoundingClientRect();
    const startMousePos = getMouseWorldPos(e, containerRect);
    const initialX = startMousePos.x - 20;
    const initialY = startMousePos.y - 20;
    const newCone = { id: newId, x: initialX, y: initialY };

    conesDataRef.current.push(newCone);
    setCones((prev) => [...prev, { id: newId }]);

    const startOffsetX = 20;
    const startOffsetY = 20;

    const onMouseMove = (moveEvent) => {
      const currentMousePos = getMouseWorldPos(moveEvent, containerRect);
      let newX = currentMousePos.x - startOffsetX;
      let newY = currentMousePos.y - startOffsetY;

      // Calculate visible area bounds in wrapper coords based on zoom
      const halfW = containerRect.width / 2;
      const halfH = containerRect.height / 2;
      const z = zoomRef.current;
      const minBoundsX = halfW - halfW / z;
      const maxBoundsX = halfW + halfW / z - 40;
      const minBoundsY = halfH - halfH / z;
      const maxBoundsY = halfH + halfH / z - 40;

      newX = Math.max(minBoundsX, Math.min(newX, maxBoundsX));
      newY = Math.max(minBoundsY, Math.min(newY, maxBoundsY));

      const idx = conesDataRef.current.findIndex((c) => c.id === newId);
      if (idx !== -1) {
        conesDataRef.current[idx].x = newX;
        conesDataRef.current[idx].y = newY;
        const el = coneDomRefs.current[newId];
        if (el) {
          el.style.left = `${newX}px`;
          el.style.top = `${newY}px`;
        }
      }
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const clearAllCones = () => {
    conesDataRef.current = [];
    setCones([]);
  };

  const selectColor = (color) => {
    const newColor = color === "none" ? "none" : color;
    detectedColorRef.current = newColor;
    setUiSelectedColor(newColor);
  };

  const playTone = (freq, sec, vol = 100) => {
    if (!isRunning.current) return Promise.resolve();
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext ||
        window.webkitAudioContext)();
    }
    const oscillator = audioCtx.current.createOscillator();
    const gainNode = audioCtx.current.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(freq, audioCtx.current.currentTime);
    gainNode.gain.setValueAtTime(vol / 100, audioCtx.current.currentTime);
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.current.destination);
    oscillator.start();
    activeOscillators.current.push(oscillator);
    return new Promise((resolve, reject) => {
      let elapsed = 0;
      const interval = setInterval(() => {
        if (!isRunning.current) {
          clearInterval(interval);
          try {
            oscillator.stop();
          } catch (e) {}
          const index = activeOscillators.current.indexOf(oscillator);
          if (index > -1) {
            activeOscillators.current.splice(index, 1);
          }
          reject(new Error("Simulation stopped"));
          return;
        }
        elapsed += 0.05;
        if (elapsed >= sec) {
          clearInterval(interval);
          try {
            oscillator.stop();
          } catch (e) {}
          const index = activeOscillators.current.indexOf(oscillator);
          if (index > -1) {
            activeOscillators.current.splice(index, 1);
          }
          resolve();
        }
      }, 50);
    });
  };

  // Play types of the buzzer blocks: WAIT holds the program until the sound
  // ends, ONCE starts the sound and moves on, LOOP keeps beeping (sound for
  // `sec`, rest for `sec`) in the background until Stop Buzzer Loop runs or
  // the program stops.
  const playBuzzer = (freq, sec, playType = "WAIT", vol = 100) => {
    if (playType === "LOOP") {
      stopAllTones(); // One buzzer: a new loop replaces whatever is playing
      const loopId = buzzerLoopId.current;
      (async () => {
        while (isRunning.current && buzzerLoopId.current === loopId) {
          await playTone(freq, sec, vol);
          if (buzzerLoopId.current !== loopId) break;
          await wait(sec);
        }
      })().catch(() => {}); // wait/playTone reject with "Simulation stopped"
      return Promise.resolve();
    }
    const tone = playTone(freq, sec, vol);
    if (playType === "ONCE") {
      tone.catch(() => {}); // Nobody awaits it, so swallow "Simulation stopped"
      return Promise.resolve();
    }
    return tone;
  };

  const playNote = (note, sec, playType, vol) =>
    playBuzzer(BUZZER_NOTE_FREQUENCIES[String(note).toUpperCase()] || 440, sec, playType, vol);

  const waitUntilButton = async (btn, state) => {
    if (!isRunning.current) return;
    const targetState = state === "PRESSED";
    while (buttonStates.current[btn] !== targetState) {
      if (!isRunning.current) throw new Error("Simulation stopped");
      await wait(0.01);
    }
  };

  // --- Simulation Loop (Moved to Ref to avoid closure staleness) ---
  const loopRef = useRef();
  loopRef.current = () => {
    const now = Date.now();
    const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1); // Limit dt to 0.1s to prevent jumps
    lastTimeRef.current = now;

    // 1. Robot Physics: the reference GroveHat virtual robot's model
    // (web.thelab.id map.js updateCar). Per frame it turns
    // 0.02 * (left - right) degrees clockwise and moves
    // (left + right) / 2 * 0.03 * 3 map units along its new heading; left =
    // -right spins on the spot. Its frames are taken here as 1/60 s, and its
    // map draws a grid dot every 100 units where ours draws one every 20px.
    if (
      robotState.current.leftSpeed !== 0 ||
      robotState.current.rightSpeed !== 0
    ) {
      robotAtStartRef.current = false;
      const frames = dt * 60;
      const PX_PER_UNIT = 0.2;
      // The reference sends 0.001 for a stopped wheel when the other one
      // runs, so the robot arcs instead of pivoting on that wheel.
      const nudge = (speed, other) => (speed === 0 && other !== 0 ? 0.001 : speed);
      const left = nudge(robotState.current.leftSpeed, robotState.current.rightSpeed);
      const right = nudge(robotState.current.rightSpeed, robotState.current.leftSpeed);

      robotState.current.angle += 0.02 * (left - right) * frames;
      const rad = robotState.current.angle * (Math.PI / 180);
      const dist = ((left + right) / 2) * 0.03 * 3 * frames * PX_PER_UNIT;

      let newX = robotState.current.x + Math.cos(rad) * dist;
      let newY = robotState.current.y + Math.sin(rad) * dist;

      if (simulationAreaRef.current) {
        const rect = simulationAreaRef.current.getBoundingClientRect();
        const robotSize = 40;
        // Calculate visible area bounds in wrapper coords based on zoom
        const halfW = rect.width / 2;
        const halfH = rect.height / 2;
        const z = zoomRef.current;
        const minBoundsX = halfW - halfW / z;
        const maxBoundsX = halfW + halfW / z - robotSize;
        const minBoundsY = halfH - halfH / z;
        const maxBoundsY = halfH + halfH / z - robotSize;

        if (newX < minBoundsX) newX = minBoundsX;
        if (newY < minBoundsY) newY = minBoundsY;
        if (newX > maxBoundsX) newX = maxBoundsX;
        if (newY > maxBoundsY) newY = maxBoundsY;
      }
      robotState.current.x = newX;
      robotState.current.y = newY;
      updateRobotPosition();
    }

    // 2. Dashboard Updates
    if (ultraValueRef.current) ultraValueRef.current.innerText = getUltrasonicDistance();
    if (lSpeedValueRef.current)
      lSpeedValueRef.current.innerText = robotState.current.leftSpeed;
    if (rSpeedValueRef.current)
      rSpeedValueRef.current.innerText = robotState.current.rightSpeed;

    // Always request next frame
    animationFrameId.current = requestAnimationFrame(loopRef.current);
  };

  // Start loop on mount
  useEffect(() => {
    lastTimeRef.current = Date.now();
    animationFrameId.current = requestAnimationFrame(loopRef.current);
    return () => cancelAnimationFrame(animationFrameId.current);
  }, []);

  // --- Blockly Initialization ---
  useEffect(() => {
    const loadBlockly = async () => {
      if (window.Blockly) {
        setIsBlocklyLoaded(true);
        return;
      }

      // Hack: Monaco Editor defines 'window.define' (AMD).
      // Blockly's UMD wrapper sees it and tries to register as an AMD module,
      // which conflicts with Monaco's loader ("Can only have one anonymous define call...").
      // We temporarily hide 'window.define' while loading Blockly.
      const amdDefine = window.define;
      if (amdDefine && amdDefine.amd) {
        window.define = null;
      }

      try {
        await loadScript("https://unpkg.com/blockly/blockly_compressed.js");
        await Promise.all([
          loadScript("https://unpkg.com/blockly/blocks_compressed.js"),
          loadScript("https://unpkg.com/blockly/javascript_compressed.js"),
          loadScript("https://unpkg.com/blockly/python_compressed.js"),
          loadScript("https://unpkg.com/blockly/msg/en.js")
        ]);
        let attempts = 0;
        while (!window.Blockly?.JavaScript && attempts < 20) {
          await new Promise((r) => setTimeout(r, 200));
          attempts++;
        }
        if (window.Blockly) setIsBlocklyLoaded(true);
      } catch (error) {
        console.error("Failed to load Blockly", error);
      } finally {
        // Restore AMD define
        if (amdDefine) window.define = amdDefine;
      }
    };
    loadBlockly();
  }, []);

  // --- Define Blocks ---
  useEffect(() => {
    if (!isBlocklyLoaded || !blocklyDivRef.current) return;
    if (workspaceRef.current) return;

    const Blockly = window.Blockly;

    // Extensions
    // Appends a value input that holds the given shadow, like a toolbox entry.
    const appendShadowInput = (block, name, label, check, shadow, field, value) => {
      const input = block.appendValueInput(name).setCheck(check).appendField(label);
      try {
        if (block.workspace && block.workspace.rendered) {
          const shadowBlock = block.workspace.newBlock(shadow);
          shadowBlock.setFieldValue(value, field);
          shadowBlock.setShadow(true);
          if (typeof shadowBlock.initSvg === "function") shadowBlock.initSvg();
          if (typeof shadowBlock.render === "function") shadowBlock.render();
          if (input.connection && shadowBlock.outputConnection) {
            input.connection.connect(shadowBlock.outputConnection);
          }
        } else {
          let textToDom = (Blockly.utils && Blockly.utils.xml && Blockly.utils.xml.textToDom) || (Blockly.Xml && Blockly.Xml.textToDom);
          if (textToDom && input.connection) {
            input.connection.setShadowDom(
              textToDom(`<shadow type="${shadow}"><field name="${field}">${value}</field></shadow>`)
            );
          }
        }
      } catch (e) {
        console.warn("Soft fail on shadow block generation", e);
      }
    };

    // Motor and LCD blocks take their On / On For Second type from the
    // dropdown shadow in their TYPE input, as in the reference editor, and
    // only show the On For Second inputs while that is selected. The shape is
    // re-checked on every change so blocks loaded as "On" drop the inputs
    // they were created with.
    const isOnForSecond = (block) =>
      (block.getInputTargetBlock("TYPE")?.getFieldValue("TYPE") || "ON_FOR_SECOND") === "ON_FOR_SECOND";

    if (!Blockly.Extensions.isRegistered("motor_control_extension")) {
      Blockly.Extensions.register("motor_control_extension", function () {
        this.updateShape_ = function () {
          const hasSecondInput = this.getInput("SECONDS_INPUT");
          if (isOnForSecond(this)) {
            if (!hasSecondInput) {
              appendShadowInput(this, "SECONDS_INPUT", "Second", "Number", "seconds_number", "NUM", "1");
            }
          } else if (hasSecondInput) {
            this.removeInput("SECONDS_INPUT");
          }

          if (this.rendered && typeof this.render === "function") {
            this.render();
          }
        };
        this.updateShape_();
        this.setOnChange(function (e) {
          if (!e.isUiEvent && isOnForSecond(this) !== !!this.getInput("SECONDS_INPUT")) {
            this.updateShape_();
          }
        });
      });
    }

    if (!Blockly.Extensions.isRegistered("lcd_display_extension")) {
      Blockly.Extensions.register("lcd_display_extension", function () {
        this.updateShape_ = function () {
          const hasSecondInput = this.getInput("SECOND_INPUT");
          const hasClearInput = this.getInput("CLEAR_INPUT");

          if (isOnForSecond(this)) {
            if (!hasSecondInput) {
              appendShadowInput(this, "SECOND_INPUT", "Second", "Number", "seconds_number", "NUM", "1");
            }
            if (!hasClearInput) {
              appendShadowInput(this, "CLEAR_INPUT", "Clear Screen", "Boolean", "lcd_clear_checkbox", "CLEAR", "TRUE");
            }
          } else {
            if (hasSecondInput) this.removeInput("SECOND_INPUT");
            if (hasClearInput) this.removeInput("CLEAR_INPUT");
          }

          if (this.rendered && typeof this.render === "function") {
            this.render();
          }
        };
        this.updateShape_();
        this.setOnChange(function (e) {
          if (!e.isUiEvent && isOnForSecond(this) !== !!this.getInput("SECOND_INPUT")) {
            this.updateShape_();
          }
        });
      });
    }

    // Dropdown options in the reference editor's order. Values stay the ones
    // older saved programs use.
    const COMPARE_OPTIONS = [
      ["=", "EQ"],
      ["≠", "NEQ"],
      [">", "GT"],
      ["≥", "GTE"],
      ["<", "LT"],
      ["≤", "LTE"],
    ];
    const COLOR_OPTIONS = [
      ["Yellow", "'yellow'"],
      ["Orange", "'orange'"],
      ["Red", "'red'"],
      ["White", "'white'"],
      ["Green", "'green'"],
      ["Purple", "'purple'"],
      ["Blue", "'blue'"],
      ["Black", "'black'"],
    ];

    // Definitions matching Toolbox XML
    const blocks = [
      {
        type: "motor_control",
        message0: "Motor Type %1",
        args0: [{ type: "input_value", name: "TYPE", check: "MotorType" }],
        message1: "Left Speed %1",
        args1: [{ type: "input_value", name: "LEFT_SPEED", check: "Number" }],
        message2: "Right Speed %1",
        args2: [{ type: "input_value", name: "RIGHT_SPEED", check: "Number" }],
        inputsInline: false,
        previousStatement: null,
        nextStatement: null,
        colour: 230,
        extensions: ["motor_control_extension"],
      },
      {
        type: "stop_moving",
        message0: "Stop Moving",
        previousStatement: null,
        nextStatement: null,
        colour: 230,
      },
      {
        type: "wait_seconds",
        message0: "Wait %1 Seconds",
        args0: [{ type: "input_value", name: "SECONDS", check: "Number" }],
        inputsInline: true,
        previousStatement: null,
        nextStatement: null,
        colour: 30,
      },
      // Shadows for the robot blocks' inputs, coloured and limited per input
      // like the reference GroveHat editor's.
      {
        type: "seconds_number",
        message0: "%1",
        args0: [{ type: "field_number", name: "NUM", value: 1, min: 0 }],
        output: "Number",
        colour: 120,
      },
      {
        type: "distance_number",
        message0: "%1",
        args0: [{ type: "field_number", name: "NUM", value: 1, min: 0, precision: 1 }],
        output: "Number",
        colour: 290,
      },
      {
        type: "lcd_row_number",
        message0: "%1",
        args0: [{ type: "field_number", name: "NUM", value: 0, min: 0, max: 1, precision: 1 }],
        output: "Number",
        colour: 290,
      },
      {
        type: "lcd_column_number",
        message0: "%1",
        args0: [{ type: "field_number", name: "NUM", value: 0, min: 0, max: 15, precision: 1 }],
        output: "Number",
        colour: 30,
      },
      {
        type: "motor_speed_number",
        message0: "%1",
        args0: [{ type: "field_number", name: "NUM", value: 75, min: -100, max: 100 }],
        output: "Number",
        colour: 230,
      },
      {
        type: "gyro_angle_number",
        message0: "%1",
        args0: [{ type: "field_number", name: "NUM", value: 1, min: 0, precision: 1 }],
        output: "Number",
        colour: 330,
      },
      {
        type: "motor_type_menu",
        message0: "%1",
        args0: [
          {
            type: "field_dropdown",
            name: "TYPE",
            options: [
              ["On", "ON"],
              ["On For Second", "ON_FOR_SECOND"],
            ],
          },
        ],
        output: "MotorType",
        colour: 230,
      },
      {
        type: "lcd_type_menu",
        message0: "%1",
        args0: [
          {
            type: "field_dropdown",
            name: "TYPE",
            options: [
              ["On", "ON"],
              ["On For Second", "ON_FOR_SECOND"],
            ],
          },
        ],
        output: "LcdDisplayType",
        colour: 160,
      },
      {
        type: "lcd_clear_checkbox",
        message0: "%1",
        args0: [{ type: "field_checkbox", name: "CLEAR", checked: true }],
        output: "Boolean",
        colour: 230,
      },
      {
        type: "get_ultrasonic_distance",
        message0: "Return Distance in Centimetres At Port %1",
        args0: [
          { type: "field_dropdown", name: "PORT", options: [["D26", "D26"]] },
        ],
        output: "Number",
        colour: 290,
      },
      {
        type: "wait_until_distance",
        message0: "Wait Until Distance at Port %1 %2 %3 CM",
        args0: [
          { type: "field_dropdown", name: "PORT", options: [["D26", "D26"]] },
          { type: "field_dropdown", name: "OP", options: COMPARE_OPTIONS },
          { type: "input_value", name: "DISTANCE", check: "Number" },
        ],
        inputsInline: true,
        previousStatement: null,
        nextStatement: null,
        colour: 290,
      },
      {
        type: "color_name",
        message0: "Return Color Name",
        output: "String",
        colour: 210,
      },
      {
        type: "color_reflected_light",
        message0: "Return Reflected Light Intensity Value",
        output: "Number",
        colour: 210,
      },
      {
        type: "color_ambient_light",
        message0: "Return Ambient Light Intensity Value",
        output: "Number",
        colour: 210,
      },
      {
        type: "color_dropdown",
        message0: "“ %1 ”",
        args0: [{ type: "field_dropdown", name: "COLOR", options: COLOR_OPTIONS }],
        output: "String",
        colour: 210,
      },
      {
        type: "lcd_display",
        message0: "Display Type %1",
        args0: [{ type: "input_value", name: "TYPE", check: "LcdDisplayType" }],
        message1: "Display Text %1",
        args1: [{ type: "input_value", name: "TEXT" }],
        message2: "Row %1",
        args2: [{ type: "input_value", name: "ROW", check: "Number" }],
        message3: "Column %1",
        args3: [{ type: "input_value", name: "COL", check: "Number" }],
        inputsInline: false,
        previousStatement: null,
        nextStatement: null,
        colour: 160,
        extensions: ["lcd_display_extension"],
      },
      {
        type: "clear_screen",
        message0: "Clear Screen",
        previousStatement: null,
        nextStatement: null,
        colour: 160,
      },
      {
        type: "play_note_simple",
        message0: "Note %1 Port %2 Second %3 Play Type %4",
        args0: [
          { type: "input_value", name: "NOTE", check: ["BuzzerNote", "String"] },
          { type: "input_value", name: "PORT", check: "BuzzerPort" },
          { type: "input_value", name: "SECOND", check: "Number" },
          { type: "input_value", name: "PLAY_TYPE", check: "BuzzerPlayType" },
        ],
        inputsInline: false,
        previousStatement: null,
        nextStatement: null,
        colour: "#5ba55b",
      },
      // Shadow blocks for the buzzer blocks' inputs. They share the blocks'
      // green so Blockly renders them in the lighter shadow tint of it.
      {
        type: "buzzer_note_menu",
        message0: "%1",
        args0: [
          {
            type: "field_dropdown",
            name: "NOTE",
            options: ["A4", "B4", "C4", "D4", "E4", "F4"].map((n) => [n, n]),
          },
        ],
        output: "BuzzerNote",
        colour: "#5ba55b",
      },
      {
        type: "buzzer_port_menu",
        message0: "%1",
        args0: [
          {
            type: "field_dropdown",
            name: "PORT",
            options: [
              ["PWM", "PWM"],
              ["D18", "D18"],
            ],
          },
        ],
        output: "BuzzerPort",
        colour: "#5ba55b",
      },
      {
        type: "buzzer_number",
        message0: "%1",
        args0: [{ type: "field_number", name: "NUM", value: 1, min: 0 }],
        output: "Number",
        colour: "#5ba55b",
      },
      {
        type: "buzzer_tone_number",
        message0: "%1 Hz",
        args0: [{ type: "field_number", name: "NUM", value: 440, min: 0, max: 8000 }],
        output: "Number",
        colour: "#5ba55b",
      },
      {
        type: "buzzer_volume_number",
        message0: "%1 %%",
        args0: [{ type: "field_number", name: "NUM", value: 100, min: 0, max: 100, precision: 1 }],
        output: "Number",
        colour: "#5ba55b",
      },
      {
        type: "buzzer_play_type_menu",
        message0: "%1",
        args0: [
          {
            type: "field_dropdown",
            name: "PLAY_TYPE",
            options: [
              ["Wait For Completion", "WAIT"],
              ["Play Once", "ONCE"],
              ["Loop", "LOOP"],
            ],
          },
        ],
        output: "BuzzerPlayType",
        colour: "#5ba55b",
      },
      {
        type: "play_tone_simple",
        message0: "Tone %1 Port %2 Second %3 Play Type %4",
        args0: [
          { type: "input_value", name: "TONE", check: "Number" },
          { type: "input_value", name: "PORT", check: "BuzzerPort" },
          { type: "input_value", name: "SECOND", check: "Number" },
          { type: "input_value", name: "PLAY_TYPE", check: "BuzzerPlayType" },
        ],
        inputsInline: false,
        previousStatement: null,
        nextStatement: null,
        colour: "#5ba55b",
      },
      {
        type: "play_note_volume",
        message0: "Note %1 Port %2 Volume %3 Second %4 Play Type %5",
        args0: [
          { type: "input_value", name: "NOTE", check: ["BuzzerNote", "String"] },
          { type: "input_value", name: "PORT", check: "BuzzerPort" },
          { type: "input_value", name: "VOLUME", check: "Number" },
          { type: "input_value", name: "SECOND", check: "Number" },
          { type: "input_value", name: "PLAY_TYPE", check: "BuzzerPlayType" },
        ],
        inputsInline: false,
        previousStatement: null,
        nextStatement: null,
        colour: "#5ba55b",
      },
      {
        type: "play_tone_volume",
        message0: "Tone %1 Port %2 Volume %3 Second %4 Play Type %5",
        args0: [
          { type: "input_value", name: "TONE", check: "Number" },
          { type: "input_value", name: "PORT", check: "BuzzerPort" },
          { type: "input_value", name: "VOLUME", check: "Number" },
          { type: "input_value", name: "SECOND", check: "Number" },
          { type: "input_value", name: "PLAY_TYPE", check: "BuzzerPlayType" },
        ],
        inputsInline: false,
        previousStatement: null,
        nextStatement: null,
        colour: "#5ba55b",
      },
      {
        type: "stop_buzzer",
        message0: "Stop Buzzer Loop",
        previousStatement: null,
        nextStatement: null,
        colour: 30,
      },
      {
        type: "get_gyro_angle",
        message0: "Return Gyro Sensor's %1 Angle Value",
        args0: [
          {
            type: "field_dropdown",
            name: "AXIS",
            options: [
              ["X", "X"],
              ["Y", "Y"],
              ["Z", "Z"],
            ],
          },
        ],
        output: "Number",
        colour: 330,
      },
      {
        type: "wait_until_gyro",
        message0: "Wait Until Gyro Sensor's %1 Angle %2 %3",
        args0: [
          {
            type: "field_dropdown",
            name: "AXIS",
            options: [
              ["X Axis", "X"],
              ["Y Axis", "Y"],
              ["Z Axis", "Z"],
            ],
          },
          { type: "field_dropdown", name: "OP", options: COMPARE_OPTIONS },
          { type: "input_value", name: "ANGLE", check: "Number" },
        ],
        inputsInline: true,
        previousStatement: null,
        nextStatement: null,
        colour: 330,
      },
      {
        type: "reset_gyro",
        message0: "Reset Gyro Sensor",
        previousStatement: null,
        nextStatement: null,
        colour: 330,
      },
      {
        type: "forever_loop",
        message0: "forever %1 do %2",
        args0: [
          { type: "input_dummy" },
          { type: "input_statement", name: "DO" },
        ],
        previousStatement: null,
        nextStatement: null,
        colour: 120,
      },
      {
        type: "break_loop",
        message0: "break out of loop",
        previousStatement: null,
        colour: 120,
      },
      {
        type: "project_description",
        message0: "%1",
        args0: [{ type: "field_input", name: "TEXT", text: "Enter Project Description" }],
        colour: 160,
      },
      {
        type: "line_comment",
        message0: "# %1",
        args0: [{ type: "field_input", name: "TEXT", text: "Enter Comments" }],
        previousStatement: null,
        nextStatement: null,
        colour: 160,
      },
      {
        type: "timer_value",
        message0: "Return Timer Value",
        output: "Number",
        colour: 30,
      },
      {
        type: "timer_reset",
        message0: "Reset Timer",
        previousStatement: null,
        nextStatement: null,
        colour: 30,
      },
      {
        type: "wait_until_button",
        message0: "Wait Until Button Sensor at Port %1 Is %2",
        args0: [
          {
            type: "field_dropdown",
            name: "BUTTON",
            options: [
              ["D18", "D18"],
              ["D22", "D22"],
              ["D24", "D24"],
            ],
          },
          {
            type: "field_dropdown",
            name: "STATE",
            options: [
              ["Pressed", "PRESSED"],
              ["Released", "RELEASED"],
            ],
          },
        ],
        previousStatement: null,
        nextStatement: null,
        colour: 210,
      },
      {
        type: "return_button_value",
        message0: "Return Button Sensor Value At Port %1",
        args0: [
          {
            type: "field_dropdown",
            name: "BUTTON",
            options: [
              ["D18", "D18"],
              ["D22", "D22"],
              ["D24", "D24"],
            ],
          },
        ],
        output: "Number",
        colour: 210,
      },
      {
        type: "wait_until_color",
        message0: "Wait Until Color Sensor Detect %1",
        args0: [{ type: "field_dropdown", name: "COLOR", options: COLOR_OPTIONS }],
        previousStatement: null,
        nextStatement: null,
        colour: 210,
      },
      {
        type: "text_print",
        message0: "print %1",
        args0: [{ type: "input_value", name: "TEXT" }],
        previousStatement: null,
        nextStatement: null,
        colour: 160,
      },
    ];

    Blockly.defineBlocksWithJsonArray(blocks);

    // Register forever_loop as a loop block so controls_flow_statements (break/continue) recognizes it.
    try {
      const flowBlock = Blockly.Blocks['controls_flow_statements'];
      if (flowBlock && flowBlock.hasOwnProperty('onchange')) {
        delete flowBlock.onchange;
      }

      const mixin = Blockly.Constants?.Loops?.CONTROL_FLOW_IN_LOOP_CHECK_MIXIN;
      if (mixin) {
        if (Array.isArray(mixin.LOOP_TYPES)) {
          if (!mixin.LOOP_TYPES.includes("forever_loop")) mixin.LOOP_TYPES.push("forever_loop");
        } else if (mixin.LOOP_TYPES instanceof Set) {
          mixin.LOOP_TYPES.add("forever_loop");
        }
      }

      if (flowBlock) {
        if (Array.isArray(flowBlock.LOOP_TYPES)) {
          if (!flowBlock.LOOP_TYPES.includes("forever_loop")) flowBlock.LOOP_TYPES.push("forever_loop");
        } else if (flowBlock.LOOP_TYPES instanceof Set) {
          flowBlock.LOOP_TYPES.add("forever_loop");
        }
      }
    } catch (e) {
      console.warn("Failed to register forever_loop with controls_flow_statements", e);
    }

    const jsGen = Blockly.JavaScript;
    if (jsGen) {
      const ORDER_ATOMIC = jsGen.ORDER_ATOMIC || 0;
      const ORDER_NONE = jsGen.ORDER_NONE || 99;

      if (!jsGen.forBlock["math_number"]) {
        jsGen.forBlock["math_number"] = function (block) {
          const num = block.getFieldValue("NUM");
          return [String(num), ORDER_ATOMIC];
        };
      }

      // JS comparisons for the reference editor's = ≠ > ≥ < ≤ dropdowns.
      const JS_COMPARE = { EQ: "===", NEQ: "!==", GT: ">", GTE: ">=", LT: "<", LTE: "<=" };

      jsGen.forBlock["motor_control"] = (b) => {
        const left = jsGen.valueToCode(b, "LEFT_SPEED", ORDER_ATOMIC) || 0;
        const right = jsGen.valueToCode(b, "RIGHT_SPEED", ORDER_ATOMIC) || 0;
        // Read input only if it actually exists on the block. The TYPE
        // dropdown changing fires a workspace event before the block's
        // updateShape_ has run, so the dropdown can say ON_FOR_SECOND while
        // SECONDS_INPUT isn't on the block yet (or vice versa).
        if (isOnForSecond(b) && b.getInput("SECONDS_INPUT")) {
          const sec = jsGen.valueToCode(b, "SECONDS_INPUT", ORDER_ATOMIC) || 0;
          return `await move(${left}, ${right}, ${sec});\n`;
        }
        return `moveIndefinitely(${left}, ${right});\n`;
      };
      jsGen.forBlock["stop_moving"] = () => "await stopMoving();\n";
      [
        "seconds_number",
        "distance_number",
        "lcd_row_number",
        "lcd_column_number",
        "motor_speed_number",
        "gyro_angle_number",
      ].forEach((type) => {
        jsGen.forBlock[type] = (b) => [String(b.getFieldValue("NUM")), ORDER_ATOMIC];
      });
      jsGen.forBlock["lcd_clear_checkbox"] = (b) => [
        b.getFieldValue("CLEAR") === "TRUE" ? "true" : "false",
        ORDER_ATOMIC,
      ];
      jsGen.forBlock["wait_seconds"] = (b) =>
        `await wait(${jsGen.valueToCode(b, "SECONDS", ORDER_ATOMIC) || 0});\n`;
      jsGen.forBlock["get_ultrasonic_distance"] = () => [
        "getUltrasonicDistance()",
        ORDER_NONE,
      ];
      jsGen.forBlock["wait_until_distance"] = (b) => {
        const op = JS_COMPARE[b.getFieldValue("OP")];
        const dist = jsGen.valueToCode(b, "DISTANCE", ORDER_ATOMIC) || 0;
        return `while (!(getUltrasonicDistance() ${op} ${dist})) { if(!isRunning.current) return; await wait(0.01); }\n`;
      };
      jsGen.forBlock["color_name"] = () => ["getColorSensor()", ORDER_NONE];
      jsGen.forBlock["color_reflected_light"] = () => ["getReflectedLightIntensity()", ORDER_NONE];
      jsGen.forBlock["color_ambient_light"] = () => ["getAmbientLightIntensity()", ORDER_NONE];
      jsGen.forBlock["color_dropdown"] = (b) => [
        `'${b.getFieldValue("COLOR").replace(/'/g, "")}'`,
        ORDER_ATOMIC,
      ];
      jsGen.forBlock["lcd_display"] = (b) => {
        const text = jsGen.valueToCode(b, "TEXT", ORDER_ATOMIC) || "''";
        const row = jsGen.valueToCode(b, "ROW", ORDER_ATOMIC) || 0;
        const col = jsGen.valueToCode(b, "COL", ORDER_ATOMIC) || 0;
        let code = "";
        // Read SECOND_INPUT / CLEAR_INPUT only if those inputs are currently
        // on the block. The TYPE dropdown changing fires a workspace event
        // before updateShape_ has had a chance to add or remove inputs, which
        // would otherwise throw `Input "SECOND_INPUT" doesn't exist`.
        if (isOnForSecond(b) && b.getInput("SECOND_INPUT")) {
          const clear =
            !!b.getInput("CLEAR_INPUT") &&
            jsGen.valueToCode(b, "CLEAR_INPUT", ORDER_ATOMIC) === "true";
          if (clear) code += "lcdClear();\n";
          const sec = jsGen.valueToCode(b, "SECOND_INPUT", ORDER_ATOMIC) || 1;
          code += `await lcdPrintForDuration(${row}, ${col}, ${text}, ${sec});\n`;
        } else {
          code += `lcdPrint(${row}, ${col}, ${text});\n`;
        }
        return code;
      };
      jsGen.forBlock["clear_screen"] = () => "lcdClear();\n";
      // Buzzer blocks. PORT is not read: the simulator has a single buzzer.
      jsGen.forBlock["play_note_simple"] = (b) => {
        const note = jsGen.valueToCode(b, "NOTE", ORDER_ATOMIC) || "'A4'";
        const sec = jsGen.valueToCode(b, "SECOND", ORDER_ATOMIC) || 1;
        const playType = jsGen.valueToCode(b, "PLAY_TYPE", ORDER_ATOMIC) || "'WAIT'";
        return `await playNote(${note}, ${sec}, ${playType});\n`;
      };

      jsGen.forBlock["play_tone_simple"] = (b) => {
        const freq = jsGen.valueToCode(b, "TONE", ORDER_ATOMIC) || 440;
        const sec = jsGen.valueToCode(b, "SECOND", ORDER_ATOMIC) || 1;
        const playType = jsGen.valueToCode(b, "PLAY_TYPE", ORDER_ATOMIC) || "'WAIT'";
        return `await playBuzzer(${freq}, ${sec}, ${playType});\n`;
      };

      jsGen.forBlock["play_note_volume"] = (b) => {
        const note = jsGen.valueToCode(b, "NOTE", ORDER_ATOMIC) || "'A4'";
        const vol = jsGen.valueToCode(b, "VOLUME", ORDER_ATOMIC) || 100;
        const sec = jsGen.valueToCode(b, "SECOND", ORDER_ATOMIC) || 1;
        const playType = jsGen.valueToCode(b, "PLAY_TYPE", ORDER_ATOMIC) || "'WAIT'";
        return `await playNote(${note}, ${sec}, ${playType}, ${vol});\n`;
      };

      jsGen.forBlock["play_tone_volume"] = (b) => {
        const freq = jsGen.valueToCode(b, "TONE", ORDER_ATOMIC) || 440;
        const vol = jsGen.valueToCode(b, "VOLUME", ORDER_ATOMIC) || 100;
        const sec = jsGen.valueToCode(b, "SECOND", ORDER_ATOMIC) || 1;
        const playType = jsGen.valueToCode(b, "PLAY_TYPE", ORDER_ATOMIC) || "'WAIT'";
        return `await playBuzzer(${freq}, ${sec}, ${playType}, ${vol});\n`;
      };
      jsGen.forBlock["buzzer_note_menu"] = (b) => [`'${b.getFieldValue("NOTE")}'`, ORDER_ATOMIC];
      jsGen.forBlock["buzzer_port_menu"] = (b) => [`'${b.getFieldValue("PORT")}'`, ORDER_ATOMIC];
      jsGen.forBlock["buzzer_number"] = (b) => [String(b.getFieldValue("NUM")), ORDER_ATOMIC];
      jsGen.forBlock["buzzer_tone_number"] = (b) => [String(b.getFieldValue("NUM")), ORDER_ATOMIC];
      jsGen.forBlock["buzzer_volume_number"] = (b) => [String(b.getFieldValue("NUM")), ORDER_ATOMIC];
      jsGen.forBlock["buzzer_play_type_menu"] = (b) => [`'${b.getFieldValue("PLAY_TYPE")}'`, ORDER_ATOMIC];
      jsGen.forBlock["stop_buzzer"] = () => "stopAllTones();\n";
      jsGen.forBlock["get_gyro_angle"] = (b) => [
        `getGyroAngle('${b.getFieldValue("AXIS")}')`,
        ORDER_NONE,
      ];
      jsGen.forBlock["wait_until_gyro"] = (b) => {
        const op = JS_COMPARE[b.getFieldValue("OP")];
        const angle = jsGen.valueToCode(b, "ANGLE", ORDER_ATOMIC) || 0;
        return `while (!(getGyroAngle('${b.getFieldValue("AXIS")}') ${op} ${angle})) { if(!isRunning.current) return; await wait(0.01); }\n`;
      };
      jsGen.forBlock["reset_gyro"] = () => "resetGyro();\n";
      jsGen.forBlock["forever_loop"] = (b) =>
        `while (true) {\n  if(!isRunning.current) return;\n ${jsGen.statementToCode(
          b,
          "DO"
        )}\n await wait(0.01);\n}\n`;
      jsGen.forBlock["controls_whileUntil"] = (b) => {
        const until = b.getFieldValue("MODE") === "UNTIL";
        let argument0 =
          jsGen.valueToCode(
            b,
            "BOOL",
            until ? jsGen.ORDER_LOGICAL_NOT : jsGen.ORDER_NONE
          ) || "false";
        let branch = jsGen.statementToCode(b, "DO");
        branch = jsGen.addLoopTrap(branch, b);
        if (until) {
          argument0 = "!" + argument0;
        }
        return `while (${argument0}) {\n  if(!isRunning.current) return;\n${branch}\n  await wait(0.01);\n}\n`;
      };
      jsGen.forBlock["break_loop"] = () => "break;\n";
      // Override controls_flow_statements generator so break/continue always
      // produce code even when the block shows a warning (e.g. inside forever_loop).
      jsGen.forBlock["controls_flow_statements"] = (b) => {
        const flow = b.getFieldValue("FLOW");
        if (flow === "BREAK") return "break;\n";
        if (flow === "CONTINUE") return "continue;\n";
        return "";
      };
      jsGen.forBlock["line_comment"] = (b) => `// ${b.getFieldValue("TEXT")}\n`;
      jsGen.forBlock["project_description"] = () => "";
      jsGen.forBlock["timer_value"] = () => ["getTimerValue()", ORDER_NONE];
      jsGen.forBlock["timer_reset"] = () => "resetTimer();\n";
      jsGen.forBlock["wait_until_button"] = (b) =>
        `await waitUntilButton('${b.getFieldValue(
          "BUTTON"
        )}', '${b.getFieldValue("STATE")}');\n`;
      jsGen.forBlock["return_button_value"] = (b) => [
        `(isButtonPressed('${b.getFieldValue("BUTTON")}') ? 1 : 0)`,
        ORDER_ATOMIC,
      ];
      jsGen.forBlock["wait_until_color"] = (b) =>
        `while (getColorSensor() !== '${b
          .getFieldValue("COLOR")
          .replace(
            /'/g,
            ""
          )}') { if(!isRunning.current) return; await wait(0.01); }\n`;
      jsGen.forBlock["text_print"] = (b) =>
        `logToConsole(${jsGen.valueToCode(b, "TEXT", ORDER_ATOMIC) || "''"
        });\n`;
    }

    // --- Python: the Raspberry Pi GroveHat code the reference editor shows
    // when no virtual robot is selected. Built-in blocks keep Blockly's own
    // Python, as in the reference.
    const pyGen = Blockly.Python;
    if (pyGen) {
      const PY_NONE = pyGen.ORDER_NONE;
      const PY_ATOMIC = pyGen.ORDER_ATOMIC;
      const PY_COMPARE = { EQ: "==", NEQ: "!=", GT: ">", GTE: ">=", LT: "<", LTE: "<=" };
      const provide = (name, line) => pyGen.provideFunction_(name, [line]);
      const value = (b, name, order = PY_NONE) => pyGen.valueToCode(b, name, order);
      const port = (b, name) => b.getFieldValue(name).replace("D", "");

      const provideGpio = () => {
        provide("import_rpi_gpio", "import RPi.GPIO as GPIO");
        provide("gpio_set_mode", "GPIO.setmode(GPIO.BCM)");
      };
      const provideMotor = () => {
        provide("import_motor", "from hat.MotorDriver import *");
        provide("motor_object", "motor=MotorDriver()");
      };
      const provideLcd = () => {
        provide("import_lcd", "from hat.LCD import *");
        provide("lcd_object", "lcd = JHD1802()");
      };
      const provideColorSensor = () =>
        provide("import_rpi_color_sensor", "from hat.ColorSensor import ColorSensor");
      const provideGyro = (withConfiguration) => {
        provide("import_rpi_gyro_sensor", "from hat.GyroSensor import GyroSensor");
        provide("import_rpi_gyro_obj", "GyroSensor = GyroSensor()");
        if (withConfiguration) {
          provide("import_rpi_gyro_power_configuration", "GyroSensor.power_configuration()");
          provide("import_rpi_gyro_fullscale_configuration", "GyroSensor.fullscale_configuration()");
        }
        provide("import_rpi_gyro_x", "gyro_x = 0");
        provide("import_rpi_gyro_y", "gyro_y = 0");
        provide("import_rpi_gyro_z", "gyro_z = 0");
      };
      const provideButton = (pin) => {
        provideGpio();
        provide(`gpio_setup_${pin}`, `GPIO.setup(${pin}, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)\n`);
      };

      // Shadow and menu values
      [
        "seconds_number",
        "distance_number",
        "lcd_row_number",
        "lcd_column_number",
        "motor_speed_number",
        "gyro_angle_number",
        "buzzer_number",
        "buzzer_tone_number",
        "buzzer_volume_number",
      ].forEach((type) => {
        pyGen.forBlock[type] = (b) => [String(b.getFieldValue("NUM")), PY_NONE];
      });
      pyGen.forBlock["motor_type_menu"] = (b) => [
        b.getFieldValue("TYPE") === "ON" ? "On" : "OnForSecond",
        PY_NONE,
      ];
      pyGen.forBlock["lcd_type_menu"] = pyGen.forBlock["motor_type_menu"];
      pyGen.forBlock["lcd_clear_checkbox"] = (b) => [
        b.getFieldValue("CLEAR") === "TRUE" ? "true" : "false",
        PY_NONE,
      ];
      pyGen.forBlock["buzzer_note_menu"] = (b) => [
        String(BUZZER_NOTE_FREQUENCIES[b.getFieldValue("NOTE")] || 440),
        PY_NONE,
      ];
      pyGen.forBlock["buzzer_port_menu"] = (b) => [
        b.getFieldValue("PORT") === "D18" ? "18" : "12",
        PY_NONE,
      ];
      pyGen.forBlock["buzzer_play_type_menu"] = (b) => [
        { WAIT: "0", ONCE: "1", LOOP: "2" }[b.getFieldValue("PLAY_TYPE")] || "0",
        PY_NONE,
      ];

      // Wait / Time
      pyGen.forBlock["timer_value"] = () => {
        provide("import_time", "import time");
        provide("TimerStartCounting", "TimerStartCounting = time.perf_counter()");
        return ["time.perf_counter() - TimerStartCounting", PY_NONE];
      };
      pyGen.forBlock["timer_reset"] = () => {
        provide("import_time", "import time");
        return "TimerStartCounting = time.perf_counter()\n";
      };
      // As in the reference, every generator reads its inputs before adding
      // its own imports, which keeps the import order at the top identical.
      pyGen.forBlock["wait_seconds"] = (b) => {
        const seconds = value(b, "SECONDS");
        provide("import_time", "import time");
        return `time.sleep(${seconds})\n`;
      };

      // Motor
      pyGen.forBlock["motor_control"] = (b) => {
        const left = value(b, "LEFT_SPEED");
        const right = value(b, "RIGHT_SPEED");
        if (isOnForSecond(b) && b.getInput("SECONDS_INPUT")) {
          const second = value(b, "SECONDS_INPUT");
          provide("import_time", "import time");
          provideMotor();
          return (
            `motor.set_speed(${left},${right})\n` +
            `time.sleep(${second})\n` +
            "motor.set_speed(0, 0)\n"
          );
        }
        provideMotor();
        return `motor.set_speed(${left},${right})\n`;
      };
      pyGen.forBlock["stop_moving"] = () => {
        provideMotor();
        return "motor.set_speed(0, 0)\n";
      };

      // LCD
      pyGen.forBlock["lcd_display"] = (b) => {
        const text = value(b, "TEXT");
        let code =
          `lcd.setCursor(${value(b, "ROW")},${value(b, "COL")})\n` +
          `lcd.write(${text})\n`;
        if (isOnForSecond(b) && b.getInput("SECOND_INPUT")) {
          const second = value(b, "SECOND_INPUT");
          const clear = b.getInput("CLEAR_INPUT") ? value(b, "CLEAR_INPUT") : "";
          provide("import_time", "import time");
          provideLcd();
          code += `time.sleep(${second})\n`;
          if (clear === "true") code += "lcd.clear()\n";
          return code;
        }
        provideLcd();
        return code;
      };
      pyGen.forBlock["clear_screen"] = () => {
        provideLcd();
        return "lcd.clear()\n";
      };

      // Buzzer. Play types: 0 waits for the sound, 1 plays it once in a
      // thread, 2 loops it in a thread until Stop Buzzer Loop.
      const pyBuzzer = (b, freqInput, withVolume) => {
        const freq = value(b, freqInput);
        const pin = value(b, "PORT");
        const volume = withVolume ? value(b, "VOLUME") : "";
        const second = value(b, "SECOND");
        const playType = value(b, "PLAY_TYPE") || "0";
        provideGpio();
        provide("import_time", "import time");
        const thread = `threadFunction${Math.floor(Math.random() * 1000001)}`;
        const setup = `GPIO.setwarnings(False)\nGPIO.setup(${pin}, GPIO.OUT)\n`;
        const wave = (indent) =>
          `${indent}halveWaveTime = 1 / (${freq} * 2 )\n` +
          `${indent}waves = int(${second} * ${freq})\n` +
          `${indent}for i in range(waves):\n` +
          `${indent}  GPIO.output(${pin}, True)\n` +
          `${indent}  time.sleep(halveWaveTime)\n` +
          `${indent}  GPIO.output(${pin}, False)\n` +
          `${indent}  time.sleep(halveWaveTime)\n`;
        const pwm = (indent) =>
          `${indent}buzzer.start(${volume})\n` +
          `${indent}time.sleep(${second})\n` +
          `${indent}buzzer.stop()\n`;

        if (playType === "1" || playType === "2") {
          if (playType === "2") provide("gpio_buzzer_loop", "buzzerLoop = True");
          provide("threading", "from threading import Thread");
          let code = setup + (withVolume ? `buzzer = GPIO.PWM(${pin}, 440)\n` : "");
          code += `def ${thread}():\n`;
          if (playType === "2") {
            code += "  global buzzerLoop\n  while buzzerLoop:\n";
            code += withVolume ? pwm("    ") : wave("    ");
          } else {
            code += withVolume ? pwm("  ") : wave("  ");
          }
          return code + `Thread(target = ${thread}).start()\n`;
        }
        if (withVolume) return setup + `buzzer = GPIO.PWM(${pin}, ${freq})\n` + pwm("");
        return setup + wave("");
      };
      pyGen.forBlock["play_note_simple"] = (b) => pyBuzzer(b, "NOTE", false);
      pyGen.forBlock["play_tone_simple"] = (b) => pyBuzzer(b, "TONE", false);
      pyGen.forBlock["play_note_volume"] = (b) => pyBuzzer(b, "NOTE", true);
      pyGen.forBlock["play_tone_volume"] = (b) => pyBuzzer(b, "TONE", true);
      pyGen.forBlock["stop_buzzer"] = () => "buzzerLoop = False\n";

      // Color sensor. The reference editor swaps the reflected and ambient
      // methods; each block here calls its own.
      pyGen.forBlock["color_name"] = () => {
        provideColorSensor();
        return ["ColorSensor().getColorName()", PY_NONE];
      };
      pyGen.forBlock["color_reflected_light"] = () => {
        provideColorSensor();
        return ["ColorSensor().getReflectedLight()", PY_NONE];
      };
      pyGen.forBlock["color_ambient_light"] = () => {
        provideColorSensor();
        return ["ColorSensor().getAmbientLight()", PY_NONE];
      };
      // 'red' -> "Red", the reference editor's color names.
      const pyColorName = (b) => {
        const name = b.getFieldValue("COLOR").replace(/'/g, "");
        return `"${name.charAt(0).toUpperCase()}${name.slice(1)}"`;
      };
      pyGen.forBlock["color_dropdown"] = (b) => [pyColorName(b), PY_NONE];
      pyGen.forBlock["wait_until_color"] = (b) => {
        provideColorSensor();
        return `while True:\n  if ColorSensor().getColorName() == ${pyColorName(b)}:\n    break\n`;
      };

      // Button sensor
      pyGen.forBlock["return_button_value"] = (b) => {
        const pin = port(b, "BUTTON");
        provideButton(pin);
        return [`GPIO.input(${pin})`, PY_NONE];
      };
      pyGen.forBlock["wait_until_button"] = (b) => {
        const pin = port(b, "BUTTON");
        provideButton(pin);
        const pressed = b.getFieldValue("STATE") === "PRESSED" ? 1 : 0;
        return `while True:\n  if GPIO.input(${pin}) == ${pressed}:\n    break\n`;
      };

      // Ultrasonic sensor
      pyGen.forBlock["get_ultrasonic_distance"] = (b) => {
        provide("import_rpi_ultrasonic_sensor", "from hat.UltrasonicRanger import UltrasonicRanger");
        return [`UltrasonicRanger(${port(b, "PORT")}).get_distance()`, PY_NONE];
      };
      pyGen.forBlock["wait_until_distance"] = (b) => {
        const distance = value(b, "DISTANCE");
        provide("import_rpi_ultrasonic_sensor", "from hat.UltrasonicRanger import UltrasonicRanger");
        const op = PY_COMPARE[b.getFieldValue("OP")];
        return (
          `while True:\n  if UltrasonicRanger(${port(b, "PORT")}).get_distance()` +
          `${op}${distance}:\n    break\n`
        );
      };

      // Gyro sensor
      const gyroRead = (b) => {
        const axis = b.getFieldValue("AXIS").toLowerCase();
        return `GyroSensor.read_gyro()['${axis}'] - gyro_${axis}`;
      };
      pyGen.forBlock["get_gyro_angle"] = (b) => {
        provideGyro(false);
        return [gyroRead(b), PY_NONE];
      };
      pyGen.forBlock["wait_until_gyro"] = (b) => {
        const angle = value(b, "ANGLE", PY_ATOMIC);
        provideGyro(false);
        const op = PY_COMPARE[b.getFieldValue("OP")];
        return `while True:\n  if (${gyroRead(b)})${op}${angle}:\n    break\n`;
      };
      pyGen.forBlock["reset_gyro"] = () => {
        provideGyro(true);
        return ["x", "y", "z"]
          .map((axis) => `gyro_${axis} = GyroSensor.read_gyro()['${axis}']\n`)
          .join("");
      };

      // Loops and comments
      pyGen.forBlock["forever_loop"] = (b) => {
        let branch = pyGen.statementToCode(b, "DO");
        branch = pyGen.addLoopTrap(branch, b) || pyGen.PASS;
        return `while True:\n${branch}`;
      };
      pyGen.forBlock["break_loop"] = () => "break\n";
      pyGen.forBlock["line_comment"] = (b) =>
        `#${b.getFieldValue("TEXT").replace(/\n/g, "\n#")}\n`;
      pyGen.forBlock["project_description"] = () => "";
    }

    workspaceRef.current = Blockly.inject(blocklyDivRef.current, {
      toolbox: TOOLBOX_XML,
      // geras is the bevelled renderer the reference GroveHat editor uses.
      renderer: "geras",
      scrollbars: true,
      zoom: {
        controls: true,
        wheel: true,
        startScale: 1.0,
        maxScale: 3,
        minScale: 0.3,
        scaleSpeed: 1.2,
      },
      // Plain white workspace like the reference; the hidden grid still snaps.
      grid: { spacing: 20, length: 3, colour: "transparent", snap: true },
    });
    const updateCode = () => {
      if (Blockly.JavaScript) {
        Blockly.JavaScript.addReservedWords("code");
        try {
          // Dynamically override controls_flow_statements instances to support forever_loop
          workspaceRef.current.getAllBlocks(false).forEach((block) => {
            if (block.type === 'controls_flow_statements' && !block._customOnChange) {
              block._customOnChange = true;
              block.onchange = function(event) {
                if (!this.workspace || (this.workspace.isDragging && this.workspace.isDragging())) {
                  return; // Don't change state during drags.
                }
                let legal = false;
                let parent = this;
                do {
                  if (parent.type === 'forever_loop' ||
                      parent.type === 'controls_repeat' ||
                      parent.type === 'controls_repeat_ext' ||
                      parent.type === 'controls_forEach' ||
                      parent.type === 'controls_for' ||
                      parent.type === 'controls_whileUntil') {
                    legal = true;
                    break;
                  }
                  parent = parent.getSurroundParent();
                } while (parent);

                if (legal) {
                  this.setWarningText(null);
                  if (!this.isInFlyout) {
                    this.setEnabled(true);
                  }
                } else {
                  this.setWarningText(window.Blockly.Msg['CONTROLS_FLOW_STATEMENTS_WARNING_IF_NOT_IN_LOOP'] || "This block may only be used within a loop.");
                  if (!this.isInFlyout && !this.isBadConnection()) {
                    this.setEnabled(false);
                  }
                }
              };
              block.onchange();
            }
          });

          const code = Blockly.JavaScript.workspaceToCode(workspaceRef.current);
          setGeneratedCode(makeProceduresAsync(code));

          // --- Python code generation ---
          if (Blockly.Python) {
            const pyGen = Blockly.Python;
            try {
              const pyCode = pyGen.workspaceToCode(workspaceRef.current);
              setPythonCode(pyCode);
            } catch (pyErr) {
              console.warn('Python code generation skipped:', pyErr.message);
            }
          }
        } catch (err) {
          // Don't let a transient codegen error (e.g. a dynamic block whose
          // shape hasn't finished updating) abort the workspace's change
          // cycle, otherwise other listeners (visual re-render, etc.) won't
          // run. The next change event will produce valid code.
          console.warn("Code generation skipped:", err.message);
        }
      }
    };
    workspaceRef.current.addChangeListener(updateCode);
    updateCodeRef.current = updateCode;
    workspaceRef.current.addChangeListener((event) => {
      if (!event.isUiEvent) keepWorkspaceDraft();
    });
    setIsWorkspaceReady(true);

    // --- Override Blockly.prompt / Blockly.dialog.setPrompt with a styled React modal ---
    const customPrompt = (message, defaultVal, callback) => {
      setVarModal({ message, defaultVal: defaultVal || '', callback });
    };

    if (Blockly.dialog && Blockly.dialog.setPrompt) {
      Blockly.dialog.setPrompt(customPrompt);
    }
    Blockly.prompt = customPrompt;

    // Load Blockly XML from preview snippet if in preview mode
    const params = new URLSearchParams(window.location.search);
    if (params.get('previewMode') === 'true') {
      const snippetData = sessionStorage.getItem('previewSnippet');
      console.log('Preview mode detected, snippet data:', snippetData ? 'found' : 'not found');
      if (snippetData) {
        const snippet = JSON.parse(snippetData);
        console.log('Preview snippet:', { 
          hasBlocklyXml: !!snippet.blocklyXml, 
          blocklyXmlLength: snippet.blocklyXml?.length,
          hasCode: !!snippet.code,
          title: snippet.title 
        });
        
        // Load Blockly blocks if available - use setTimeout to ensure Blockly is fully ready
        if (snippet.blocklyXml && workspaceRef.current) {
          setTimeout(() => {
            try {
              const Blockly = window.Blockly;
              // Use Blockly.utils.xml (lowercase) for newer Blockly versions
              const xmlUtils = Blockly.utils?.xml || Blockly.Xml;
              if (Blockly && xmlUtils && xmlUtils.textToDom) {
                console.log('Loading Blockly XML into workspace...');
                // Clear existing blocks first
                workspaceRef.current.clear();
                const xml = migrateLegacyShadowInputsXml(
                  migrateLegacyBuzzerXml(xmlUtils.textToDom(snippet.blocklyXml))
                );
                // Use Blockly.Xml.domToWorkspace if available, otherwise try serialization
                if (Blockly.Xml && Blockly.Xml.domToWorkspace) {
                  Blockly.Xml.domToWorkspace(xml, workspaceRef.current);
                } else if (Blockly.serialization && Blockly.serialization.workspaces) {
                  // Newer Blockly uses serialization API
                  Blockly.serialization.workspaces.load(
                    Blockly.Xml.workspaceToDom ? null : JSON.parse(snippet.blocklyXml),
                    workspaceRef.current
                  );
                }
                console.log('Blockly XML loaded successfully');
              } else {
                console.error('Blockly XML utils not available:', { 
                  hasBlockly: !!Blockly, 
                  hasUtils: !!Blockly?.utils,
                  hasXml: !!xmlUtils 
                });
              }
            } catch (e) {
              console.error('Error loading Blockly XML:', e);
            }
          }, 500); // Give Blockly time to fully initialize
        } else {
          console.log('Cannot load Blockly XML:', { 
            hasXml: !!snippet.blocklyXml, 
            hasWorkspace: !!workspaceRef.current 
          });
        }
        // Also set the generated code directly (in case blocks don't load)
        if (snippet.code) {
          setGeneratedCode(snippet.code);
        }
      }
    }

    resetSimulation();
  }, [isBlocklyLoaded, resetSimulation]);

  // --- Post-process Blockly's generated JS so user-defined procedures
  // (Functions category) become async, and all call sites of those procedures
  // are awaited. Blockly's stock JavaScript generator emits sync `function`s,
  // but our robot blocks emit `await ...` for motor/wait/LCD/buzzer — without
  // this, calling a Blockly Function that uses any of them throws a
  // SyntaxError ("await is only valid in async functions...").
  // Idempotent: safe to call multiple times on the same code.
  const makeProceduresAsync = (code) => {
    if (!code || typeof code !== "string") return code || "";

    // Find all top-level (non-nested) function declarations: `function NAME(...)`.
    // Blockly emits them at module top-level, prefixed only by `async ` if we
    // already processed them.
    const fnNameRegex = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
    const names = new Set();
    let m;
    while ((m = fnNameRegex.exec(code)) !== null) {
      names.add(m[1]);
    }

    let out = code;

    // 1) Rewrite each `function NAME(` to `async function NAME(` (only at line
    //    starts, only if not already async).
    out = out.replace(
      /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm,
      (full, name) => `async function ${name}(`
    );

    // 2) Await calls to those procedures. Be careful not to:
    //    - re-await something already awaited (`await foo(`)
    //    - touch the function declaration itself (`function foo(`)
    //    - touch property accesses (`obj.foo(`)
    //    - touch other identifiers that happen to share a name
    if (names.size > 0) {
      const namePattern = Array.from(names)
        .map((n) => n.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"))
        .join("|");
      // Negative-lookbehind for `await `, `.`, `function `, and word chars.
      // Match either start-of-line or any non-word/non-dot char before the name.
      const callRegex = new RegExp(
        `(^|[^\\w$.])(?<!await\\s)(?<!function\\s)(${namePattern})(\\s*\\()`,
        "g"
      );
      out = out.replace(callRegex, (full, pre, name, post) => {
        return `${pre}await ${name}${post}`;
      });
    }

    return out;
  };

  // --- Run Code Logic ---
  const runCode = async () => {
    if (isRunning.current) return;
    resetSimulation();
    setActiveTab("robot"); // Switch to Robot tab to see output
    isRunning.current = true;
    window._blocklySimulationActive = true;
    logToConsole("Program Started...");

    try {
      const scope = {
        move,
        moveIndefinitely,
        stopMoving,
        wait,
        getUltrasonicDistance,
        getColorSensor,
        getReflectedLightIntensity,
        getAmbientLightIntensity,
        isButtonPressed,
        getGyroAngle,
        resetGyro,
        getTimerValue,
        resetTimer,
        lcdPrint,
        lcdClear,
        lcdPrintForDuration,
        playTone,
        playBuzzer,
        playNote,
        stopAllTones,
        waitUntilButton,
        logToConsole,
        isRunning,
      };

      const keys = Object.keys(scope);
      const values = Object.values(scope);

      const wrappedCode = `
                return (async () => { 
                    try { 
                        ${generatedCode} 
                        logToConsole("Program Ended.");
                    } catch(e) { 
                        if (e.message !== "Simulation stopped") {
                            logToConsole("Error: " + e.message); 
                            console.error(e);
                        } else {
                            logToConsole("Program Stopped.");
                        }
                    } finally {
                        isRunning.current = false;
                        window._blocklySimulationActive = false;
                    }
                })();
            `;

      const fn = new Function(...keys, wrappedCode); // eslint-disable-line no-new-func
      await fn(...values);
    } catch (e) {
      logToConsole("System Error: " + e.message);
      isRunning.current = false;
      window._blocklySimulationActive = false;
    }
  };

  // Keyboard support for button sensors (A=D18, S=D22, D=D24)
  useEffect(() => {
    const keyToButton = { a: 'D18', s: 'D22', d: 'D24' };

    const handleKeyDown = (e) => {
      // Ignore keypresses if the user is typing in an input or textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }
      const btn = keyToButton[e.key.toLowerCase()];
      if (btn && !e.repeat) {
        buttonStates.current[btn] = true;
        setUiPressedButtons(prev => ({ ...prev, [btn]: true }));
      }
    };

    const handleKeyUp = (e) => {
      const btn = keyToButton[e.key.toLowerCase()];
      if (btn) {
        buttonStates.current[btn] = false;
        setUiPressedButtons(prev => ({ ...prev, [btn]: false }));
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, []);

  // Resize and tracked size handler
  useEffect(() => {
    const handleResize = () => {
      if (workspaceRef.current) {
        window.Blockly.svgResize(workspaceRef.current);
      }
      fitRobotToMap();
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeTab, fitRobotToMap]);

  // Effect to update positions on initial load or reset
  useEffect(() => {
    updateConesPosition();
  }, [cones, updateConesPosition]);

  // Measure the map again once the Robot tab has finished laying out
  useEffect(() => {
    if (activeTab === "robot") {
      const timer = setTimeout(fitRobotToMap, 50);
      return () => clearTimeout(timer);
    }
  }, [activeTab, fitRobotToMap]);

  const currentChallenge = challenges[currentChallengeIndex];
  const stepId = previewSnippet?.ackKey?.includes('--') ? previewSnippet.ackKey.split('--')[1] : null;
  const targetChallengeId = stepId ? `${previewSnippet.challengeId}_step_${stepId}` : previewSnippet?.challengeId;
  const needsRevision = !!(
    previewSnippet &&
    currentChallenge &&
    (stepId
      ? (currentChallenge.id === targetChallengeId)
      : (currentChallenge.id === previewSnippet.id ||
         currentChallenge.id === previewSnippet.challengeId ||
         (currentChallenge.id.includes('_step_') && currentChallenge.id.split('_step_')[0] === previewSnippet.challengeId)))
  );

  return (
    <div className="flex flex-col h-screen bg-gray-100 text-gray-800 font-sans">
      {/* Preview Mode Banner */}
      {previewSnippet && (
        <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <span className="font-bold">📋 Review Preview</span>
            <span className="text-amber-200">|</span>
            <span>
              <strong className="capitalize">{previewSnippet.username || 'Unknown'}</strong>'s submission: <strong>{previewSnippet.title}</strong>
            </span>
            {previewSnippet.levelName && (
              <>
                <span className="text-amber-200">|</span>
                <span className="text-amber-100">{previewSnippet.levelName}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(currentUser?.role === 'admin' || currentUser?.role === 'trainer') && (
              <>
                <button
                  onClick={() => handleReviewAction('approved')}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded text-sm transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <CheckCircle size={14} />
                  Approve Submission
                </button>
                <button
                  onClick={() => handleReviewAction('needs_revision')}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded text-sm transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <AlertCircle size={14} />
                  Request Revision
                </button>
              </>
            )}
            <button
              onClick={() => {
                sessionStorage.removeItem('previewMode');
                sessionStorage.removeItem('previewSnippet');
                sessionStorage.removeItem('reviewPreview');
                window.close();
              }}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 rounded text-sm font-medium transition-colors"
            >
              Close Preview
            </button>
          </div>
        </div>
      )}

      {/* Header with Home Button */}
      <div className="relative h-12 bg-slate-900 text-white flex items-center justify-between px-4 shadow-md z-20 shrink-0">
        <div className="flex items-center">
          <button
            onClick={() => window.close()}
            className="flex items-center gap-2 text-slate-300 hover:text-white hover:bg-slate-800 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Home size={18} />
            <span className="font-medium text-sm">Home</span>
          </button>
          <div className="ml-4 h-6 w-px bg-slate-700"></div>
          <span className="ml-4 font-semibold text-sm tracking-wide">Blockly Robot Simulator</span>
        </div>

        {/* Question menu: picks a block-code or flowchart question */}
        {challenges.length > 0 && (
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
            <label htmlFor="question-select" className="text-xs font-medium text-slate-400">Question</label>
            <div className="relative">
              <select
                id="question-select"
                value={currentChallengeIndex}
                onChange={(e) => handleSelectQuestion(Number(e.target.value))}
                className="appearance-none bg-slate-800 hover:bg-slate-700 border border-slate-700 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 text-white text-xs font-semibold rounded-md pl-3 pr-8 py-1.5 max-w-[22rem] truncate cursor-pointer transition-colors"
              >
                {challenges.map((challenge, index) => (
                  <option key={challenge.id} value={index} className="bg-slate-800 text-white">
                    {`Q${index + 1} · ${isFlowchartStep(challenge.description) ? 'Flowchart' : 'Block code'} — ${challenge.challengeName}`}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
        )}

        {/* Compact Simulator Controls */}
        <div className="flex items-center gap-2">
          {isFlowchartChallenge ? (
            <button
              onClick={handleCheckFlowchart}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
            >
              <ListChecks size={14} />
              Check Flowchart
            </button>
          ) : (
            <>
              <button
                onClick={runCode}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
              >
                <Play size={14} fill="currentColor" />
                Run Program
              </button>
              <button
                onClick={resetSimulation}
                className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
              >
                <Square size={14} fill="currentColor" />
                Reset / Stop
              </button>
            </>
          )}
          {challenges.length > 0 && (
            <button
              onClick={handleSaveProgress}
              disabled={saving || submitting}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
            >
              <Save size={14} />
              {saving ? 'Saving...' : 'Save Progress'}
            </button>
          )}
          {currentUser?.role === 'teacher' && challenges.length > 0 && (progressLoadFailed ? (
            <button
              onClick={() => setProgressLoadAttempt((attempt) => attempt + 1)}
              title="Your completed steps didn't load, so Submit is paused: submitting now could lose them. Try again, or reload the page."
              className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
            >
              <RotateCcw size={14} />
              Progress didn't load: Retry
            </button>
          ) : (
            <button
              onClick={handleSubmitChallenge}
              disabled={submitting || checkingTests || !isProgressLoaded}
              title={isProgressLoaded ? undefined : 'Loading your completed steps...'}
              className="bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow transition-colors flex items-center gap-1.5"
            >
              <Send size={14} />
              {!isProgressLoaded
                ? 'Loading progress...'
                : checkingTests
                  ? 'Checking...'
                  : submitting
                    ? 'Submitting...'
                    : needsRevision
                      ? 'Resubmit Challenge'
                      : completedChallenges.includes(currentChallenge?.id)
                        ? 'Revise & Resubmit'
                        : 'Submit Challenge'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-grow overflow-hidden">
        {/* Blockly Workspace */}
        <div className="w-[55%] h-full border-r border-gray-300 relative">
          {!isBlocklyLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
              Loading Blockly...
            </div>
          )}
          <div
            ref={blocklyDivRef}
            className="absolute inset-0 blockly-div"
            onMouseDown={(e) => {
              // Ensure clicking the background closes the Flyout/Trashcan popups
              const target = e.target;
              const isBackground =
                target === blocklyDivRef.current ||
                (target.classList &&
                  target.classList.contains("blocklyMainBackground")) ||
                (target.getAttribute &&
                  target.getAttribute("class") === "blocklySvg");

              if (isBackground && window.Blockly) {
                window.Blockly.hideChaff();
              }
            }}
          />
          {/* Flowchart steps draw over the canvas; Blockly stays mounted underneath.
              z-[80] puts it above Blockly's category list (z-index 70). */}
          {isFlowchartChallenge && (
            <div className="absolute inset-0 z-[80]">
              <FlowchartEditor
                chart={flowchart}
                onChange={handleFlowchartChange}
                readOnly={isPreviewChallenge(currentChallenge)}
                light
                errorNodeId={flowchartCheck?.result.problems.find((p) => p.nodeId)?.nodeId || null}
                fitKey={flowchartKey}
              />
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div className="w-[45%] h-full flex flex-col bg-gray-200">
          {/* Tabs */}
          <div className="flex border-b border-gray-300 bg-white">
            {["task", "robot", "console", "python"].map((tab) => {
              if (tab === "task" && challenges.length === 0) return null;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`py-2 px-4 border-b-2 capitalize transition-colors ${activeTab === tab
                    ? "border-blue-500 text-blue-600 font-bold bg-blue-50"
                    : "border-transparent hover:bg-gray-50"
                    }`}>
                  {tab}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <div className="flex-grow flex flex-col overflow-hidden">
            {/* Task View */}
            <div
              className={`${activeTab === "task"
                ? "flex-grow bg-white p-6 overflow-y-auto"
                : "hidden"
                }`}>
              {challenges.length > 0 ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                      <BookOpen size={20} className="text-blue-500" />
                      {challenges[currentChallengeIndex].challengeName}
                    </h2>
                    <div className="flex items-center gap-3">
                      {/* Completion Status */}
                      {completedChallenges.includes(challenges[currentChallengeIndex]?.id) && (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                          <CheckCircle size={14} />
                          Completed
                        </span>
                      )}
                      {/* Admin/Trainer Reset Button */}
                      {(currentUser?.role === 'admin' || currentUser?.role === 'trainer') && (
                        <button
                          onClick={handleResetProgress}
                          disabled={resettingProgress}
                          className="flex items-center gap-1 text-xs text-red-600 bg-red-50 hover:bg-red-100 px-2 py-1 rounded-full transition-colors disabled:opacity-50"
                          title="Reset all progress for this level">
                          <RotateCcw size={14} className={resettingProgress ? 'animate-spin' : ''} />
                          {resettingProgress ? 'Resetting...' : 'Reset Progress'}
                        </button>
                      )}
                      <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                        {(currentUser?.role === 'admin' || currentUser?.role === 'trainer') && (
                          <button
                            disabled={currentChallengeIndex === 0}
                            onClick={() => setCurrentChallengeIndex(0)}
                            className="p-1 rounded hover:bg-white disabled:opacity-30 transition-all"
                            title="First Question">
                            <ChevronsLeft size={18} />
                          </button>
                        )}
                        <button
                          disabled={currentChallengeIndex === 0}
                          onClick={() => setCurrentChallengeIndex((prev) => prev - 1)}
                          className="p-1 rounded hover:bg-white disabled:opacity-30 transition-all">
                          <ChevronLeft size={18} />
                        </button>
                        <span className="text-xs font-medium text-slate-500 min-w-[3rem] text-center">
                          {currentChallengeIndex + 1} / {challenges.length}
                        </span>
                        <button
                          disabled={currentChallengeIndex === challenges.length - 1 || !isChallengeUnlocked(currentChallengeIndex + 1)}
                          onClick={() => setCurrentChallengeIndex((prev) => prev + 1)}
                          className="p-1 rounded hover:bg-white disabled:opacity-30 transition-all"
                          title={!isChallengeUnlocked(currentChallengeIndex + 1) ? "Complete current challenge first" : ""}>
                          {isChallengeUnlocked(currentChallengeIndex + 1) ? (
                            <ChevronRight size={18} />
                          ) : (
                            <Lock size={16} className="text-slate-400" />
                          )}
                        </button>
                        {(currentUser?.role === 'admin' || currentUser?.role === 'trainer') && (
                          <button
                            disabled={currentChallengeIndex === challenges.length - 1}
                            onClick={() => setCurrentChallengeIndex(challenges.length - 1)}
                            className="p-1 rounded hover:bg-white disabled:opacity-30 transition-all"
                            title="Last Question">
                            <ChevronsRight size={18} />
                          </button>
                        )}
                      </div>
                      {/* Jump to Last Progress button — admin, trainer, instructor */}
                      {(currentUser?.role === 'admin' || currentUser?.role === 'trainer' || currentUser?.role === 'teacher') && (
                        <button
                          onClick={() => setCurrentChallengeIndex(getLastProgressIndex())}
                          disabled={currentChallengeIndex === getLastProgressIndex()}
                          className="flex items-center gap-1 text-xs text-violet-600 bg-violet-50 hover:bg-violet-100 px-2.5 py-1 rounded-full transition-colors disabled:opacity-40 disabled:cursor-default"
                          title={`Jump to last progress (Challenge ${getLastProgressIndex() + 1})`}>
                          <ChevronsRight size={14} />
                          <span className="font-medium">Last Progress</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="prose prose-sm max-w-none text-slate-600">
                    {/* Handle both HTML string and plain text description */}
                    {challenges[currentChallengeIndex].description?.includes('<') ? (
                      <ZoomableHtml html={sanitizeHtml(challenges[currentChallengeIndex].description)} />
                    ) : (
                      <p className="whitespace-pre-wrap">{challenges[currentChallengeIndex].description}</p>
                    )}
                  </div>

                  {challenges[currentChallengeIndex].hint && (
                    <div className="p-4 bg-blue-50 text-blue-800 rounded-lg text-sm border border-blue-100">
                      <strong className="block mb-1">Hint:</strong>
                      {challenges[currentChallengeIndex].hint}
                    </div>
                  )}

                  {isFlowchartChallenge && (
                    <div className="space-y-5">
                      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-semibold text-slate-800 text-sm">Flowchart check</h3>
                          <button
                            onClick={handleCheckFlowchart}
                            className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-full transition-colors">
                            <ListChecks size={14} />
                            Check Flowchart
                          </button>
                        </div>
                        {flowchartCheck ? (
                          <>
                            <p className="text-xs text-slate-500">
                              {flowchartCheck.result.compared
                                ? `Compared with your ${previousChallenge?.challengeName || 'previous step'} blocks: ${describeBlocks(flowchartCheck.result.blocks)}.`
                                : "Your previous step's blocks weren't found, so only the drawing was checked."}
                            </p>
                            <ul className="space-y-2">
                              {flowchartCheck.result.items.map((item) => (
                                <li key={item.label} className="text-sm">
                                  <span className={item.ok ? 'text-emerald-700' : 'text-rose-700 font-medium'}>
                                    {item.ok ? '✅' : '❌'} {item.label}
                                  </span>
                                  {item.details.map((detail) => (
                                    <p key={detail} className="ml-6 text-xs text-slate-600">{detail}</p>
                                  ))}
                                </li>
                              ))}
                            </ul>
                            {flowchartCheck.result.ok ? (
                              <p className="text-sm text-emerald-700">Your flowchart matches your blocks. Submit it for review.</p>
                            ) : flowchartCheck.blockedSubmit && currentUser?.role === 'teacher' && (
                              <p className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                                Fix the items marked ❌ and submit again. The next step unlocks once the flowchart passes.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-slate-500">
                            Draw the flowchart on the left, then click Check Flowchart to compare its decisions, loops and actions
                            with your blocks from {previousChallenge?.challengeName || 'the previous step'}. Submit runs the same check.
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <h3 className="font-semibold text-slate-800 text-sm">
                          {previewSnippet ? 'Their' : 'Your'} blocks from {previousChallenge?.challengeName || 'the previous step'}
                        </h3>
                        {previousBlocksXml && isWorkspaceReady && activeTab === 'task' ? (
                          <ReadOnlyBlocks xml={previousBlocksXml} mainWorkspaceRef={workspaceRef} />
                        ) : (
                          <p className="text-xs text-slate-500 italic">
                            {previewSnippet
                              ? "This instructor hasn't submitted the previous step."
                              : 'Submit or save the previous step to see its blocks here.'}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {!isFlowchartChallenge && currentTests.length > 0 && (
                    <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="font-semibold text-slate-800 text-sm">Auto-check</h3>
                        <button
                          onClick={handleCheckProgram}
                          disabled={checkingTests}
                          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 px-2.5 py-1 rounded-full transition-colors">
                          <ListChecks size={14} />
                          {checkingTests ? 'Checking...' : 'Check Program'}
                        </button>
                      </div>
                      {testCheck ? (
                        <>
                          <ul className="space-y-2">
                            {testCheck.results.map((result, i) => (
                              <li key={`${result.name}-${i}`} className="text-sm">
                                <span className={result.passed ? 'text-emerald-700' : 'text-rose-700 font-medium'}>
                                  {result.passed ? '✅' : '❌'} {result.name || `Test ${i + 1}`}
                                </span>
                                <p className="ml-6 text-xs text-slate-500">{describeScenario(currentTests[i]?.scenario)}</p>
                                {!result.passed && <p className="ml-6 text-xs text-slate-700 whitespace-pre-wrap">{result.message}</p>}
                              </li>
                            ))}
                          </ul>
                          {testCheck.results.every((r) => r.passed) ? (
                            <p className="text-sm text-emerald-700">Your program passes every check. Submit it for review.</p>
                          ) : testCheck.blockedSubmit && currentUser?.role === 'teacher' && (
                            <p className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                              Fix what's marked ❌ and submit again. The next step unlocks once every check passes.
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-slate-500">
                          Submit runs your program in a quick simulation: it presses the buttons and sets the sensors as listed
                          below, then compares the LCD, sounds and motors with what this step asks for. Click Check Program to try it first.
                        </p>
                      )}
                      {!testCheck && (
                        <ul className="space-y-1">
                          {currentTests.map((test, i) => (
                            <li key={`${test.name}-${i}`} className="text-xs text-slate-600">
                              <span className="font-medium">{test.name || `Test ${i + 1}`}:</span> {describeScenario(test.scenario)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {!isFlowchartChallenge && isStaff && !previewSnippet && (
                    <BlocklyTestEditor
                      key={currentChallenge?.id}
                      tests={currentTests}
                      onRecordAndSave={handleRecordAndSaveTests}
                      onCheckSavedAnswers={handleCheckSavedAnswers}
                      busy={checkingTests}
                    />
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <BookOpen size={48} className="mb-4 opacity-20" />
                  <p>No challenges loaded for this level.</p>
                </div>
              )}
            </div>

            {/* Robot Simulation View */}
            <div
              className={`${activeTab === "robot"
                ? "flex-grow flex flex-col p-4 space-y-4"
                : "hidden"
                }`}>
              {/* Toolbar (Cone, Trash) */}
              <div className="bg-gray-300 rounded p-2 flex justify-between items-center shadow-inner">
                <div
                  className="cursor-grab hover:scale-105 transition-transform"
                  title="Drag new cone"
                  onMouseDown={handleToolbarConeMouseDown}>
                  <ConeIcon className="w-10 h-10" />
                </div>
                <div
                  className="cursor-pointer hover:text-red-500 text-green-400"
                  title="Clear All (Reset)"
                  ref={trashRef}
                  onClick={clearAllCones}>
                  <TrashIcon className="w-8 h-8" />
                </div>
              </div>

              {/* Canvas Area */}
              <div
                ref={simulationAreaRef}
                className="flex-grow bg-[#D1D5DB] rounded-lg relative overflow-hidden shadow-inner border-2 border-gray-400 select-none">
                {/* Scaled World Wrapper */}
                <div
                  style={{
                    transform: `scale(${zoom})`,
                    transformOrigin: "center center",
                    width: "100%",
                    height: "100%",
                  }}>
                  {/* Dotted Grid Background (Inside wrapper to scale) */}
                  <div
                    className="absolute inset-0 opacity-40"
                    style={{
                      backgroundImage:
                        "radial-gradient(#555 1.5px, transparent 1.5px)",
                      backgroundSize: "20px 20px",
                      width: "200%", // Extend background for zoom
                      height: "200%",
                      left: "-50%", // Center the background pattern expansion
                      top: "-50%",
                    }}></div>

                  <div
                    ref={colorPatchContainerRef}
                    className="absolute inset-0 pointer-events-none"></div>

                  {/* Robot: Blue Body with Wheels */}
                  <div
                    ref={robotRef}
                    className="absolute w-10 h-10 transition-transform duration-75 z-10 flex items-center justify-center">
                    <div className="relative w-full h-full bg-[#4285F4] rounded-sm shadow-sm flex justify-center items-center">
                      {/* Left Wheel */}
                      <div className="absolute -left-1 top-1 w-2 h-8 bg-gray-800 rounded-sm"></div>
                      {/* Right Wheel */}
                      <div className="absolute -right-1 top-1 w-2 h-8 bg-gray-800 rounded-sm"></div>
                      {/* Front Indicator */}
                      <div className="absolute -top-1 w-2 h-2 bg-orange-500 rounded-full"></div>
                      {/* Center Detail */}
                      <div className="w-4 h-6 bg-blue-700 rounded-sm opacity-50"></div>
                    </div>
                  </div>

                  {/* Draggable Cones */}
                  {cones.map((cone) => (
                    <div
                      key={cone.id}
                      ref={(el) => {
                        if (el) coneDomRefs.current[cone.id] = el;
                        // Initialize position
                        const data = conesDataRef.current.find(
                          (c) => c.id === cone.id
                        );
                        if (el && data) {
                          el.style.left = `${data.x}px`;
                          el.style.top = `${data.y}px`;
                        }
                      }}
                      onMouseDown={(e) => handleConeMouseDown(e, cone.id)}
                      className="absolute w-12 h-12 z-20 cursor-grab hover:scale-105 transition-transform -ml-6 -mt-6">
                      <ConeIcon className="w-full h-full drop-shadow-md" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Controls: Color, LCD, Data */}
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-gray-500 font-bold px-1">
                  <div className="flex items-center gap-2">
                    <span>FLASH COLOUR</span>
                    <div className="flex gap-[1px]">
                      {[...Array(8)].map((_, i) => (
                        <div key={i} className="w-1 h-3 bg-gray-400"></div>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>SCALE</span>
                    <input
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={zoom}
                      onChange={(e) => setZoom(parseFloat(e.target.value))}
                      className="w-16 h-1 bg-blue-500 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-[auto_1fr] gap-6">
                  {/* Left: Inputs */}
                  <div className="space-y-4">
                    {/* Color Pickers */}
                    <div className="flex gap-2">
                      {["black", "white", "gray", "white"].map((c, i) => (
                        <div
                          key={i}
                          className={`w-6 h-6 rounded-full border-2 border-gray-300 ${c === "black" ? "bg-gray-800" : "bg-white"
                            } ${i === 3 ? "border-dashed" : ""}`}></div>
                      ))}
                    </div>

                    {/* Large Colors */}
                    <div className="flex gap-2">
                      {["white", "red", "orange", "green", "blue"].map((c) => (
                        <div
                          key={c}
                          className={`w-8 h-12 rounded-full border-2 border-white shadow-sm cursor-pointer hover:scale-105 transition-transform ${uiSelectedColor === c ? "ring-2 ring-blue-500" : ""
                            }`}
                          style={{
                            backgroundColor: c === "white" ? "#fff" : c,
                          }}
                          onClick={() => selectColor(c)}></div>
                      ))}
                    </div>

                    {/* Buttons */}
                    <div>
                      <div className="text-[10px] text-gray-500 font-bold mb-1">
                        CLICK BUTTONS
                      </div>
                      <div className="flex gap-3">
                        {[
                          { id: "D18", label: "A" },
                          { id: "D22", label: "S" },
                          { id: "D24", label: "D" },
                        ].map((btn) => (
                          <div
                            key={btn.id}
                            className="flex flex-col items-center">
                            <button
                              onMouseDown={() => {
                                buttonStates.current[btn.id] = true;
                                setUiPressedButtons(prev => ({ ...prev, [btn.id]: true }));
                              }}
                              onMouseUp={() => {
                                buttonStates.current[btn.id] = false;
                                setUiPressedButtons(prev => ({ ...prev, [btn.id]: false }));
                              }}
                              onMouseLeave={() => {
                                buttonStates.current[btn.id] = false;
                                setUiPressedButtons(prev => ({ ...prev, [btn.id]: false }));
                              }}
                              className={`w-10 h-10 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-600 transition-all ${
                                uiPressedButtons[btn.id] 
                                  ? "bg-gray-400 shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)]" 
                                  : "bg-gray-300 shadow-[inset_0_-2px_4px_rgba(0,0,0,0.2)] active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.2)] active:bg-gray-400"
                              }`}>
                              {btn.id}
                            </button>
                            <span className="text-[10px] text-gray-400 mt-1">
                              {btn.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Right: Display */}
                  <div className="space-y-4">
                    {/* LCD */}
                    <div className="bg-gray-200 p-1">
                      <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] grid-rows-2 gap-[1px] bg-[#3B82F6] border-4 border-[#3B82F6]">
                        {Array.from({ length: 32 }).map((_, i) => (
                          <div
                            key={i}
                            ref={(el) => (lcdCells.current[i] = el)}
                            className="bg-[#1E40AF] text-white aspect-[3/5] flex items-center justify-center font-mono text-[20px] leading-none overflow-hidden select-none">
                            &nbsp;
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Data */}
                    <div className="flex gap-6">
                      <div className="flex flex-col w-20">
                        <span className="text-[10px] text-gray-500 font-bold mb-1">
                          Ultra-D26
                        </span>
                        <div
                          className="bg-[#A0A0A0] h-10 flex items-center px-2 text-2xl font-sans text-[#404040]"
                          ref={ultraValueRef}>
                          0
                        </div>
                      </div>
                      <div className="flex flex-col w-20">
                        <span className="text-[10px] text-gray-500 font-bold mb-1">
                          L-SPEED
                        </span>
                        <div
                          className="bg-[#A0A0A0] h-10 flex items-center px-2 text-2xl font-sans text-[#404040]"
                          ref={lSpeedValueRef}>
                          0
                        </div>
                      </div>
                      <div className="flex flex-col w-20">
                        <span className="text-[10px] text-gray-500 font-bold mb-1">
                          R-SPEED
                        </span>
                        <div
                          className="bg-[#A0A0A0] h-10 flex items-center px-2 text-2xl font-sans text-[#404040]"
                          ref={rSpeedValueRef}>
                          0
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Console View */}
            <div
              className={`${activeTab === "console"
                ? "flex-grow bg-slate-900 text-green-400 p-4 font-mono text-sm overflow-y-auto"
                : "hidden"
                }`}>
              <pre className="whitespace-pre-wrap">
                {consoleOutput || "> Ready..."}
              </pre>
            </div>

            {/* Code View */}
            <div
              className={`${activeTab === "python"
                ? "flex-grow bg-white text-slate-800 p-4 font-mono text-xs overflow-y-auto border-t border-gray-300"
                : "hidden"
                }`}>
              <div className="h-full">
                {activeTab === "python" && (
                  <Editor
                    height="100%"
                    defaultLanguage="python"
                    theme="vs-light"
                    value={pythonCode || "# Drag blocks to generate code..."}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 12,
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      padding: { top: 16, bottom: 16 }
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Controls Footer Removed to expand canvas height */}
        </div>
      </div>
      {/* Custom Variable Name Modal */}
      {varModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 w-80 flex flex-col gap-4"
            style={{ border: '1.5px solid #e2e8f0' }}
          >
            {/* Icon + Title */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm leading-tight">New Variable</p>
                <p className="text-xs text-slate-400 mt-0.5">Enter a name for your variable</p>
              </div>
            </div>

            {/* Input */}
            <input
              id="blockly-var-input"
              type="text"
              defaultValue={varModal.defaultVal}
              autoFocus
              placeholder="e.g. myVariable"
              className="w-full px-3 py-2.5 rounded-xl border-2 border-slate-200 focus:border-violet-500 focus:outline-none text-sm text-slate-800 bg-slate-50 transition-colors"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = document.getElementById('blockly-var-input')?.value?.trim();
                  setVarModal(null);
                  varModal.callback(val || null);
                } else if (e.key === 'Escape') {
                  setVarModal(null);
                  varModal.callback(null);
                }
              }}
            />

            {/* Buttons */}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setVarModal(null); varModal.callback(null); }}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const val = document.getElementById('blockly-var-input')?.value?.trim();
                  setVarModal(null);
                  varModal.callback(val || null);
                }}
                className="px-4 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition-colors shadow-sm"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BlocklyRobotSimulator;
