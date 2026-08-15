import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    APPLICATION_NAME,
    createMacApplicationMenuTemplate,
    installMacApplicationMenu,
    setApplicationProcessName,
} = require('../electron/applicationIdentity');

test('keeps the macOS process and application menu name as RadExam', () => {
    const processObject = { title: '/Applications/RadExam.app/Contents/MacOS/RadExam' };
    assert.equal(setApplicationProcessName(processObject), APPLICATION_NAME);
    assert.equal(processObject.title, 'RadExam');

    const template = createMacApplicationMenuTemplate();
    assert.deepEqual(template[0], { role: 'appMenu', label: 'RadExam' });
});

test('installs an explicit application menu only on macOS', () => {
    const calls = [];
    const Menu = {
        buildFromTemplate(template) {
            calls.push(['build', template]);
            return { template };
        },
        setApplicationMenu(menu) {
            calls.push(['set', menu]);
        },
    };

    assert.equal(installMacApplicationMenu(Menu, 'win32'), null);
    assert.equal(calls.length, 0);
    assert.ok(installMacApplicationMenu(Menu, 'darwin'));
    assert.equal(calls[0][1][0].label, 'RadExam');
    assert.equal(calls[1][0], 'set');
});

