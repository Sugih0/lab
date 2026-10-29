// Flowchart model and checks for the flowchart steps of the Blockly levels.
//
// A flowchart is { version, nodes: [{ id, type, x, y, text }], edges: [{ id, from, to, branch }] }.
// x/y are the centre of the shape. Decision edges carry branch 'yes' or 'no'.
//
// Shapes hold plain words ("Show 'Get ready' on the LCD for 2 s"), so a
// flowchart is never run. It is checked by comparing its structure (decisions,
// loops, actions) with the Blockly program it describes, never by matching words.

export const FLOWCHART_VERSION = 1;

export const SHAPE_TYPES = ['start', 'input', 'output', 'process', 'decision', 'end'];
const ACTION_SHAPES = new Set(['input', 'output', 'process']);

export const SHAPE_INFO = {
    start: { label: 'Start', placeholder: '', help: 'Where the program begins.' },
    input: {
        label: 'Input',
        placeholder: 'Read the ultrasonic distance',
        help: 'Reading a sensor or a value, e.g. Read the button on D18.',
    },
    output: {
        label: 'Output',
        placeholder: 'Show "Get ready" on the LCD for 2 s',
        help: 'Something the robot shows or plays, e.g. text on the LCD or a buzzer note.',
    },
    process: {
        label: 'Process',
        placeholder: 'Wait until button D18 is released',
        help: 'An action: wait, move the motors, set a variable. Put each action on its own line.',
    },
    decision: {
        label: 'Decision',
        placeholder: 'Is button D18 pressed?',
        help: 'A yes/no question from an if or a loop. Connect a Yes and a No arrow; point one back up to repeat.',
    },
    end: { label: 'End', placeholder: '', help: 'Where the program stops.' },
};

// Steps whose task asks the instructor to draw a flowchart, e.g. "Create a
// flowchart of the previous step". Steps that only show or mention one don't count.
const FLOWCHART_TASK_RE = /\b(create|draw|drawing)\s+(a\s+|the\s+|your\s+)?flow\s*chart/i;

