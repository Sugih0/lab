import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Maximize2, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { SHAPE_INFO, describeNode, newId } from './flowchartEngine';

const SKEW = 14; // slant of the Input/Output parallelogram
const LINE_H = 17;
const CHAR_W = 7;
const WRAP_CHARS = 24; // shape text wraps at about this many characters
const MAX_LINES = 5;
const GAP = 46; // vertical space between shapes added one after another
const GRID = 10;

const SHAPE_STYLES = {
    start: 'fill-emerald-100 stroke-emerald-500 dark:fill-emerald-900/60 dark:stroke-emerald-400',
    end: 'fill-rose-100 stroke-rose-500 dark:fill-rose-900/60 dark:stroke-rose-400',
    input: 'fill-sky-100 stroke-sky-500 dark:fill-sky-900/60 dark:stroke-sky-400',
    output: 'fill-teal-100 stroke-teal-500 dark:fill-teal-900/60 dark:stroke-teal-400',
    process: 'fill-violet-100 stroke-violet-500 dark:fill-violet-900/60 dark:stroke-violet-400',
    decision: 'fill-amber-100 stroke-amber-500 dark:fill-amber-900/60 dark:stroke-amber-400',
};

const snap = (v) => Math.round(v / GRID) * GRID;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// The simulator pages have no dark mode, so there the editor drops its dark: classes
const stripDark = (classes) => classes.split(' ').filter((c) => !c.startsWith('dark:')).join(' ');

const wrapLine = (line) => {
    const lines = [];
    let current = '';
    line.split(/\s+/).forEach((word) => {
        if (current && (current + ' ' + word).length > WRAP_CHARS) {
            lines.push(current);
            current = word;
        } else {
            current = current ? `${current} ${word}` : word;
        }
    });
    if (current) lines.push(current);
    return lines;
};

const textLines = (node) => {
    if (node.type === 'start' || node.type === 'end') return { lines: [SHAPE_INFO[node.type].label], placeholder: false };
    const text = (node.text || '').trim();
    const source = text || SHAPE_INFO[node.type].placeholder;
    // A Process keeps one action per line; other shapes hold one sentence
    const paragraphs = node.type === 'process' ? source.split('\n') : [source.replace(/\s*\n\s*/g, ' ')];
    const lines = paragraphs.map((p) => p.trim()).filter(Boolean).flatMap(wrapLine);
    if (lines.length > MAX_LINES) {
        lines.length = MAX_LINES;
        lines[MAX_LINES - 1] = `${lines[MAX_LINES - 1].slice(0, WRAP_CHARS - 1)}…`;
    }
    return { lines, placeholder: !text };
};

export const shapeSize = (node) => {
    const { lines } = textLines(node);
    const longest = Math.max(...lines.map((l) => l.length)) * CHAR_W;
    switch (node.type) {
        case 'start':
        case 'end':
            return { w: 110, h: 44 };
        case 'decision':
            return { w: Math.max(150, Math.round(longest * 1.35 + 40)), h: 84 + (lines.length - 1) * 20 };
        case 'process':
            return { w: Math.max(150, Math.round(longest + 36)), h: Math.max(46, 22 + lines.length * LINE_H) };
        default: // input / output, with a small caption above the text
            return { w: Math.max(160, Math.round(longest + 36 + SKEW * 2)), h: 34 + lines.length * LINE_H };
    }
};

const boundsOf = (node) => {
    const { w, h } = shapeSize(node);
    return { w, h, left: node.x - w / 2, right: node.x + w / 2, top: node.y - h / 2, bottom: node.y + h / 2 };
};

// Where an arrow leaves a shape: the bottom, or the right corner for a decision's No
const exitPoint = (node, branch) => {
    const b = boundsOf(node);
    return node.type === 'decision' && branch === 'no' ? { x: b.right, y: node.y } : { x: node.x, y: b.bottom };
};

const portsOf = (node) => {
    if (node.type === 'end') return [];
    if (node.type === 'decision') return ['yes', 'no'].map((branch) => ({ branch, ...exitPoint(node, branch) }));
    return [{ branch: null, ...exitPoint(node, null) }];
};

const isLoopBack = (from, to, branch) => boundsOf(to).top < exitPoint(from, branch).y + 16;

