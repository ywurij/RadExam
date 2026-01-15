
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../src/data');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');
const PUBLIC_DIR = path.join(__dirname, '../public');
const MANIFEST_FILE = path.join(PUBLIC_DIR, 'data/image-manifest.json');
const IMAGE_BASE_DIR = path.join(PUBLIC_DIR, 'assets/images');

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

    fs.writeFileSync(METADATA_FILE, JSON.stringify(metadata, null, 2));
    console.log(`Metadata saved to ${METADATA_FILE}`);
}

function generateImageManifest() {
    console.log('Generating image manifest...');
    const imageManifest = {};

    EXAM_TYPES.forEach(examId => {
        const examDir = path.join(IMAGE_BASE_DIR, examId);
        imageManifest[examId] = [];

        if (fs.existsSync(examDir)) {
            const files = [];
            const getFiles = (dir) => {
                const items = fs.readdirSync(dir, { withFileTypes: true });
                items.forEach(item => {
                    const fullPath = path.join(dir, item.name);
                    if (item.isDirectory()) {
                        getFiles(fullPath);
                    } else if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(item.name)) {
                        // Get relative path from public root, normalize separators
                        const relativePath = fullPath.replace(PUBLIC_DIR, '').replace(/\\/g, '/');
                        files.push(relativePath);
                    }
                });
            };
            getFiles(examDir);
            imageManifest[examId] = files;
            console.log(`Found ${files.length} images for ${examId}`);
        } else {
            console.warn(`Warning: Image directory not found for ${examId}: ${examDir}`);
        }
    });

    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(imageManifest, null, 2));
    console.log(`Image manifest saved to ${MANIFEST_FILE}`);
}

function main() {
    generateMetadata();
    generateImageManifest();
}

main();
