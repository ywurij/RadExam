"use client";

import {
    changeOptionLayoutMode,
    getEditableOptionCells,
    getOptionColumnCount,
    getOptionLayoutError,
    getOptionLayoutMode,
    updateOptionCell,
} from '@/lib/optionLayout.mjs';
import styles from './OptionFormatEditor.module.scss';

export default function OptionFormatEditor({ options = {}, optionLayout, optionKeys = Object.keys(options).sort(), onChange }) {
    const mode = getOptionLayoutMode(optionLayout);
    const columnCount = getOptionColumnCount(optionLayout);
    const error = getOptionLayoutError(options, optionLayout);
    const updateOption = (key, value) => onChange({ options: { ...options, [key]: value } });

    return <div className={styles.editor}>
        <label className={styles.modeLabel}>
            選択肢の形式
            <select value={mode} onChange={event => onChange({ optionLayout: changeOptionLayoutMode(optionLayout, event.target.value) })}>
                <option value="normal">通常形式</option>
                <option value="columns2">組み合わせ形式（2列）</option>
                <option value="columns3">組み合わせ形式（3列）</option>
            </select>
        </label>
        {mode !== 'normal' && <div className={styles.headers}>
            {Array.from({ length: columnCount }, (_, index) => <label key={index}>
                {index + 1}列目の名前
                <input
                    value={optionLayout?.headers?.[index] || ''}
                    onChange={event => onChange({
                        optionLayout: {
                            ...optionLayout,
                            headers: Array.from({ length: columnCount }, (_, headerIndex) => (
                                headerIndex === index ? event.target.value : optionLayout?.headers?.[headerIndex] || ''
                            )),
                        },
                    })}
                />
            </label>)}
        </div>}
        <div className={styles.options}>
            {optionKeys.map(key => {
                const value = options[key] || '';
                const cells = mode === 'normal' ? null : getEditableOptionCells(value, columnCount);
                return <div className={styles.optionRow} key={key}>
                    <strong>{key}.</strong>
                    {mode === 'normal' || !cells
                        ? <input
                            aria-label={`選択肢 ${key}`}
                            value={value}
                            onChange={event => updateOption(key, event.target.value)}
                        />
                        : <div className={styles.cells}>
                            {cells.map((cell, index) => <input
                                key={index}
                                aria-label={`選択肢 ${key} の${index + 1}列目`}
                                value={cell}
                                onChange={event => updateOption(key, updateOptionCell(value, columnCount, index, event.target.value))}
                            />)}
                        </div>}
                </div>;
            })}
        </div>
        {mode !== 'normal' && <p className={styles.hint}>既存の文章は1列目に残ります。列が多すぎる選択肢は元の文章を表示するので、「―」で区切り直してください。</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
    </div>;
}
