import fs from 'fs';

const content = fs.readFileSync('d:\\Projects\\MVP\\apps\\web\\src\\CourtSync.tsx', 'utf8');

const divOpens = (content.match(/<div(?!\w)/g) || []).length;
const divCloses = (content.match(/<\/div>/g) || []).length;
const providerOpens = (content.match(/<AppContext\.Provider/g) || []).length;
const providerCloses = (content.match(/<\/AppContext\.Provider>/g) || []).length;
const fragmentOpens = (content.match(/<>/g) || []).length;
const fragmentCloses = (content.match(/<\/>/g) || []).length;
const braceOpens = (content.match(/{[^{}]*\(/g) || []).length; // Very rough check for block opens
const braceCloses = (content.match(/\)}/g) || []).length; // Very rough check for block closes

console.log({
    divOpens,
    divCloses,
    providerOpens,
    providerCloses,
    fragmentOpens,
    fragmentCloses,
    braceOpens,
    braceCloses
});
