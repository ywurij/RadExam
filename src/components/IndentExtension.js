import { Extension } from '@tiptap/core';

export const IndentExtension = Extension.create({
    name: 'indent',

    addOptions() {
        return {
            types: ['paragraph', 'heading'],
            indentUnits: 20,
            maxIndent: 200,
        };
    },

    addGlobalAttributes() {
        return [
            {
                types: this.options.types,
                attributes: {
                    indent: {
                        default: 0,
                        parseHTML: element => {
                            const marginLeft = element.style.marginLeft;
                            return marginLeft ? parseInt(marginLeft, 10) : 0;
                        },
                        renderHTML: attributes => {
                            if (!attributes.indent) {
                                return {};
                            }
                            return { style: `margin-left: ${attributes.indent}px` };
                        },
                    },
                },
            },
        ];
    },

    addCommands() {
        return {
            indent: () => ({ tr, state, dispatch }) => {
                const { selection } = state;
                const { from, to } = selection;

                tr.doc.nodesBetween(from, to, (node, pos) => {
                    if (this.options.types.includes(node.type.name)) {
                        const currentIndent = node.attrs.indent || 0;
                        const newIndent = Math.min(currentIndent + this.options.indentUnits, this.options.maxIndent);

                        if (currentIndent !== newIndent) {
                            tr = tr.setNodeMarkup(pos, null, {
                                ...node.attrs,
                                indent: newIndent
                            });
                        }
                    }
                });

                if (dispatch) dispatch(tr);
                return true;
            },
            outdent: () => ({ tr, state, dispatch }) => {
                const { selection } = state;
                const { from, to } = selection;

                tr.doc.nodesBetween(from, to, (node, pos) => {
                    if (this.options.types.includes(node.type.name)) {
                        const currentIndent = node.attrs.indent || 0;
                        const newIndent = Math.max(currentIndent - this.options.indentUnits, 0);

                        if (currentIndent !== newIndent) {
                            tr = tr.setNodeMarkup(pos, null, {
                                ...node.attrs,
                                indent: newIndent
                            });
                        }
                    }
                });

                if (dispatch) dispatch(tr);
                return true;
            },
        };
    },

    addKeyboardShortcuts() {
        return {
            'Tab': () => this.editor.commands.indent(),
            'Shift-Tab': () => this.editor.commands.outdent(),
        };
    }
});
