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

if (!existsSync(path.join(standaloneRoot, 'server.js'))) {
    throw new Error('Next.js standalone server was not generated');
}

mkdirSync(path.dirname(staticDestination), { recursive: true });
cpSync(staticSource, staticDestination, { recursive: true, force: true });
cpSync(publicSource, publicDestination, { recursive: true, force: true });
cpSync(electronSource, electronDestination, { recursive: true, force: true });

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
    },
};

writeFileSync(standalonePackagePath, `${JSON.stringify(desktopPackage, null, 2)}\n`);

console.log(`Prepared desktop runtime: ${path.relative(projectRoot, standaloneRoot)}`);
