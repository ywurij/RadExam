
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../src/data');
const OUTPUT_FILE = path.join(DATA_DIR, 'metadata.json');

const EXAM_TYPES = ['radiology', 'diagnostic', 'nuclear', 'ivr'];

function generateMetadata() {
    console.log('Generating metadata...');
    const metadata = {};

    EXAM_TYPES.forEach(examId => {
        const filePath = path.join(DATA_DIR, `test_${examId}.json`);
        
        if (!fs.existsSync(filePath)) {
            console.warn(`Warning: Data file not found for ${examId}: ${filePath}`);
            metadata[examId] = { count: 0, years: [], genres: [] };
            return;
        }

        try {
            const rawData = fs.readFileSync(filePath, 'utf-8');
            const questions = JSON.parse(rawData);

            // 1. Count
            const count = questions.length;

            // 2. Years
            const yearsSet = new Set(questions.map(q => q.year).filter(y => y));
            const years = Array.from(yearsSet).sort((a, b) => b - a);

            // 3. Genres
            const genresSet = new Set();
            questions.forEach(q => {
                if (q.genre) genresSet.add(q.genre);
            });
            const genres = Array.from(genresSet).sort();

            metadata[examId] = {
                count,
                years,
                genres
            };

            console.log(`Processed ${examId}: ${count} questions`);

        } catch (e) {
            console.error(`Error processing ${examId}:`, e);
            metadata[examId] = { error: true };
        }
    });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(metadata, null, 2));
    console.log(`Metadata saved to ${OUTPUT_FILE}`);
}

generateMetadata();
