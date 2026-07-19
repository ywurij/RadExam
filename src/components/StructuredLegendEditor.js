"use client";

import styles from './StructuredLegendEditor.module.scss';

const POSITIONS = [
    { value: 'top', label: '上' },
    { value: 'bottom', label: '下' },
    { value: 'left', label: '左' },
    { value: 'right', label: '右' },
];

const clampOffset = value => Math.max(0, Math.min(1, Number(value) || 0));

export const summarizeLegendLayout = (legendLayout) => {
    const title = String(legendLayout?.title || '').trim();
    const labels = (Array.isArray(legendLayout?.labels) ? legendLayout.labels : [])
        .map(label => String(label?.text || '').trim())
        .filter((text, index, values) => text && values.indexOf(text) === index);

    if (title && labels.length > 0) return `${title} (${labels.join(', ')})`;
    return title || labels.join(', ');
};

export const createStructuredLegendFromText = (legend) => {
    const text = String(legend || '').trim();
    const match = text.match(/^(.*?)\s*[（(]([^（）()]*)[）)]\s*$/);
    if (!match) return { title: text, labels: [] };

    const labels = match[2]
        .split(/[,、，\/／・]+/)
        .map(value => value.trim())
        .filter(Boolean);
    return {
        title: match[1].trim(),
        labels: labels.map((label, index) => ({
            text: label,
            position: 'left',
            offset: (index + 1) / (labels.length + 1),
        })),
    };
};

export default function StructuredLegendEditor({ legendLayout, onChange, onDisable }) {
    const layout = {
        title: String(legendLayout?.title || ''),
        labels: Array.isArray(legendLayout?.labels) ? legendLayout.labels : [],
    };

    const commit = nextLayout => onChange?.(nextLayout, summarizeLegendLayout(nextLayout));
    const updateLabel = (index, updates) => commit({
        ...layout,
        labels: layout.labels.map((label, labelIndex) => (
            labelIndex === index
                ? { ...label, ...updates, offset: clampOffset(updates.offset ?? label.offset) }
                : label
        )),
    });

    return <div className={styles.editor}>
        <div className={styles.header}>
            <strong>構造化レジェンド</strong>
            <button type="button" onClick={() => onDisable?.(summarizeLegendLayout(layout))}>通常形式に戻す</button>
        </div>

        <label className={styles.titleField}>
            <span>中央タイトル</span>
            <input
                value={layout.title}
                onChange={event => commit({ ...layout, title: event.target.value })}
                placeholder="例：水平長軸像"
            />
        </label>

        <div className={styles.labels}>
            {layout.labels.map((label, index) => {
                const offsetPercent = Math.round(clampOffset(label.offset) * 100);
                return <div className={styles.labelRow} key={`${index}-${label.position}`}>
                    <input
                        aria-label={`ラベル${index + 1}の文字`}
                        value={label.text || ''}
                        onChange={event => updateLabel(index, { text: event.target.value })}
                        placeholder="ラベル"
                    />
                    <select
                        aria-label={`ラベル${index + 1}の表示辺`}
                        value={label.position || 'bottom'}
                        onChange={event => updateLabel(index, { position: event.target.value })}
                    >
                        {POSITIONS.map(position => <option key={position.value} value={position.value}>{position.label}</option>)}
                    </select>
                    <label className={styles.offsetField}>
                        <span>位置 {offsetPercent}%</span>
                        <input
                            aria-label={`ラベル${index + 1}の位置`}
                            type="range"
                            min="0"
                            max="100"
                            value={offsetPercent}
                            onChange={event => updateLabel(index, { offset: Number(event.target.value) / 100 })}
                        />
                    </label>
                    <button
                        type="button"
                        className={styles.deleteButton}
                        onClick={() => commit({ ...layout, labels: layout.labels.filter((_, labelIndex) => labelIndex !== index) })}
                        aria-label={`ラベル${index + 1}を削除`}
                    >
                        ×
                    </button>
                </div>;
            })}
        </div>

        <button
            type="button"
            className={styles.addButton}
            onClick={() => commit({
                ...layout,
                labels: [...layout.labels, { text: '', position: 'bottom', offset: 0.5 }],
            })}
        >
            ＋ ラベルを追加
        </button>
    </div>;
}
