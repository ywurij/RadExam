import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeQuestionRichText, sanitizeRichHtml } from '../src/lib/sanitizeRichHtml.mjs';

test('危険なHTMLとイベントハンドラを除去する', () => {
    const result = sanitizeRichHtml('<p onclick="steal()">本文<script>steal()</script><a href="javascript:steal()">link</a><img src="x" onerror="steal()"></p>');
    assert.equal(result, '<p>本文<a>link</a><img src="x" /></p>');
});

test('表、数式、許可された装飾を保持する', () => {
    const result = sanitizeRichHtml('<table><tbody><tr><td colspan="2"><span data-type="math" latex="x^2" style="text-align:center">式</span></td></tr></tbody></table>');
    assert.match(result, /<table>/);
    assert.match(result, /colspan="2"/);
    assert.match(result, /data-type="math"/);
    assert.match(result, /latex="x\^2"/);
});

test('問題に含まれるすべてのリッチテキスト欄を無害化する', () => {
    const result = sanitizeQuestionRichText({
        question: '<img src=x onerror=alert(1)>',
        explanation: '<script>alert(1)</script><b>解説</b>',
        options: { a: '<a href="javascript:alert(1)">選択肢</a>' },
        images: [{ legend: '<svg onload=alert(1)>危険</svg>', legendLayout: { title: '<i>図</i>', labels: [{ text: '<span onclick=alert(1)>A</span>' }] } }],
    });
    assert.equal(result.question, '<img src="x" />');
    assert.equal(result.explanation, '<b>解説</b>');
    assert.equal(result.options.a, '<a>選択肢</a>');
    assert.equal(result.images[0].legend, '危険');
    assert.equal(result.images[0].legendLayout.title, '<i>図</i>');
    assert.equal(result.images[0].legendLayout.labels[0].text, '<span>A</span>');
});

test('部分更新に存在しないフィールドを追加しない', () => {
    const result = sanitizeQuestionRichText({ question: '<b>本文</b>' });
    assert.deepEqual(result, { question: '<b>本文</b>' });
});
