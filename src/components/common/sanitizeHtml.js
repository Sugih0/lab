import DOMPurify from 'dompurify';

// Instructions, lesson text and submission copies are HTML stored in Firestore.
// Strip scripts and event handlers before rendering so stored text can't run
// code in another user's browser. Links may keep target, with a safe rel.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.hasAttribute('target')) {
        node.setAttribute('rel', 'noopener noreferrer');
    }
});

export const sanitizeHtml = (html) => DOMPurify.sanitize(html ?? '', { ADD_ATTR: ['target'] });
