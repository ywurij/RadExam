import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

export const HtmlTagExtension = Extension.create({
    name: 'htmlTagExtension',

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('htmlTagParsing'),
                appendTransaction: (transactions, oldState, newState) => {
                    const docChanged = transactions.some(tr => tr.docChanged);
                    if (!docChanged) return;

                    const matches = [];
                    // Regex for sup and sub
                    // Note: We use global flag to find all matches, but we must be careful about indices shifting if we replace.
                    // Best strategy: find matches, then process them in reverse order (last to first) to avoid index shifting.

                    const supRegex = /<sup>(.*?)<\/sup>/g;
                    const subRegex = /<sub>(.*?)<\/sub>/g;

                    newState.doc.descendants((node, pos) => {
                        if (node.isText) {
                            // Collect SUP matches
                            for (const match of node.text.matchAll(supRegex)) {
                                matches.push({
                                    type: 'sup',
                                    start: pos + match.index,
                                    end: pos + match.index + match[0].length,
                                    text: match[1]
                                });
                            }
                            // Collect SUB matches
                            for (const match of node.text.matchAll(subRegex)) {
                                matches.push({
                                    type: 'sub',
                                    start: pos + match.index,
                                    end: pos + match.index + match[0].length,
                                    text: match[1]
                                });
                            }
                        }
                    });

                    if (matches.length === 0) return;

                    const tr = newState.tr;
                    // Sort reverse to handle replacements safely
                    matches.sort((a, b) => b.start - a.start);

                    let modified = false;

                    matches.forEach(match => {
                        // Double check validity (in case of overlaps, though text descendants usually don't overlap)
                        // Apply mark and replace
                        const markType = match.type === 'sup' ? newState.schema.marks.superscript : newState.schema.marks.subscript;

                        if (markType) {
                            tr.replaceWith(
                                match.start,
                                match.end,
                                newState.schema.text(match.text, [markType.create()])
                            );
                            modified = true;
                        }
                    });

                    if (modified) return tr;
                },
            }),
        ];
    },
});
