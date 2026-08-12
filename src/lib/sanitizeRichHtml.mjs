import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
    'p', 'br', 'span', 'div', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'sub', 'sup', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'hr',
    'h1', 'h2', 'h3', 'h4', 'a', 'img',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col',
];

export const sanitizeRichHtml = (value) => sanitizeHtml(String(value ?? ''), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
        '*': ['class', 'style', 'data-type', 'data-indent', 'latex'],
        a: ['href', 'target', 'rel', 'title'],
        img: ['src', 'alt', 'title', 'width', 'height'],
        th: ['colspan', 'rowspan', 'scope'],
        td: ['colspan', 'rowspan'],
        col: ['span', 'width'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    allowedStyles: {
        '*': {
            color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^[a-z]+$/i],
            'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s,.%]+\)$/i, /^[a-z]+$/i],
            'text-align': [/^(left|right|center|justify)$/],
            'margin-left': [/^\d+(\.\d+)?(px|em|rem|%)$/],
        },
    },
    transformTags: {
        a: (tagName, attributes) => ({
            tagName,
            attribs: attributes.target === '_blank'
                ? { ...attributes, rel: 'noopener noreferrer' }
                : attributes,
        }),
    },
});

const sanitizeImages = (images) => Array.isArray(images)
    ? images.map(image => {
        if (!image || typeof image !== 'object') return image;
        return {
            ...image,
            ...(Object.hasOwn(image, 'legend') ? { legend: sanitizeRichHtml(image.legend) } : {}),
            legendLayout: image.legendLayout && typeof image.legendLayout === 'object'
                ? {
                    ...image.legendLayout,
                    ...(Object.hasOwn(image.legendLayout, 'title')
                        ? { title: sanitizeRichHtml(image.legendLayout.title) }
                        : {}),
                    labels: Array.isArray(image.legendLayout.labels)
                        ? image.legendLayout.labels.map(label => (
                            label && typeof label === 'object'
                                ? { ...label, text: sanitizeRichHtml(label.text) }
                                : label
                        ))
                        : image.legendLayout.labels,
                }
                : image.legendLayout,
        };
    })
    : images;

export const sanitizeQuestionRichText = (question) => {
    if (!question || typeof question !== 'object') return question;
    return {
        ...question,
        ...(Object.hasOwn(question, 'question')
            ? { question: sanitizeRichHtml(question.question) }
            : {}),
        ...(Object.hasOwn(question, 'explanation')
            ? { explanation: sanitizeRichHtml(question.explanation) }
            : {}),
        ...(Object.hasOwn(question, 'options')
            ? {
                options: question.options && typeof question.options === 'object'
                    ? Object.fromEntries(Object.entries(question.options).map(([key, value]) => [key, sanitizeRichHtml(value)]))
                    : question.options,
            }
            : {}),
        ...(Object.hasOwn(question, 'images') ? { images: sanitizeImages(question.images) } : {}),
    };
};
