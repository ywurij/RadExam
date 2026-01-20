
const Fuse = require('fuse.js');

const mockData = [
    {
        id: 1,
        question: '<p>これは<strong>MRI</strong>の問題です。</p>',
        options: { a: 'あ', b: 'い' },
        explanation: 'ここに詳しい解説があります。CTとは異なります。'
    },
    {
        id: 2,
        question: '放射線の影響について',
        options: { a: 'A', b: 'B' },
        explanation: '確定的影響と確率的影響がある。'
    }
];

const keys = ['question', 'options.a', 'explanation'];
const options = {
    keys: keys,
    threshold: 0.3,
    ignoreLocation: true
};

const fuse = new Fuse(mockData, options);

const testQueries = ['MRI', 'CT', '影響', '確率的', 'random'];

testQueries.forEach(q => {
    const res = fuse.search(q);
    console.log(`Query: "${q}" -> Hits: ${res.length}`);
    res.forEach(r => console.log(` - ID: ${r.item.id}`));
});
