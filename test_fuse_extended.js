
const Fuse = require('fuse.js');

const mockData = [
    {
        id: 1,
        text: '脳梗塞の診断にはMRIが有効です。'
    },
    {
        id: 2,
        text: 'MRIは磁気共鳴画像法のことです。'
    }
];

// Standard Search
const fuseStandard = new Fuse(mockData, {
    keys: ['text'],
    threshold: 0.3
});

// Extended Search
const fuseExtended = new Fuse(mockData, {
    keys: ['text'],
    threshold: 0.3,
    useExtendedSearch: true
});

const query = "MRI 診断"; // User types this
console.log(`--- Query: "${query}" ---`);

console.log("Standard Search Results:");
const res1 = fuseStandard.search(query);
res1.forEach(r => console.log(` - [${r.item.id}] ${r.item.text}`));

console.log("Extended Search (Raw Query) Results:");
const res2 = fuseExtended.search(query);
res2.forEach(r => console.log(` - [${r.item.id}] ${r.item.text}`));

// Transform query to AND search: "'MRI '診断"
const transformedQuery = query.trim().split(/\s+/).map(s => `'${s}`).join(' ');
console.log(`Extended Search (Transformed: "${transformedQuery}") Results:`);
const res3 = fuseExtended.search(transformedQuery);
res3.forEach(r => console.log(` - [${r.item.id}] ${r.item.text}`));
