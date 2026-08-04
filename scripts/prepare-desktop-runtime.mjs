import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const nextRoot = path.join(projectRoot, '.next');
const standaloneRoot = path.join(nextRoot, 'standalone');
const staticSource = path.join(nextRoot, 'static');
const staticDestination = path.join(standaloneRoot, '.next', 'static');
const publicSource = path.join(projectRoot, 'public');
const publicDestination = path.join(standaloneRoot, 'public');
const electronSource = path.join(projectRoot, 'electron');
const electronDestination = path.join(standaloneRoot, 'electron');
const rootPackagePath = path.join(projectRoot, 'package.json');
const standalonePackagePath = path.join(standaloneRoot, 'package.json');
const cloudSyncConfigPath = path.join(electronDestination, 'cloud-sync-config.json');

const ensureStandaloneDependency = dependencyName => {
    const dependencySegments = dependencyName.split('/');
    const dependencySource = path.join(
        projectRoot,
        'node_modules',
        ...dependencySegments
    );
    const dependencyDestination = path.join(
        standaloneRoot,
        'node_modules',
        ...dependencySegments
    );
    if (!existsSync(dependencyDestination)) {
        mkdirSync(path.dirname(dependencyDestination), { recursive: true });
        cpSync(dependencySource, dependencyDestination, { recursive: true });
    }
    const dependencyPackagePath = path.join(
        dependencyDestination,
        'package.json'
    );
    const dependencyPackage = JSON.parse(readFileSync(dependencyPackagePath, 'utf8'));
    return dependencyPackage.version;
};

const parseEnvText = text => {
    const values = {};
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator <= 0) continue;
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        values[key] = value;
    }
    return values;
};

if (!existsSync(path.join(standaloneRoot, 'server.js'))) {
    throw new Error('Next.js standalone server was not generated');
}

mkdirSync(path.dirname(staticDestination), { recursive: true });
cpSync(staticSource, staticDestination, { recursive: true, force: true });
cpSync(publicSource, publicDestination, { recursive: true, force: true });
cpSync(electronSource, electronDestination, { recursive: true, force: true });

const localEnvPath = path.join(projectRoot, '.env.local');
const localEnv = existsSync(localEnvPath)
    ? parseEnvText(readFileSync(localEnvPath, 'utf8'))
    : {};
const googleDesktopClientSecret = process.env.GOOGLE_DESKTOP_CLIENT_SECRET
    || localEnv.GOOGLE_DESKTOP_CLIENT_SECRET
    || '';
writeFileSync(cloudSyncConfigPath, `${JSON.stringify({
    googleDesktopClientSecret,
}, null, 2)}\n`, { mode: 0o600 });

const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
const standalonePackage = JSON.parse(readFileSync(standalonePackagePath, 'utf8'));
const desktopPackage = {
    name: rootPackage.name,
    version: rootPackage.version,
    private: true,
    productName: rootPackage.build?.productName || 'RadExam',
    description: 'RadExam desktop application',
    author: 'ywurij',
    main: 'electron/main.js',
    type: standalonePackage.type || 'commonjs',
    dependencies: {
        next: rootPackage.dependencies.next,
        react: rootPackage.dependencies.react,
        'react-dom': rootPackage.dependencies['react-dom'],
        // electron-builder may omit these transitive runtime dependencies from
        // a Next.js standalone directory unless they are listed directly.
        scheduler: ensureStandaloneDependency('scheduler'),
        tslib: ensureStandaloneDependency('tslib'),
    },
};

writeFileSync(standalonePackagePath, `${JSON.stringify(desktopPackage, null, 2)}\n`);

console.log(`Prepared desktop runtime: ${path.relative(projectRoot, standaloneRoot)}`);
