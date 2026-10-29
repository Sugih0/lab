import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X, ZoomIn, ZoomOut } from 'lucide-react';

// A full-screen viewer for the images in a question's text: the image opens
// centred, and zooms with the buttons, the mouse wheel, a pinch, +/- keys or
// a double-click; drag to move it. Esc, X or a click beside it closes it.

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const STEP = 1.25;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export const ImageViewer = ({ src, alt = '', onClose }) => {
    const dialogRef = useRef(null);
    const stageRef = useRef(null);
    const imgRef = useRef(null);
    const pointers = useRef(new Map());
    const gesture = useRef(null);
    const initialScale = useRef(1);
    // x, y: where the image's centre is, from the middle of the screen
    const [view, setView] = useState({ scale: 1, x: 0, y: 0, animate: false });
    const [loaded, setLoaded] = useState(false);
    const [dragging, setDragging] = useState(false);

    // A point on the stage, from its centre
    const fromCentre = (clientX, clientY) => {
        const r = stageRef.current.getBoundingClientRect();
        return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
    };

    // The scale that shows the whole image, leaving room for the toolbar
    const fitScale = () => {
        const img = imgRef.current;
        const r = stageRef.current.getBoundingClientRect();
        if (!img?.naturalWidth) return 1;
        return clamp(Math.min((r.width - 48) / img.naturalWidth, (r.height - 136) / img.naturalHeight), MIN_SCALE, MAX_SCALE);
    };

    // Zoom by factor, keeping the point (px, py) from the centre where it is
    const zoomAt = (factor, px = 0, py = 0, animate = false) => {
        setView((v) => {
            const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
            const k = scale / v.scale;
            return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k, animate };
        });
    };

    const showAt = (scale) => setView({ scale, x: 0, y: 0, animate: true });

    const onLoad = () => {
        // Actual size when it fits, otherwise as large as fits
        initialScale.current = Math.min(1, fitScale());
        setView({ scale: initialScale.current, x: 0, y: 0, animate: false });
        setLoaded(true);
    };

    useEffect(() => {
        // An image already decoded may not fire load again
        if (imgRef.current?.complete && imgRef.current.naturalWidth) onLoad();
        const previous = document.activeElement;
        dialogRef.current?.focus();
        return () => previous?.focus?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The wheel zooms (React's wheel listener is passive, so it can't stop
    // the page scrolling); a trackpad pinch arrives as a wheel with ctrlKey
    useEffect(() => {
        const stage = stageRef.current;
        const onWheel = (e) => {
            e.preventDefault();
            const lines = e.deltaMode === 1 ? 33 : 1;
            const factor = Math.exp(-e.deltaY * lines * (e.ctrlKey ? 0.01 : 0.0015));
            const p = fromCentre(e.clientX, e.clientY);
            zoomAt(factor, p.x, p.y);
        };
        stage.addEventListener('wheel', onWheel, { passive: false });
        return () => stage.removeEventListener('wheel', onWheel);
    }, []);

    const onKeyDown = (e) => {
        if (e.key === 'Escape') onClose();
        else if (e.key === '+' || e.key === '=') zoomAt(STEP, 0, 0, true);
        else if (e.key === '-' || e.key === '_') zoomAt(1 / STEP, 0, 0, true);
        else if (e.key === '0') showAt(initialScale.current);
        else return;
        e.preventDefault();
        e.stopPropagation();
    };

    const onPointerDown = (e) => {
        if (e.target.closest('[data-viewer-ui]')) return;
        stageRef.current.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 1) {
            gesture.current = { moved: 0, onImage: e.target === imgRef.current };
            setDragging(true);
        }
    };

    const onPointerMove = (e) => {
        const prev = pointers.current.get(e.pointerId);
        if (!prev) return;
        const cur = { x: e.clientX, y: e.clientY };
        pointers.current.set(e.pointerId, cur);
        if (gesture.current) gesture.current.moved += Math.hypot(cur.x - prev.x, cur.y - prev.y);
        if (pointers.current.size === 1) {
            setView((v) => ({ ...v, x: v.x + cur.x - prev.x, y: v.y + cur.y - prev.y, animate: false }));
        } else if (pointers.current.size === 2) {
            // Pinch: zoom about the midpoint of the two fingers, and follow it
            const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)[1];
            const before = Math.hypot(prev.x - other.x, prev.y - other.y);
            const after = Math.hypot(cur.x - other.x, cur.y - other.y);
            if (!before) return;
            const m0 = fromCentre((prev.x + other.x) / 2, (prev.y + other.y) / 2);
            const m1 = fromCentre((cur.x + other.x) / 2, (cur.y + other.y) / 2);
            setView((v) => {
                const scale = clamp(v.scale * (after / before), MIN_SCALE, MAX_SCALE);
                const k = scale / v.scale;
                return { scale, x: m0.x - (m0.x - v.x) * k + m1.x - m0.x, y: m0.y - (m0.y - v.y) * k + m1.y - m0.y, animate: false };
            });
        }
    };

    const onPointerUp = (e) => {
        if (!pointers.current.delete(e.pointerId)) return;
        if (pointers.current.size > 0) return;
        setDragging(false);
        // A click (not a drag) beside the image closes the viewer
        const g = gesture.current;
        gesture.current = null;
        if (g && g.moved < 4 && !g.onImage) onClose();
    };

    const onDoubleClick = (e) => {
        if (view.scale > initialScale.current * 1.05) {
            showAt(initialScale.current);
        } else {
            const p = fromCentre(e.clientX, e.clientY);
            zoomAt(2.5, p.x, p.y, true);
        }
    };

    const percent = Math.round(view.scale * 100);
    const buttonClass = 'p-2 rounded-full text-slate-200 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent transition-colors';

    return createPortal(
        <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={alt ? `Image: ${alt}` : 'Image viewer'}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="fixed inset-0 z-[200] bg-slate-950/85 backdrop-blur-sm outline-none animate-fade-in"
        >
            <div
                ref={stageRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                // On the stage, not the image: with the pointer captured, the
                // browser sends the double-click to the stage
                onDoubleClick={onDoubleClick}
                className={`absolute inset-0 overflow-hidden touch-none select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            >
                <img
                    ref={imgRef}
                    src={src}
                    alt={alt}
                    draggable={false}
                    onLoad={onLoad}
                    className="absolute left-1/2 top-1/2 bg-white rounded shadow-2xl"
                    style={{
                        maxWidth: 'none',
                        transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                        transition: view.animate ? 'transform 150ms ease-out' : 'none',
                        visibility: loaded ? 'visible' : 'hidden',
                    }}
                />
            </div>

            <button
                type="button"
                data-viewer-ui
                onClick={onClose}
                aria-label="Close image"
                title="Close (Esc)"
                className="absolute top-4 right-4 p-2.5 rounded-full bg-slate-900/80 text-slate-200 hover:text-white hover:bg-slate-800 shadow-lg transition-colors"
            >
                <X size={20} />
            </button>

            <div
                data-viewer-ui
                className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-full bg-slate-900/90 shadow-lg"
            >
                <button type="button" className={buttonClass} onClick={() => zoomAt(1 / STEP, 0, 0, true)} disabled={view.scale <= MIN_SCALE} aria-label="Zoom out" title="Zoom out (-)">
                    <ZoomOut size={18} />
                </button>
                <button
                    type="button"
                    onClick={() => showAt(1)}
                    title="Actual size"
                    aria-label={`Zoom ${percent}%, show actual size`}
                    className="min-w-[4rem] px-2 py-1 rounded-full text-sm font-medium tabular-nums text-slate-200 hover:text-white hover:bg-white/10 transition-colors"
                >
                    {percent}%
                </button>
                <button type="button" className={buttonClass} onClick={() => zoomAt(STEP, 0, 0, true)} disabled={view.scale >= MAX_SCALE} aria-label="Zoom in" title="Zoom in (+)">
                    <ZoomIn size={18} />
                </button>
                <span className="w-px h-5 bg-white/15 mx-1" />
                <button type="button" className={buttonClass} onClick={() => showAt(fitScale())} aria-label="Fit to screen" title="Fit to screen (0 for the starting size)">
                    <Maximize2 size={18} />
                </button>
                <span className="hidden sm:inline pl-1 pr-2 text-xs text-slate-400">Scroll or pinch to zoom, drag to move</span>
            </div>
        </div>,
        document.body
    );
};

// Question HTML (already sanitised) whose images open in the ImageViewer
export const ZoomableHtml = ({ html, className = '' }) => {
    const [image, setImage] = useState(null);

    const onClick = (e) => {
        // Clicks in the open viewer reach here too (React bubbles through portals)
        const img = e.currentTarget.contains(e.target) && e.target.closest?.('img');
        if (!img) return;
        e.preventDefault();
        setImage({ src: img.currentSrc || img.src, alt: img.alt || '' });
    };

    return (
        <>
            <div className={`[&_img]:cursor-zoom-in ${className}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
            {image && <ImageViewer src={image.src} alt={image.alt} onClose={() => setImage(null)} />}
        </>
    );
};