// Right-angled path for an arrow. Arrows to a shape further down enter it from
// the top. Arrows that loop back up go round the left-hand side (a decision's
// No goes round the right, where it leaves).
const routeEdge = (from, to, branch, lane) => {
    const A = boundsOf(from);
    const B = boundsOf(to);
    const s = exitPoint(from, branch);
    const exitsRight = from.type === 'decision' && branch === 'no';
    const slanted = to.type === 'input' || to.type === 'output';

    if (!isLoopBack(from, to, branch)) {
        const t = { x: to.x, y: B.top };
        if (exitsRight) {
            if (t.x >= s.x + 16) return [s, { x: t.x, y: s.y }, t];
            // Down the right-hand side, then across just above the target, so the
            // arrow doesn't cut through the Yes branch drawn under the decision
            const laneX = s.x + 30;
            const turnY = Math.max(s.y + 16, t.y - 20);
            return [s, { x: laneX, y: s.y }, { x: laneX, y: turnY }, { x: t.x, y: turnY }, t];
        }
        if (Math.abs(t.x - s.x) < 1) return [s, t];
        const midY = (s.y + t.y) / 2;
        return [s, { x: s.x, y: midY }, { x: t.x, y: midY }, t];
    }

    if (exitsRight) {
        const laneX = Math.max(A.right, B.right) + 28 + lane * 14;
        const t = { x: slanted ? B.right - SKEW / 2 : B.right, y: to.y };
        return [s, { x: laneX, y: s.y }, { x: laneX, y: t.y }, t];
    }
    const laneX = Math.min(A.left, B.left) - 28 - lane * 14;
    const t = { x: slanted ? B.left + SKEW / 2 : B.left, y: to.y };
    const below = { x: s.x, y: s.y + 16 };
    return [s, below, { x: laneX, y: below.y }, { x: laneX, y: t.y }, t];
};

const toPath = (points) => points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');

const ShapeOutline = ({ type, w, h, grow = 0, ...props }) => {
    const W = w + grow * 2;
    const H = h + grow * 2;
    if (type === 'start' || type === 'end') {
        return <rect x={-W / 2} y={-H / 2} width={W} height={H} rx={H / 2} {...props} />;
    }
    if (type === 'process') return <rect x={-W / 2} y={-H / 2} width={W} height={H} rx={6} {...props} />;
    if (type === 'decision') {
        const gw = W + grow * 1.5;
        const gh = H + grow * 1.5;
        return <polygon points={`0,${-gh / 2} ${gw / 2},0 0,${gh / 2} ${-gw / 2},0`} {...props} />;
    }
    return <polygon points={`${-W / 2 + SKEW},${-H / 2} ${W / 2},${-H / 2} ${W / 2 - SKEW},${H / 2} ${-W / 2},${H / 2}`} {...props} />;
};

const ShapeIcon = ({ type, tw }) => (
    <svg width="22" height="14" viewBox="-12 -8 24 16" aria-hidden="true">
        {type === 'start' || type === 'end' ? (
            <rect x="-10" y="-6" width="20" height="12" rx="6" className={tw(SHAPE_STYLES[type])} strokeWidth="1.5" />
        ) : type === 'process' ? (
            <rect x="-10" y="-6" width="20" height="12" rx="1.5" className={tw(SHAPE_STYLES[type])} strokeWidth="1.5" />
        ) : type === 'decision' ? (
            <polygon points="0,-7 11,0 0,7 -11,0" className={tw(SHAPE_STYLES[type])} strokeWidth="1.5" />
        ) : (
            <polygon points="-6,-6 11,-6 6,6 -11,6" className={tw(SHAPE_STYLES[type])} strokeWidth="1.5" />
        )}
    </svg>
);

const RING_STYLES = {
    error: 'stroke-rose-500',
    active: 'stroke-amber-400',
    target: 'stroke-emerald-500',
    selected: 'stroke-violet-500 dark:stroke-violet-400',
};

const toolButton =
    'h-8 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

