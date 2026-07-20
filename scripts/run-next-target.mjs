import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

const [target, command, ...args] = process.argv.slice(2);

if (!['desktop', 'mobile'].includes(target) || !['dev', 'build', 'start'].includes(command)) {
    console.error('Usage: node scripts/run-next-target.mjs <desktop|mobile> <dev|build|start> [...args]');
    process.exit(1);
}

const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');

// ターゲットを切り替えた際に、前回ビルドのルートやチャンクが混在しないよう生成物だけを初期化する。
if (command === 'build') {
    rmSync(path.join(process.cwd(), '.next'), { recursive: true, force: true });
}

const child = spawn(process.execPath, [nextBin, command, ...args], {
    stdio: 'inherit',
    env: {
        ...process.env,
        APP_TARGET: target,
    },
});

child.on('error', error => {
    console.error(error);
    process.exit(1);
});

child.on('exit', (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});