export const isFlowchartStep = (description) =>
    FLOWCHART_TASK_RE.test(String(description || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '));

let idCounter = 0;
export const newId = (prefix) =>
    `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const createStarterFlowchart = () => ({
    version: FLOWCHART_VERSION,
    nodes: [
        { id: 'start', type: 'start', x: 0, y: 0, text: '' },
        { id: 'end', type: 'end', x: 0, y: 140, text: '' },
    ],
    edges: [{ id: 'e_start', from: 'start', to: 'end' }],
});

// Accepts a JSON string or an object; returns a clean flowchart or null.
export const parseFlowchart = (value) => {
    let raw = value;
    if (typeof value === 'string') {
        try {
            raw = JSON.parse(value);
        } catch (e) {
            return null;
        }
    }
    if (!raw || !Array.isArray(raw.nodes)) return null;

    const nodes = raw.nodes
        .filter((n) => n && typeof n.id === 'string' && SHAPE_TYPES.includes(n.type))
        .map((n) => ({
            id: n.id,
            type: n.type,
            x: Number.isFinite(n.x) ? n.x : 0,
            y: Number.isFinite(n.y) ? n.y : 0,
            text: typeof n.text === 'string' ? n.text : '',
        }));
    const types = new Map(nodes.map((n) => [n.id, n.type]));
    const edges = (Array.isArray(raw.edges) ? raw.edges : [])
        .filter((e) => e && types.has(e.from) && types.has(e.to))
        .map((e) => {
            const edge = { id: typeof e.id === 'string' ? e.id : newId('e'), from: e.from, to: e.to };
            if (types.get(e.from) === 'decision') edge.branch = e.branch === 'no' ? 'no' : 'yes';
            return edge;
        });
    return { version: FLOWCHART_VERSION, nodes, edges };
};

export const serializeFlowchart = (chart) => JSON.stringify(parseFlowchart(chart) || createStarterFlowchart());

const shorten = (text, max = 30) => {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
};

export const describeNode = (node) => {
    const label = SHAPE_INFO[node.type]?.label || 'Shape';
    const text = (node.text || '').trim();
    return text && node.type !== 'start' && node.type !== 'end' ? `${label} "${shorten(text)}"` : label;
};

const plural = (n, word, words = `${word}s`) => `${n} ${n === 1 ? word : words}`;

const outgoingMap = (edges) => {
    const outgoing = new Map();
    edges.forEach((e) => {
        if (!outgoing.has(e.from)) outgoing.set(e.from, []);
        outgoing.get(e.from).push(e);
    });
    return outgoing;
};

// Shapes that arrows loop back to: each one is a loop in the drawing. Two
// arrows back to the same shape (from both branches of an if) are one loop.
const loopTargets = (chart) => {
    const nodes = chart?.nodes || [];
    const outgoing = outgoingMap(chart?.edges || []);
    const start = nodes.find((n) => n.type === 'start');
    const targets = new Set();
    if (!start) return targets;
    const state = new Map(); // 1 = on the current path, 2 = finished
    const visit = (id) => {
        state.set(id, 1);
        (outgoing.get(id) || []).forEach((e) => {
            if (state.get(e.to) === 1) targets.add(e.to);
            else if (!state.has(e.to)) visit(e.to);
        });
        state.set(id, 2);
    };
    visit(start.id);
    return targets;
};

// Problems a reviewer would spot at a glance: no Start, empty shapes, missing
// arrows, a decision without both answers, shapes that Start never reaches.
export const checkFlowchartStructure = (chart) => {
    const problems = [];
    const nodes = chart?.nodes || [];
    const outgoing = outgoingMap(chart?.edges || []);
    const starts = nodes.filter((n) => n.type === 'start');
    if (starts.length === 0) problems.push({ nodeId: null, message: 'Add a Start shape.' });
    if (starts.length > 1) problems.push({ nodeId: starts[1].id, message: 'A flowchart can only have one Start shape.' });

    nodes.forEach((node) => {
        const label = describeNode(node);
        const out = outgoing.get(node.id) || [];
        if (ACTION_SHAPES.has(node.type) || node.type === 'decision') {
            if (!node.text.trim()) {
                problems.push({ nodeId: node.id, message: `A ${SHAPE_INFO[node.type].label} shape has no text. Write what happens there.` });
            }
        }
        if (node.type === 'end') {
            if (out.length) problems.push({ nodeId: node.id, message: 'An End shape cannot have arrows going out of it.' });
        } else if (node.type === 'decision') {
            if (out.filter((e) => e.branch !== 'no').length !== 1) {
                problems.push({ nodeId: node.id, message: `${label} needs exactly one "Yes" arrow.` });
            }
            if (out.filter((e) => e.branch === 'no').length !== 1) {
                problems.push({ nodeId: node.id, message: `${label} needs exactly one "No" arrow.` });
            }
        } else if (out.length === 0) {
            problems.push({ nodeId: node.id, message: `${label} has no arrow going out of it.` });
        } else if (out.length > 1) {
            problems.push({
                nodeId: node.id,
                message: `${label} has more than one arrow going out. Use a Decision shape to choose between paths.`,
            });
        }
    });

    if (starts.length > 0) {
        const reached = new Set([starts[0].id]);
        const queue = [starts[0].id];
        while (queue.length) {
            (outgoing.get(queue.shift()) || []).forEach((e) => {
                if (!reached.has(e.to)) {
                    reached.add(e.to);
                    queue.push(e.to);
                }
            });
        }
        nodes.forEach((node) => {
            if (!reached.has(node.id)) {
                problems.push({ nodeId: node.id, message: `${describeNode(node)} can't be reached from Start. Connect an arrow to it or delete it.` });
            }
        });
    }

    // A program that loops forever never reaches an End, so only ask for one
    // when the drawing has no loop
    if (!nodes.some((n) => n.type === 'end') && loopTargets(chart).size === 0) {
        problems.push({ nodeId: null, message: 'Add an End shape.' });
    }
    return problems;
};

// What the drawing shows: action lines, decisions and loops
export const analyzeFlowchart = (chart) => {
    const nodes = chart?.nodes || [];
    return {
        actions: nodes
            .filter((n) => ACTION_SHAPES.has(n.type))
            .reduce((sum, n) => sum + Math.max(1, n.text.split('\n').filter((line) => line.trim()).length), 0),
        decisions: nodes.filter((n) => n.type === 'decision').length,
        loops: loopTargets(chart).size,
    };
};

// ─── Blockly programs ──────────────────────────────────────────────────────────