// Drawing surface for a flowchart. The parent owns the chart and gets every
// change through onChange. activeNodeId / errorNodeId highlight a shape while
// running. Change fitKey to re-centre the view and clear undo, e.g. when a
// different question's chart is loaded.
export const FlowchartEditor = ({ chart, onChange, readOnly = false, light = false, activeNodeId = null, errorNodeId = null, fitKey }) => {
    const uid = useId().replace(/:/g, '');
    const tw = light ? stripDark : (classes) => classes;
    const canvasRef = useRef(null);
    const svgRef = useRef(null);
    const textRef = useRef(null);
    const gesture = useRef(null);
    const lastTap = useRef({ id: null, at: 0 });
    const history = useRef({ stack: [], lastKey: null });
    const needsFit = useRef(true);
    const [historySize, setHistorySize] = useState(0);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [view, setView] = useState({ x: 0, y: 0, k: 1 });
    const [selection, setSelection] = useState(null); // { kind: 'node' | 'edge', id }
    const [connecting, setConnecting] = useState(null); // { fromId, branch, x, y, overId }
    const [hoverId, setHoverId] = useState(null);

    const nodes = useMemo(() => chart?.nodes || [], [chart]);
    const edges = useMemo(() => chart?.edges || [], [chart]);
    const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
    const selectedNode = selection?.kind === 'node' ? byId.get(selection.id) : null;
    const selectedEdge = selection?.kind === 'edge' ? edges.find((e) => e.id === selection.id) : null;

    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return undefined;
        let frame = null;
        const observer = new ResizeObserver(([entry]) => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
        });
        observer.observe(el);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, []);

    const fitView = useCallback(() => {
        if (!size.w || !size.h) return;
        if (nodes.length === 0) {
            setView({ x: size.w / 2, y: size.h / 2, k: 1 });
            return;
        }
        const all = nodes.map(boundsOf);
        const minX = Math.min(...all.map((b) => b.left)) - 30;
        const maxX = Math.max(...all.map((b) => b.right)) + 60;
        const minY = Math.min(...all.map((b) => b.top)) - 30;
        const maxY = Math.max(...all.map((b) => b.bottom)) + 30;
        const k = clamp(Math.min(size.w / (maxX - minX), size.h / (maxY - minY)), 0.3, 1.1);
        setView({ k, x: size.w / 2 - ((minX + maxX) / 2) * k, y: size.h / 2 - ((minY + maxY) / 2) * k });
    }, [nodes, size]);

    useEffect(() => {
        needsFit.current = true;
        history.current = { stack: [], lastKey: null };
        setHistorySize(0);
        setSelection(null);
    }, [fitKey]);

    useEffect(() => {
        if (needsFit.current && size.w && size.h) {
            needsFit.current = false;
            fitView();
        }
    }, [fitView, size, fitKey]);

    // Wheel pans the canvas and Ctrl+wheel zooms at the pointer. Added by hand
    // because React's wheel listener is passive and can't stop the page scrolling.
    useEffect(() => {
        const el = canvasRef.current;
        if (!el) return undefined;
        const onWheel = (e) => {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                const r = el.getBoundingClientRect();
                const px = e.clientX - r.left;
                const py = e.clientY - r.top;
                setView((v) => {
                    const k = clamp(v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.3, 2);
                    return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) };
                });
            } else {
                setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
            }
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    // Every edit goes through here so it can be undone. Edits with the same key
    // in a row (typing in one shape, one drag) undo as a single step.
    const commit = (next, key = null) => {
        if (readOnly || !onChange) return;
        const h = history.current;
        if (!key || key !== h.lastKey) {
            h.stack.push(chart);
            if (h.stack.length > 60) h.stack.shift();
            setHistorySize(h.stack.length);
        }
        h.lastKey = key;
        onChange(next);
    };

    const undo = () => {
        const h = history.current;
        const previous = h.stack.pop();
        h.lastKey = null;
        setHistorySize(h.stack.length);
        if (previous && onChange) {
            onChange(previous);
            setSelection(null);
        }
    };

    const toWorld = (e) => {
        const r = svgRef.current.getBoundingClientRect();
        return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
    };

    const nodeAt = (p) =>
        [...nodes].reverse().find((n) => {
            const b = boundsOf(n);
            return p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
        });

    // Pan so a shape is on screen, e.g. one just added below the visible area
    const reveal = (node) => {
        const sx = node.x * view.k + view.x;
        const sy = node.y * view.k + view.y;
        if (sx < 60 || sx > size.w - 60 || sy < 50 || sy > size.h - 50) {
            setView((v) => ({ ...v, x: size.w / 2 - node.x * v.k, y: size.h / 2 - node.y * v.k }));
        }
    };

    const focusText = () => setTimeout(() => textRef.current?.focus(), 0);

    const startGesture = (e, value) => {
        gesture.current = value;
        svgRef.current.setPointerCapture(e.pointerId);
    };

    const onBackgroundDown = (e) => {
        if (e.button !== 0) return;
        canvasRef.current?.focus({ preventScroll: true });
        setSelection(null);
        startGesture(e, { kind: 'pan', startX: e.clientX, startY: e.clientY, view });
    };

    const onNodeDown = (e, node) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        canvasRef.current?.focus({ preventScroll: true });
        if (readOnly) {
            startGesture(e, { kind: 'pan', startX: e.clientX, startY: e.clientY, view });
            return;
        }
        setSelection({ kind: 'node', id: node.id });
        // Pointer capture swallows dblclick, so spot a double tap here
        const tappedAt = Date.now();
        if (lastTap.current.id === node.id && tappedAt - lastTap.current.at < 350) focusText();
        lastTap.current = { id: node.id, at: tappedAt };
        const p = toWorld(e);
        startGesture(e, { kind: 'drag', id: node.id, dx: p.x - node.x, dy: p.y - node.y, key: `drag:${node.id}:${tappedAt}` });
    };

    const onPortDown = (e, node, branch) => {
        e.stopPropagation();
        if (readOnly || e.button !== 0) return;
        const p = toWorld(e);
        setConnecting({ fromId: node.id, branch, x: p.x, y: p.y, overId: null });
        startGesture(e, { kind: 'connect' });
    };

    const onEdgeDown = (e, edge) => {
        e.stopPropagation();
        if (readOnly || e.button !== 0) return;
        canvasRef.current?.focus({ preventScroll: true });
        setSelection({ kind: 'edge', id: edge.id });
    };

    const onPointerMove = (e) => {
        const g = gesture.current;
        if (!g) return;
        if (g.kind === 'pan') {
            setView({ ...g.view, x: g.view.x + e.clientX - g.startX, y: g.view.y + e.clientY - g.startY });
        } else if (g.kind === 'drag') {
            const node = byId.get(g.id);
            const p = toWorld(e);
            const x = snap(p.x - g.dx);
            const y = snap(p.y - g.dy);
            if (!node || (x === node.x && y === node.y)) return;
            commit({ ...chart, nodes: nodes.map((n) => (n.id === g.id ? { ...n, x, y } : n)) }, g.key);
        } else if (g.kind === 'connect') {
            const p = toWorld(e);
            const over = nodeAt(p);
            setConnecting((c) =>
                c && { ...c, x: p.x, y: p.y, overId: over && over.id !== c.fromId && over.type !== 'start' ? over.id : null }
            );
        }
    };

    const connect = (fromId, toId, branch) => {
        const from = byId.get(fromId);
        const isDecision = from.type === 'decision';
        // A shape has one arrow out (a decision one per branch); a new one replaces it
        const kept = edges.filter((e) => e.from !== fromId || (isDecision && (e.branch === 'no') !== (branch === 'no')));
        const edge = { id: newId('e'), from: fromId, to: toId, ...(isDecision ? { branch } : {}) };
        commit({ ...chart, edges: [...kept, edge] });
        setSelection({ kind: 'edge', id: edge.id });
    };

    const onPointerUp = () => {
        const g = gesture.current;
        gesture.current = null;
        if (g?.kind === 'connect') {
            if (connecting?.overId) connect(connecting.fromId, connecting.overId, connecting.branch);
            setConnecting(null);
        }
    };

    const deleteSelection = () => {
        if (readOnly || !selection) return;
        if (selectedEdge) {
            commit({ ...chart, edges: edges.filter((e) => e.id !== selectedEdge.id) });
        } else if (selectedNode) {
            const id = selectedNode.id;
            const out = edges.filter((e) => e.from === id);
            let rest = edges.filter((e) => e.from !== id && e.to !== id);
            // Close the gap: arrows into the removed shape now go where it went
            if (selectedNode.type !== 'decision' && out.length === 1 && out[0].to !== id) {
                const target = out[0].to;
                const rerouted = edges
                    .filter((e) => e.to === id && e.from !== id && e.from !== target)
                    .map((e) => ({ ...e, to: target }));
                rest = [...rest, ...rerouted];
            }
            commit({ ...chart, nodes: nodes.filter((n) => n.id !== id), edges: rest });
        }
        setSelection(null);
    };

    // Adds a shape. With a shape selected, the new one goes below it and is
    // connected in: Start → End becomes Start → Input → End. With an arrow
    // selected, the new shape goes into that arrow. A decision added into a
    // chain sends No on to the rest of it, leaving Yes free for the next shape.
    const addShape = (type) => {
        if (readOnly) return;
        const node = { id: newId('n'), type, x: 0, y: 0, text: '' };
        const { w, h } = shapeSize(node);
        const anchor = selectedNode && selectedNode.type !== 'end' && type !== 'start' ? selectedNode : null;
        const anchorEdge = selectedEdge && type !== 'start' && type !== 'end' ? selectedEdge : null;
        const continueBranch = type === 'decision' ? { branch: 'no' } : {};
        let nextNodes = nodes;
        let nextEdges = edges;

        const placeFree = () => {
            let x = snap((size.w / 2 - view.x) / view.k);
            let y = snap((size.h / 2 - view.y) / view.k);
            for (let tries = 0; tries < 10 && nodeAt({ x, y }); tries += 1) {
                x += 30;
                y += 30;
            }
            node.x = x;
            node.y = y;
        };
        const placeBelow = () => {
            const b = boundsOf(anchor);
            node.x = anchor.x;
            node.y = snap(b.bottom + GAP + h / 2);
            nextNodes = nodes.map((n) => (n.id !== anchor.id && n.y > anchor.y ? { ...n, y: snap(n.y + h + GAP) } : n));
        };

        if (anchorEdge) {
            // Take the target's place and push it, and everything under it, down
            const to = byId.get(anchorEdge.to);
            node.x = to.x;
            node.y = snap(boundsOf(to).top + h / 2);
            nextNodes = nodes.map((n) => (n.y >= to.y ? { ...n, y: snap(n.y + h + GAP) } : n));
            nextEdges = edges.filter((e) => e.id !== anchorEdge.id);
            nextEdges.push(
                { ...anchorEdge, id: newId('e'), to: node.id },
                { id: newId('e'), from: node.id, to: anchorEdge.to, ...continueBranch }
            );
        } else if (!anchor) {
            placeFree();
        } else if (anchor.type === 'decision') {
            const out = edges.filter((e) => e.from === anchor.id);
            if (!out.some((e) => e.branch !== 'no')) {
                placeBelow();
                nextEdges = [...edges, { id: newId('e'), from: anchor.id, to: node.id, branch: 'yes' }];
            } else if (!out.some((e) => e.branch === 'no')) {
                node.x = snap(boundsOf(anchor).right + 50 + w / 2);
                node.y = snap(anchor.y + 40 + h / 2);
                nextEdges = [...edges, { id: newId('e'), from: anchor.id, to: node.id, branch: 'no' }];
            } else {
                placeFree();
            }
        } else {
            const existing = edges.find((e) => e.from === anchor.id);
            if (type === 'end' && existing) {
                placeFree();
            } else {
                placeBelow();
                nextEdges = edges.filter((e) => e !== existing);
                nextEdges.push({ id: newId('e'), from: anchor.id, to: node.id });
                if (existing && type !== 'end') {
                    nextEdges.push({ id: newId('e'), from: node.id, to: existing.to, ...continueBranch });
                }
            }
        }

        commit({ ...chart, nodes: [...nextNodes, node], edges: nextEdges });
        setSelection({ kind: 'node', id: node.id });
        reveal(node);
        if (type !== 'start' && type !== 'end') focusText();
    };

    const setNodeText = (text) => {
        commit({ ...chart, nodes: nodes.map((n) => (n.id === selectedNode.id ? { ...n, text } : n)) }, `text:${selectedNode.id}`);
    };

    const swapBranches = (decisionId) => {
        commit({
            ...chart,
            edges: edges.map((e) => (e.from === decisionId ? { ...e, branch: e.branch === 'no' ? 'yes' : 'no' } : e)),
        });
    };

    const zoomBy = (factor) => {
        setView((v) => {
            const k = clamp(v.k * factor, 0.3, 2);
            const cx = size.w / 2;
            const cy = size.h / 2;
            return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
        });
    };

    const onKeyDown = (e) => {
        if (e.target !== e.currentTarget) return;
        // Keep keys meant for the flowchart away from page-wide shortcuts (Blockly's Delete and Ctrl+Z)
        if (['Delete', 'Backspace', 'Escape', 'Enter'].includes(e.key) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) {
            e.stopPropagation();
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
            e.preventDefault();
            deleteSelection();
        } else if (e.key === 'Escape') {
            setSelection(null);
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undo();
        } else if (e.key === 'Enter' && selectedNode) {
            e.preventDefault();
            focusText();
        }
    };

    const addable = ['input', 'output', 'process', 'decision', 'end'];
    if (!nodes.some((n) => n.type === 'start')) addable.unshift('start');

    let lane = 0;
    const edgeShapes = edges.map((edge) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return null;
        const branch = from.type === 'decision' ? edge.branch || 'yes' : null;
        const points = routeEdge(from, to, branch, isLoopBack(from, to, branch) ? lane++ % 4 : 0);
        return { edge, branch, points, d: toPath(points) };
    });

    const renderInspector = () => {
        if (selectedNode) {
            const info = SHAPE_INFO[selectedNode.type];
            if (selectedNode.type === 'start' || selectedNode.type === 'end') {
                return <p className={tw('text-xs text-slate-500 dark:text-slate-400')}>{info.label}: {info.help} Drag it to move it.</p>;
            }
            const fieldClass = tw(
                'flex-1 min-w-0 px-3 py-1.5 bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-600 rounded-md text-sm text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none'
            );
            return (
                <div className="space-y-1">
                    <div className="flex items-start gap-2">
                        <span className={tw('mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap')}>
                            <ShapeIcon type={selectedNode.type} tw={tw} /> {info.label}
                        </span>
                        {selectedNode.type === 'process' ? (
                            <textarea
                                ref={textRef}
                                rows={2}
                                value={selectedNode.text}
                                onChange={(e) => setNodeText(e.target.value)}
                                placeholder={`e.g. ${info.placeholder}`}
                                className={`${fieldClass} resize-y`}
                            />
                        ) : (
                            <input
                                ref={textRef}
                                value={selectedNode.text}
                                onChange={(e) => setNodeText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === 'Escape') canvasRef.current?.focus({ preventScroll: true });
                                }}
                                placeholder={`e.g. ${info.placeholder}`}
                                className={fieldClass}
                            />
                        )}
                    </div>
                    <p className={tw('text-[11px] text-slate-500 dark:text-slate-400')}>{info.help}</p>
                </div>
            );
        }
        if (selectedEdge) {
            const from = byId.get(selectedEdge.from);
            const to = byId.get(selectedEdge.to);
            return (
                <div className={tw('flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300')}>
                    <span>
                        Arrow{from?.type === 'decision' ? ` (${selectedEdge.branch === 'no' ? 'No' : 'Yes'})` : ''} from{' '}
                        <strong>{from && describeNode(from)}</strong> to <strong>{to && describeNode(to)}</strong>
                    </span>
                    {from?.type === 'decision' && (
                        <button className={tw(toolButton)} onClick={() => swapBranches(from.id)}>
                            <ArrowLeftRight size={14} /> Swap Yes / No
                        </button>
                    )}
                    <button className={tw(toolButton)} onClick={deleteSelection}>
                        <Trash2 size={14} /> Delete arrow
                    </button>
                </div>
            );
        }
        return (
            <p className={tw('text-xs text-slate-500 dark:text-slate-400')}>
                Select a shape or an arrow, then use <strong>Add</strong> to put the next shape after it. Drag from the dot under a
                shape to draw an arrow. Point an arrow back up to make a loop. Double-click a shape to edit its text.
            </p>
        );
    };

    return (
        <div className={tw('h-full flex flex-col bg-slate-50 dark:bg-slate-950')}>
            {!readOnly && (
                <div className={tw('shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900')}>
                    <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
                        <span className={tw('text-xs font-semibold text-slate-500 dark:text-slate-400 mr-1')}>Add</span>
                        {addable.map((type) => (
                            <button key={type} className={tw(toolButton)} onClick={() => addShape(type)} title={SHAPE_INFO[type].help}>
                                <ShapeIcon type={type} tw={tw} /> {SHAPE_INFO[type].label}
                            </button>
                        ))}
                        <div className="flex-1" />
                        <button className={tw(toolButton)} onClick={undo} disabled={historySize === 0} title="Undo (Ctrl+Z)">
                            <Undo2 size={14} /> Undo
                        </button>
                        <button className={tw(toolButton)} onClick={deleteSelection} disabled={!selection} title="Delete selected (Delete key)">
                            <Trash2 size={14} /> Delete
                        </button>
                    </div>
                    <div className="px-3 pb-2 min-h-[2.5rem]">{renderInspector()}</div>
                </div>
            )}

            <div
                ref={canvasRef}
                tabIndex={0}
                onKeyDown={onKeyDown}
                className="relative flex-1 min-h-0 outline-none overflow-hidden"
                style={{ touchAction: 'none' }}>
                <svg
                    ref={svgRef}
                    width="100%"
                    height="100%"
                    className="block select-none"
                    onPointerDown={onBackgroundDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}>
                    <defs>
                        <pattern
                            id={`${uid}-grid`}
                            width="20"
                            height="20"
                            patternUnits="userSpaceOnUse"
                            patternTransform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                            <circle cx="1" cy="1" r="1" className={tw('fill-slate-300 dark:fill-slate-700')} />
                        </pattern>
                        {['', '-sel'].map((suffix) => (
                            <marker
                                key={suffix}
                                id={`${uid}-arrow${suffix}`}
                                viewBox="0 0 10 10"
                                refX="9"
                                refY="5"
                                markerWidth="9"
                                markerHeight="9"
                                markerUnits="userSpaceOnUse"
                                orient="auto">
                                <path
                                    d="M0,0 L10,5 L0,10 z"
                                    className={tw(suffix ? 'fill-violet-600 dark:fill-violet-400' : 'fill-slate-500 dark:fill-slate-400')}
                                />
                            </marker>
                        ))}
                    </defs>
                    <rect width="100%" height="100%" fill={`url(#${uid}-grid)`} />

                    <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                        {edgeShapes.map((shape) => {
                            if (!shape) return null;
                            const { edge, branch, points, d } = shape;
                            const selected = selection?.kind === 'edge' && selection.id === edge.id;
                            const s = points[0];
                            return (
                                <g key={edge.id}>
                                    <path
                                        d={d}
                                        fill="none"
                                        strokeWidth={selected ? 2.5 : 1.75}
                                        strokeLinejoin="round"
                                        className={tw(selected ? 'stroke-violet-600 dark:stroke-violet-400' : 'stroke-slate-500 dark:stroke-slate-400')}
                                        markerEnd={`url(#${uid}-arrow${selected ? '-sel' : ''})`}
                                    />
                                    {!readOnly && (
                                        <path
                                            d={d}
                                            fill="none"
                                            stroke="transparent"
                                            strokeWidth="14"
                                            className="cursor-pointer"
                                            onPointerDown={(e) => onEdgeDown(e, edge)}
                                        />
                                    )}
                                    {branch && (
                                        <text
                                            x={s.x + 7}
                                            y={branch === 'no' ? s.y - 7 : s.y + 14}
                                            className={tw('fill-slate-600 dark:fill-slate-300 text-[11px] font-bold pointer-events-none')}>
                                            {branch === 'no' ? 'No' : 'Yes'}
                                        </text>
                                    )}
                                </g>
                            );
                        })}

                        {connecting && byId.get(connecting.fromId) && (
                            <path
                                d={toPath([exitPoint(byId.get(connecting.fromId), connecting.branch), connecting])}
                                fill="none"
                                strokeWidth="2"
                                strokeDasharray="6 4"
                                className="stroke-violet-500 pointer-events-none"
                            />
                        )}

                        {nodes.map((node) => {
                            const { w, h } = shapeSize(node);
                            const { lines, placeholder } = textLines(node);
                            const hasCaption = node.type === 'input' || node.type === 'output';
                            const top = -h / 2 + (hasCaption ? 16 : 0);
                            const firstY = (top + h / 2) / 2 - ((lines.length - 1) * LINE_H) / 2;
                            const ring =
                                node.id === errorNodeId ? 'error'
                                    : node.id === activeNodeId ? 'active'
                                        : connecting?.overId === node.id ? 'target'
                                            : selection?.kind === 'node' && selection.id === node.id ? 'selected'
                                                : null;
                            const connected = new Set(edges.filter((e) => e.from === node.id).map((e) => e.branch || 'next'));
                            const showPorts = !readOnly && (hoverId === node.id || selection?.id === node.id || !!connecting);
                            return (
                                <g
                                    key={node.id}
                                    transform={`translate(${node.x} ${node.y})`}
                                    className={readOnly ? '' : 'cursor-move'}
                                    onPointerDown={(e) => onNodeDown(e, node)}
                                    onPointerEnter={() => setHoverId(node.id)}
                                    onPointerLeave={() => setHoverId((id) => (id === node.id ? null : id))}>
                                    {ring && (
                                        <ShapeOutline
                                            type={node.type}
                                            w={w}
                                            h={h}
                                            grow={5}
                                            fill="none"
                                            strokeWidth={ring === 'selected' ? 2 : 4}
                                            strokeDasharray={ring === 'selected' ? '5 4' : undefined}
                                            className={tw(RING_STYLES[ring])}
                                        />
                                    )}
                                    <ShapeOutline type={node.type} w={w} h={h} strokeWidth={2} className={tw(SHAPE_STYLES[node.type])} />
                                    {hasCaption && (
                                        <text
                                            y={-h / 2 + 12}
                                            textAnchor="middle"
                                            className={tw('fill-slate-500 dark:fill-slate-400 text-[9px] font-bold tracking-widest pointer-events-none')}>
                                            {node.type.toUpperCase()}
                                        </text>
                                    )}
                                    <text
                                        textAnchor="middle"
                                        dominantBaseline="central"
                                        className={tw(`pointer-events-none text-[13px] ${
                                            placeholder
                                                ? 'fill-slate-400 dark:fill-slate-500 italic'
                                                : node.type === 'start' || node.type === 'end'
                                                    ? 'fill-slate-800 dark:fill-slate-100 font-semibold'
                                                    : 'fill-slate-800 dark:fill-slate-100'
                                        }`)}>
                                        {lines.map((line, i) => (
                                            <tspan key={i} x="0" y={firstY + i * LINE_H}>
                                                {line}
                                            </tspan>
                                        ))}
                                    </text>
                                    {showPorts &&
                                        portsOf(node).map((port) => (
                                            <g
                                                key={port.branch || 'next'}
                                                className="cursor-crosshair"
                                                onPointerDown={(e) => onPortDown(e, node, port.branch)}>
                                                <circle cx={port.x - node.x} cy={port.y - node.y} r="12" fill="transparent" />
                                                <circle
                                                    cx={port.x - node.x}
                                                    cy={port.y - node.y}
                                                    r="5.5"
                                                    strokeWidth="1.5"
                                                    className={tw('fill-white stroke-violet-500 dark:fill-slate-900 dark:stroke-violet-400')}
                                                />
                                                {port.branch && !connected.has(port.branch) && (
                                                    <text
                                                        x={port.x - node.x + 9}
                                                        y={port.y - node.y + (port.branch === 'no' ? -8 : 14)}
                                                        className={tw('fill-violet-600 dark:fill-violet-300 text-[11px] font-bold pointer-events-none')}>
                                                        {port.branch === 'no' ? 'No' : 'Yes'}
                                                    </text>
                                                )}
                                            </g>
                                        ))}
                                </g>
                            );
                        })}
                    </g>
                </svg>

                <div className="absolute bottom-3 right-3 flex gap-1">
                    <button className={tw(toolButton)} onClick={() => zoomBy(1 / 1.2)} title="Zoom out">
                        <ZoomOut size={14} />
                    </button>
                    <button className={tw(toolButton)} onClick={() => zoomBy(1.2)} title="Zoom in">
                        <ZoomIn size={14} />
                    </button>
                    <button className={tw(toolButton)} onClick={fitView} title="Fit flowchart to view">
                        <Maximize2 size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FlowchartEditor;
