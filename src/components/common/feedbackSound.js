// Sound for a checked answer, the same in Python Advance and the Blockly
// auto-check: correct.mp3 when it passes, error.mp3 when it doesn't
export const playSound = (type) => {
    try {
        if (type === 'success') {
            const audio = new Audio('/assets/sounds/correct.mp3');
            audio.play().catch(e => console.warn("Could not play sound:", e));
        } else if (type === 'error') {
            const audio = new Audio('/assets/sounds/error.mp3');
            audio.play().catch(e => console.warn("Could not play sound:", e));
        }
    } catch (e) {
        console.error("Audio play failed", e);
    }
};