const COMMENT_BLOCKS = new Set(['project_description', 'line_comment']);
const IF_BLOCKS = new Set(['controls_if', 'controls_ifelse']);
const CONDITION_LOOPS = new Set(['controls_whileUntil']);
const COUNTED_LOOPS = new Set(['controls_repeat_ext', 'controls_repeat', 'controls_for', 'controls_forEach']);
const FOREVER_LOOPS = new Set(['forever_loop']);
const IGNORED_BLOCKS = new Set(['controls_flow_statements', 'procedures_ifreturn']);
const FUNCTION_DEFINITIONS = new Set(['procedures_defnoreturn', 'procedures_defreturn']);

const childrenNamed = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
const firstBlock = (el) => childrenNamed(el, 'block')[0];
const isDisabled = (block) => block.getAttribute('disabled') === 'true' || !!block.getAttribute('disabled-reasons');

// What a Blockly program does, counted the way a flowchart draws it:
// actions, if / else-if conditions, loops and wait-until blocks. Function
// definitions are skipped (a call counts as one action). Returns null when the
// XML can't be read or has no blocks.
export const analyzeBlocklyXml = (xmlText) => {
    if (!xmlText || typeof DOMParser === 'undefined') return null;
    const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (xml.getElementsByTagName('parsererror').length) return null;

    const counts = { actions: 0, conditions: 0, conditionalLoops: 0, countedLoops: 0, foreverLoops: 0, waitUntils: 0 };
    const walk = (first) => {
        for (let block = first; block; block = firstBlock(childrenNamed(block, 'next')[0])) {
            if (isDisabled(block)) continue;
            const type = block.getAttribute('type') || '';
            if (IF_BLOCKS.has(type)) {
                const mutation = childrenNamed(block, 'mutation')[0];
                counts.conditions += 1 + (parseInt(mutation?.getAttribute('elseif'), 10) || 0);
            } else if (CONDITION_LOOPS.has(type)) {
                counts.conditionalLoops += 1;
            } else if (COUNTED_LOOPS.has(type)) {
                counts.countedLoops += 1;
            } else if (FOREVER_LOOPS.has(type)) {
                counts.foreverLoops += 1;
            } else if (type.startsWith('wait_until')) {
                counts.waitUntils += 1;
            } else if (!COMMENT_BLOCKS.has(type) && !IGNORED_BLOCKS.has(type)) {
                counts.actions += 1;
            }
            childrenNamed(block, 'statement').forEach((statement) => walk(firstBlock(statement)));
        }
    };
    childrenNamed(xml.documentElement, 'block')
        .filter((block) => !FUNCTION_DEFINITIONS.has(block.getAttribute('type')))
        .forEach(walk);

    return Object.values(counts).some(Boolean) ? counts : null;
};

export const describeBlocks = (blocks) => {
    const loops = blocks.conditionalLoops + blocks.countedLoops + blocks.foreverLoops;
    return [
        plural(blocks.actions, 'action'),
        blocks.conditions && plural(blocks.conditions, 'if / else-if condition'),
        loops && plural(loops, 'loop'),
        blocks.waitUntils && plural(blocks.waitUntils, 'wait-until'),
    ].filter(Boolean).join(', ');
};

