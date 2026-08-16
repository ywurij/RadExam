import assert from 'node:assert/strict';
import test from 'node:test';

test('uses restrictive browser security headers without broad remote images', async () => {
    process.env.APP_TARGET = 'desktop';
    const { default: config } = await import(`../next.config.mjs?security=${Date.now()}`);
    const definitions = await config.headers();
    const headers = Object.fromEntries(definitions[0].headers.map(item => [item.key, item.value]));
    const csp = headers['Content-Security-Policy'];

    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /script-src-attr 'none'/);
    assert.match(csp, /manifest-src 'self'/);
    assert.match(csp, /media-src 'self' blob:/);
    assert.match(csp, /connect-src[^;]*https:\/\/\*\.1drv\.com/);
    assert.match(csp, /connect-src[^;]*https:\/\/\*\.microsoftpersonalcontent\.com/);
    assert.doesNotMatch(csp, /img-src[^;]*https:/);
    assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin-allow-popups');
    assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin');
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
});
