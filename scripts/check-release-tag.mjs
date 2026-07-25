import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const validateReleaseTag = (tag, version) => {
    const expectedTag = `v${version}`;
    if (tag !== expectedTag) {
        throw new Error(`Release tag ${tag || '(empty)'} must match package version ${expectedTag}.`);
    }
    return expectedTag;
};

const isDirectRun = process.argv[1]
    && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
    const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    try {
        const tag = validateReleaseTag(process.argv[2], packageJson.version);
        console.log(`Release tag verified: ${tag}`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
