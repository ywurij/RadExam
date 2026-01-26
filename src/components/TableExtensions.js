import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';

export const CustomTableCell = TableCell.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            colwidth: {
                default: null,
                parseHTML: element => {
                    const colwidth = element.getAttribute('colwidth');
                    const value = colwidth ? [parseInt(colwidth, 10)] : null;
                    return value;
                },
                renderHTML: attributes => {
                    const width = attributes.colwidth && attributes.colwidth.length ? attributes.colwidth[0] : null;
                    return {
                        colwidth: attributes.colwidth,
                        style: width ? `width: ${width}px` : null,
                    }
                },
            },
        };
    },
});

export const CustomTableHeader = TableHeader.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            colwidth: {
                default: null,
                parseHTML: element => {
                    const colwidth = element.getAttribute('colwidth');
                    const value = colwidth ? [parseInt(colwidth, 10)] : null;
                    return value;
                },
                renderHTML: attributes => {
                    const width = attributes.colwidth && attributes.colwidth.length ? attributes.colwidth[0] : null;
                    return {
                        colwidth: attributes.colwidth,
                        style: width ? `width: ${width}px` : null,
                    }
                },
            },
        };
    },
});

export const CustomTable = Table.extend({
    addOptions() {
        return {
            ...this.parent?.(),
            renderWrapper: true,
            resizable: true,
        };
    },

    renderHTML({ HTMLAttributes }) {
        return ['div', { class: 'tableWrapper' }, ['table', HTMLAttributes, ['tbody', 0]]];
    },
});
