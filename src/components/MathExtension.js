import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export const MathExtension = Node.create({
    name: 'math',

    group: 'inline',

    inline: true,

    draggable: true,

    atom: true,

    addAttributes() {
        return {
            latex: {
                default: 'x',
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'span[data-type="math"]',
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'math' })];
    },

    addNodeView() {
        return ({ node, getPos, editor }) => {
            const dom = document.createElement('span');
            dom.classList.add('math-node');
            dom.style.cursor = 'pointer';
            dom.title = 'Click to edit formula';
            // contentEditable false is crucial for atoms in some browsers to handle cursor placement correctly around them
            dom.contentEditable = "false";

            const render = () => {
                try {
                    katex.render(node.attrs.latex, dom, {
                        throwOnError: false,
                        displayMode: false
                    });
                } catch (e) {
                    dom.textContent = node.attrs.latex + ' (Error)';
                    dom.style.color = 'red';
                }
            };

            render();

            dom.addEventListener('click', (e) => {
                e.preventDefault(); // Prevent default selection behavior
                if (!editor.isEditable) return;

                const newFormula = window.prompt('数式を入力 (LaTeX)', node.attrs.latex);
                if (newFormula !== null) {
                    if (typeof getPos === 'function') {
                        const pos = getPos();
                        // Dispatch transaction to update node
                        editor.view.dispatch(
                            editor.view.state.tr.setNodeMarkup(pos, undefined, {
                                latex: newFormula
                            })
                        );
                    }
                }
            });

            return {
                dom,
                ignoreMutation: () => true, // Ignore DOM mutations managed by Katex
                update: (updatedNode) => {
                    if (updatedNode.type.name !== this.name) return false;
                    if (updatedNode.attrs.latex === node.attrs.latex) return true; // No change

                    node = updatedNode;
                    render();
                    return true;
                }
            };
        };
    },

    addCommands() {
        return {
            insertMath: (latex = '') => ({ chain }) => {
                return chain()
                    .insertContent({
                        type: this.name,
                        attrs: { latex },
                    })
                    .run();
            },
        };
    },
});