// Checks the drawing, then compares it with the blocks it should describe
// (pass null when they aren't available). The ranges allow for the usual
// ways of drawing the same thing: a wait-until can be a Process shape or a
// Decision that loops back to itself, and a repeat loop may or may not get a
// "repeated enough?" Decision.
export const compareWithBlocks = (chart, blocks) => {
    const problems = checkFlowchartStructure(chart);
    const drawn = analyzeFlowchart(chart);
    const items = [{
        ok: problems.length === 0,
        label: problems.length ? `${plural(problems.length, 'thing')} to fix in the drawing` : 'Shapes and arrows are connected',
        details: problems.map((p) => p.message),
    }];

    if (blocks) {
        const minDecisions = blocks.conditions + blocks.conditionalLoops;
        const maxDecisions = minDecisions + blocks.countedLoops + blocks.waitUntils;
        const choices = [
            blocks.conditions && plural(blocks.conditions, 'if / else-if condition'),
            blocks.conditionalLoops && plural(blocks.conditionalLoops, 'while loop'),
        ].filter(Boolean).join(' and ');
        const decisionsOk = drawn.decisions >= minDecisions && drawn.decisions <= maxDecisions;
        items.push({
            ok: decisionsOk,
            label: `Decisions: ${drawn.decisions}`,
            details: decisionsOk ? []
                : drawn.decisions < minDecisions
                    ? [`Your blocks have ${choices}, so the flowchart needs at least ${plural(minDecisions, 'Decision shape')}.`]
                    : [`Your blocks make at most ${plural(maxDecisions, 'choice')} (if conditions, loops and wait-until blocks). Remove the extra Decision shapes, or check each one matches a block.`],
        });

        const minLoops = blocks.conditionalLoops + blocks.countedLoops + blocks.foreverLoops;
        const maxLoops = minLoops + blocks.waitUntils;
        const loopsOk = drawn.loops >= minLoops && drawn.loops <= maxLoops;
        items.push({
            ok: loopsOk,
            label: `Loops: ${drawn.loops}`,
            details: loopsOk ? []
                : drawn.loops < minLoops
                    ? [`Your blocks repeat in ${plural(minLoops, 'place')} (repeat, while or forever loops). Draw each loop as an arrow pointing back up to an earlier shape.`]
                    : [`The flowchart loops back in ${plural(drawn.loops, 'place')}, but your blocks repeat in ${maxLoops === 0 ? 'none' : `only ${maxLoops}`}. Arrows should only point back up for a loop or a wait-until.`],
        });

        const minActions = blocks.actions - Math.floor(blocks.actions / 4);
        const actionsOk = drawn.actions >= minActions;
        items.push({
            ok: actionsOk,
            label: `Actions: ${drawn.actions}`,
            details: actionsOk ? []
                : [`Your blocks have ${plural(blocks.actions, 'action')} (show on the LCD, move, play, wait, set a variable…). Add a shape, or a line inside a Process shape, for each one.`],
        });
    }

    return { ok: items.every((item) => item.ok), compared: !!blocks, items, problems, drawn, blocks };
};

// Plain-text version of a check, saved with the submission for the reviewer
export const formatCheckReport = (result, comparedWith) => {
    const lines = [
        result.compared
            ? `Flowchart check against ${comparedWith || 'the previous step'} (${describeBlocks(result.blocks)})`
            : 'Flowchart check (the previous step\'s blocks were not found, so only the drawing was checked)',
    ];
    result.items.forEach((item) => {
        lines.push(`${item.ok ? '✅' : '❌'} ${item.label}`);
        item.details.forEach((detail) => lines.push(`   ${detail}`));
    });
    return lines.join('\n');
};

// A numbered, readable listing of the flowchart, stored as the submission's
// "code" so the existing snippet and review views can show it.
export const flowchartToText = (chart) => {
    const nodes = chart?.nodes || [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const outgoing = outgoingMap(chart?.edges || []);

    // Number shapes in the order they are reached from Start, then the rest
    const order = [];
    const seen = new Set();
    const queue = nodes.filter((n) => n.type === 'start').map((n) => n.id);
    while (queue.length) {
        const id = queue.shift();
        if (seen.has(id) || !byId.has(id)) continue;
        seen.add(id);
        order.push(id);
        const out = [...(outgoing.get(id) || [])].sort((a, b) => (a.branch === 'no') - (b.branch === 'no'));
        out.forEach((e) => queue.push(e.to));
    }
    nodes.forEach((n) => {
        if (!seen.has(n.id)) order.push(n.id);
    });
    const number = new Map(order.map((id, i) => [id, i + 1]));

    return order
        .map((id) => {
            const node = byId.get(id);
            const out = outgoing.get(id) || [];
            const text = (node.text || '').trim().replace(/\n+/g, '; ');
            const label = SHAPE_INFO[node.type].label;
            let line = `${number.get(id)}. ${label}${text && node.type !== 'start' && node.type !== 'end' ? `: ${text}` : ''}`;
            if (node.type === 'decision') {
                const yes = out.find((e) => e.branch !== 'no');
                const no = out.find((e) => e.branch === 'no');
                line += ` Yes → ${yes ? number.get(yes.to) : '?'}, No → ${no ? number.get(no.to) : '?'}`;
            } else if (out.length) {
                line += ` → ${out.map((e) => number.get(e.to)).join(', ')}`;
            }
            return line;
        })
        .join('\n');
};
