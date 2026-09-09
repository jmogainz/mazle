#!/usr/bin/env node

/**
 * Dependency-free Adventure browser smoke test.
 *
 * It drives a locally installed Chrome through the DevTools protocol so the
 * repository does not need Playwright/Puppeteer. Adventure API calls are
 * deliberately answered with 503s to exercise the offline/local-first path.
 *
 * Usage (with the web app already running):
 *   node tests/adventure-web/smoke.mjs http://127.0.0.1:3100
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function requireLoopbackBaseUrl(rawValue) {
  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(`Adventure smoke base URL must be an HTTP(S) loopback URL: ${rawValue}`);
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (!['http:', 'https:'].includes(parsed.protocol)
    || !loopbackHosts.has(parsed.hostname.toLowerCase())
    || parsed.username
    || parsed.password) {
    throw new Error(`Adventure smoke refuses non-loopback base URL: ${rawValue}`);
  }
  return parsed.href.replace(/\/$/, '');
}

const baseUrl = requireLoopbackBaseUrl(process.argv[2] ?? 'http://127.0.0.1:3100');
const chromePath = process.env.CHROME_PATH
  ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const debugPort = Number(process.env.CHROME_DEBUG_PORT ?? 9333);
const outputDirectory = process.env.ADVENTURE_QA_OUTPUT
  ?? join(tmpdir(), 'mazle-adventure-web-qa');
const profileDirectory = mkdtempSync(join(tmpdir(), 'mazle-adventure-chrome-'));
mkdirSync(outputDirectory, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/adventure`);
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Adventure server did not become ready at ${baseUrl}.`);
}

async function waitForJson(path, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
      if (response.ok) return await response.json();
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome DevTools endpoint did not become ready.');
}

class DevToolsClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(message.params ?? {});
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
    return () => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  }

  once(method) {
    return new Promise((resolve) => {
      const unsubscribe = this.on(method, (params) => {
        unsubscribe();
        resolve(params);
      });
    });
  }

  close() {
    this.socket.close();
  }
}

async function main() {
  await waitForServer();
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--hide-scrollbars',
    '--no-first-run',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDirectory}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let client;
  const screenshots = [];
  const checks = [];
  try {
    const targets = await waitForJson('/json/list');
    const pageTarget = targets.find((target) => target.type === 'page');
    assert(pageTarget?.webSocketDebuggerUrl, 'Chrome did not expose a page target.');
    client = new DevToolsClient(pageTarget.webSocketDebuggerUrl);
    await client.connect();
    const browserDiagnostics = [];
    await Promise.all([
      client.send('Page.enable'),
      client.send('Runtime.enable'),
      client.send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/adventure/*' }] }),
    ]);
    const apiScenario = {
      mode: 'offline',
      syncBodies: [],
      serverScope: 'guest',
    };
    client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      browserDiagnostics.push(exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? 'Unknown page exception');
    });
    client.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type !== 'error') return;
      browserDiagnostics.push(args?.map((argument) => argument.value ?? argument.description).join(' ') ?? 'Console error');
    });

    client.on('Fetch.requestPaused', ({ requestId, request }) => {
      const path = new URL(request.url).pathname;
      if (apiScenario.mode === 'scoped' && path === '/api/adventure/sync') {
        try { apiScenario.syncBodies.push(JSON.parse(request.postData ?? '{}')); } catch {}
      }
      const scopedState = apiScenario.mode === 'scoped'
        && (path === '/api/adventure/state' || path === '/api/adventure/sync');
      const responseBody = scopedState ? {
        ok: true,
        storageScope: apiScenario.serverScope,
        progress: {
          catalogVersion: '1.0.0', currentLevel: 1, unlockedLevel: 1,
          completedLevels: 0, totalStars: 0, completedAll: false, levels: [],
        },
        energy: {
          hearts: 2, maxHearts: 3,
          nextHeartAt: new Date(Date.now() + 1_800_000).toISOString(),
          refillTickets: 0, dailyRefillAvailable: false,
          serverNow: new Date().toISOString(),
        },
        activeAttempt: null,
        accountRequiredForPurchases: true,
      } : {
        error: 'ADVENTURE_FAILED',
        code: 'ADVENTURE_FAILED',
        message: 'Intentional browser smoke-test API outage.',
      };
      const body = Buffer.from(JSON.stringify(responseBody)).toString('base64');
      void client.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: scopedState ? 200 : 503,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Cache-Control', value: 'no-store' },
        ],
        body,
      });
    });

    const evaluate = async (expression) => {
      const response = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description ?? 'Browser evaluation failed.');
      }
      return response.result?.value;
    };

    const waitFor = async (expression, label, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return;
        await delay(100);
      }
      const pageText = await evaluate("document.body?.innerText?.slice(0, 1500) ?? ''");
      throw new Error(`Timed out waiting for ${label}.\nPage: ${pageText}\nDiagnostics: ${browserDiagnostics.join('\n')}`);
    };

    const setViewport = async (width, height, mobile = true) => {
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile,
        screenWidth: width,
        screenHeight: height,
      });
      await evaluate('window.dispatchEvent(new Event("resize")); true');
      await delay(250);
    };

    const screenshot = async (name) => {
      const result = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const path = join(outputDirectory, `${name}.png`);
      writeFileSync(path, Buffer.from(result.data, 'base64'));
      screenshots.push(path);
    };

    const click = (selector) => evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) return false;
      element.click();
      return true;
    })()`);

    const clickButtonNamed = (name) => evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.trim().includes(${JSON.stringify(name)}));
      if (!button) return false;
      button.click();
      return true;
    })()`);

    const accessibleMove = (direction) => click(`button[aria-label="Move ${direction}"]`);

    const pressKey = async (key) => {
      await evaluate(`(() => {
        const options = { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true, cancelable: true };
        document.dispatchEvent(new KeyboardEvent('keydown', options));
        window.dispatchEvent(new KeyboardEvent('keydown', options));
        document.dispatchEvent(new KeyboardEvent('keyup', options));
        window.dispatchEvent(new KeyboardEvent('keyup', options));
        return true;
      })()`);
    };

    const swipe = async (direction) => {
      const points = await evaluate(`(() => {
        const canvas = document.querySelector('[data-testid=adventure-game] canvas');
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      assert(points, 'Adventure board was unavailable for swipe input.');
      const delta = { up: [0, -90], down: [0, 90], left: [-90, 0], right: [90, 0] }[direction];
      assert(delta, `Unknown swipe direction: ${direction}`);
      const [dx, dy] = delta;
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: points.x, y: points.y, radiusX: 1, radiusY: 1 }],
      });
      await delay(50);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: points.x + dx, y: points.y + dy, radiusX: 1, radiusY: 1 }],
      });
      await delay(50);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };

    const movesLeft = () => evaluate("document.querySelector('[data-testid=adventure-moves-remaining]')?.textContent?.trim() ?? null");

    const assertNoHorizontalOverflow = async (selector, label) => {
      const metrics = await evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          elementScrollWidth: element.scrollWidth,
          elementClientWidth: element.clientWidth,
          left: rect.left,
          right: rect.right,
        };
      })()`);
      assert(metrics, `${label} was not present.`);
      assert(metrics.documentWidth <= metrics.viewportWidth, `${label} overflowed the document horizontally.`);
      assert(metrics.elementScrollWidth <= metrics.elementClientWidth + 1, `${label} overflowed its own horizontal bounds.`);
      assert(metrics.left >= -1 && metrics.right <= metrics.viewportWidth + 1, `${label} rendered outside the viewport.`);
      checks.push(`${label}: no horizontal overflow at ${metrics.viewportWidth}px`);
    };

    await setViewport(390, 844);
    const storageResetScript = await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try {
        localStorage.setItem('mazle_storage_scope_v1', 'guest');
        localStorage.removeItem('mazle_adventure_progress_v1');
        localStorage.removeItem('mazle_adventure_progress_v1:guest');
        localStorage.removeItem('mazle_adventure_progress_v1:user:qa-account');
      } catch {}`,
    });
    const loaded = client.once('Page.loadEventFired');
    await client.send('Page.navigate', { url: `${baseUrl}/adventure` });
    await loaded;
    await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: storageResetScript.identifier });
    await waitFor("!!document.querySelector('[data-testid=adventure-map]')", 'Adventure map');
    await assertNoHorizontalOverflow('[data-testid=adventure-map]', 'Adventure map');
    await screenshot('01-map-390x844-api-offline');

    assert(await click('[data-testid="adventure-level-1"]'), 'Could not open level 1.');
    await waitFor("!!document.querySelector('[data-testid=adventure-level-sheet]')", 'level 1 intro sheet');
    await delay(400);
    const introText = await evaluate("document.querySelector('[data-testid=adventure-level-sheet]')?.textContent ?? ''");
    assert(introText.includes('First Footprints'), 'Level 1 title was missing from the intro sheet.');
    assert(introText.includes('Starter levels never use hearts.'), 'Starter energy protection copy was missing.');
    await screenshot('02-level-intro-390x844');

    assert(await click('[data-testid="adventure-play-level"]'), 'Could not start level 1.');
    await waitFor("!!document.querySelector('[data-testid=adventure-game]')", 'Adventure game');
    await waitFor("!!document.querySelector('[data-testid=adventure-game] canvas')", 'Adventure board');
    await assertNoHorizontalOverflow('[data-testid=adventure-game]', 'Adventure game');
    const initialAdventureHudText = await evaluate("document.querySelector('[data-testid=adventure-game]')?.textContent ?? ''");
    assert(!initialAdventureHudText.includes('LIVES'), 'Adventure HUD retained the Daily LIVES label.');
    await screenshot('03-game-390x844');

    assert(await click('button[aria-label="Leave level"]'), 'Could not open the quit dialog.');
    await waitFor("!!document.querySelector('[role=dialog][aria-labelledby=quit-title]')", 'quit dialog');
    const movesBeforeModalKey = await movesLeft();
    await pressKey('ArrowUp');
    await delay(500);
    assert(await movesLeft() === movesBeforeModalKey, 'Keyboard movement leaked through the quit dialog.');
    await pressKey('Escape');
    await waitFor("!document.querySelector('[role=dialog][aria-labelledby=quit-title]')", 'quit dialog dismissal');
    checks.push('Quit dialog pauses keyboard movement and closes with Escape');

    const movesBeforeSwipe = await movesLeft();
    await swipe('up');
    await delay(650);
    assert((await movesLeft()) === String(Number(movesBeforeSwipe) - 1), 'Swipe did not issue a movement.');
    checks.push('Adventure swipe input moves the player');
    await delay(550);
    assert(await click('button[aria-label="Leave level"]'), 'Could not reopen the quit dialog after moving.');
    await waitFor("!!document.querySelector('[role=dialog][aria-labelledby=quit-title]')", 'moved starter-level quit dialog');
    const movedQuitText = await evaluate("document.querySelector('[role=dialog][aria-labelledby=quit-title]')?.textContent ?? ''");
    assert(movedQuitText.includes('Starter levels are heart-free'), 'Protected-level quit dialog incorrectly claimed a heart would be used.');
    await pressKey('Escape');
    await waitFor("!document.querySelector('[role=dialog][aria-labelledby=quit-title]')", 'moved quit dialog dismissal');
    checks.push('Protected-level quit copy remains heart-free after a move');

    for (const direction of ['up', 'left', 'left']) {
      assert(await accessibleMove(direction), `Could not issue accessible ${direction} move.`);
      await delay(550);
    }
    await waitFor("!!document.querySelector('[data-testid=adventure-result]')", 'level 1 result', 10_000);
    await delay(800);
    const resultText = await evaluate("document.querySelector('[data-testid=adventure-result]')?.textContent ?? ''");
    assert(resultText.includes('LEVEL COMPLETE'), 'UULL did not complete level 1.');
    assert(resultText.includes('MOVES4'), 'Result did not report four moves.');
    assert(resultText.includes('BEST STARS3/3'), 'Result did not award three stars.');
    checks.push('Level 1 UULL completion awards 3 stars in 4 moves with API unavailable');
    await screenshot('04-result-390x844');

    assert(await clickButtonNamed('Back to map'), 'Could not return to the Adventure map.');
    await waitFor("!!document.querySelector('[data-testid=adventure-map]')", 'map after result');
    const levelTwoUnlocked = await evaluate("!document.querySelector('[data-testid=adventure-level-2]')?.disabled");
    assert(levelTwoUnlocked, 'Level 2 did not unlock after local fallback completion.');
    const storedProgress = await evaluate("JSON.parse(localStorage.getItem('mazle_adventure_progress_v1:guest') || '{}').progress?.['1'] ?? null");
    assert(storedProgress?.stars === 3 && storedProgress?.bestMoves === 4, 'Level 1 progress was not persisted locally.');
    checks.push('Result-to-map transition unlocks level 2 and persists progress');
    await screenshot('05-map-progress-390x844');

    await evaluate(`(() => {
      localStorage.setItem('mazle_adventure_progress_v1:user:11111111-1111-4111-8111-111111111111', JSON.stringify({
        catalogVersion: 'adventure-v1',
        progress: {},
        energy: { hearts: 2, maxHearts: 3, nextHeartAt: new Date(Date.now() + 1_800_000).toISOString(), refillTickets: 0, dailyRefillAvailable: false },
        activeAttempt: null,
      }));
      localStorage.setItem('mazle_storage_scope_v1', 'user:11111111-1111-4111-8111-111111111111');
      window.dispatchEvent(new Event('mazle_storage_scope_changed_v1'));
      return true;
    })()`);
    const accountCacheReady = `document.querySelector('[data-testid=adventure-level-2]')?.disabled === true
      && document.querySelector('button[aria-label*="hearts"]')?.getAttribute('aria-label')?.startsWith('2 of 3')`;
    await waitFor(accountCacheReady, 'isolated account map');
    await delay(300);
    await waitFor(accountCacheReady, 'stable isolated account map');
    const accountScope = await evaluate(`(() => ({
      guest: JSON.parse(localStorage.getItem('mazle_adventure_progress_v1:guest') || '{}'),
      account: JSON.parse(localStorage.getItem('mazle_adventure_progress_v1:user:11111111-1111-4111-8111-111111111111') || '{}'),
      heartLabel: document.querySelector('button[aria-label*="hearts"]')?.getAttribute('aria-label') ?? '',
    }))()`);
    assert(accountScope.guest.progress?.['1']?.stars === 3, 'Switching scope damaged the guest progress cache.');
    assert(!accountScope.account.progress?.['1'], 'Guest progress leaked into the account cache.');
    assert(
      accountScope.heartLabel.startsWith('2 of 3'),
      `The account-scoped energy cache was not loaded (found ${JSON.stringify(accountScope.heartLabel)}).`,
    );

    await evaluate(`(() => {
      localStorage.setItem('mazle_storage_scope_v1', 'guest');
      window.dispatchEvent(new Event('mazle_storage_scope_changed_v1'));
      return true;
    })()`);
    await waitFor("document.querySelector('[data-testid=adventure-level-2]')?.disabled === false", 'restored guest map');
    checks.push('Guest and signed-in Adventure caches remain isolated across live storage-scope changes');

    assert(await click('[data-testid="adventure-level-1"]'), 'Could not reopen level 1 for failure coverage.');
    await waitFor("!!document.querySelector('[data-testid=adventure-level-sheet]')", 'failure-run level sheet');
    assert(await click('[data-testid="adventure-play-level"]'), 'Could not start the failure coverage run.');
    await waitFor("!!document.querySelector('[data-testid=adventure-game] canvas')", 'failure-run Adventure board');
    await waitFor(
      "document.querySelector('button[aria-label=\"Move up\"]')?.disabled === false",
      'failure-run movement controls',
    );
    const issueFailureMove = async (direction, waitForCounter = true) => {
      const before = await movesLeft();
      assert(await accessibleMove(direction), `Could not issue accessible failure ${direction} move.`);
      if (!waitForCounter) return;
      await delay(550);
      const after = await movesLeft();
      assert(after === String(Number(before) - 1), `Failure ${direction} move did not register (${before} → ${after}).`);
    };
    for (const direction of ['down', 'down', 'left', 'right', 'left', 'right']) {
      await issueFailureMove(direction);
    }
    const failureResultStartedAt = Date.now();
    await issueFailureMove('left', false);
    await waitFor("!!document.querySelector('[data-testid=adventure-result]')", 'failure result without solution reveal', 5_000);
    const failureResultDelay = Date.now() - failureResultStartedAt;
    assert(failureResultDelay < 2_500, `Adventure failure waited ${failureResultDelay}ms, suggesting route analysis still ran.`);
    const failureText = await evaluate("document.querySelector('[data-testid=adventure-result]')?.textContent ?? ''");
    assert(failureText.includes('SO CLOSE'), 'Move-limit failure did not present the failure result.');
    assert(failureText.includes('No heart was used.'), 'Protected starter failure incorrectly claimed a heart was consumed.');
    checks.push(`Adventure move-limit failure skips solution reveal (${failureResultDelay}ms) and protects starter hearts`);
    await delay(400);
    const failurePageText = await evaluate("document.body?.innerText ?? ''");
    assert(!failurePageText.includes('+30s'), 'Adventure failure displayed the Daily-mode 30-second penalty.');
    await screenshot('05b-protected-failure-390x844');
    assert(await clickButtonNamed('Back to map'), 'Could not leave the failure result.');
    await waitFor("!!document.querySelector('[data-testid=adventure-map]')", 'map after failure result');

    await setViewport(320, 568);
    await assertNoHorizontalOverflow('[data-testid=adventure-map]', 'Small portrait map');
    await screenshot('06-map-320x568');
    assert(await click('[data-testid="adventure-level-1"]'), 'Could not reopen level 1 on small portrait.');
    await waitFor("!!document.querySelector('[data-testid=adventure-level-sheet]')", 'small portrait level sheet');
    await delay(400);
    const smallSheet = await evaluate(`(() => {
      const rect = document.querySelector('[data-testid=adventure-level-sheet]')?.getBoundingClientRect();
      return rect ? { top: rect.top, bottom: rect.bottom, height: rect.height, viewport: innerHeight } : null;
    })()`);
    assert(smallSheet && smallSheet.top >= -1 && smallSheet.bottom <= smallSheet.viewport + 1, 'Level sheet escaped the 320x568 viewport.');
    await screenshot('07-level-intro-320x568');
    await pressKey('Escape');

    await setViewport(844, 390, false);
    assert(await click('[data-testid="adventure-level-1"]'), 'Could not open level 1 in landscape.');
    await waitFor("!!document.querySelector('[data-testid=adventure-level-sheet]')", 'landscape level sheet');
    assert(await click('[data-testid="adventure-play-level"]'), 'Could not start landscape level.');
    await waitFor("!!document.querySelector('[data-testid=adventure-game] canvas')", 'landscape Adventure board');
    await delay(400);
    const landscapeGame = await evaluate(`(() => {
      const game = document.querySelector('[data-testid=adventure-game]')?.getBoundingClientRect();
      const canvas = document.querySelector('[data-testid=adventure-game] canvas')?.getBoundingClientRect();
      return game && canvas ? {
        gameTop: game.top, gameBottom: game.bottom, viewport: innerHeight,
        canvasWidth: canvas.width, canvasHeight: canvas.height,
        documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
      } : null;
    })()`);
    assert(landscapeGame, 'Landscape game metrics were unavailable.');
    assert(landscapeGame.gameTop >= -1 && landscapeGame.gameBottom <= landscapeGame.viewport + 1, 'Landscape game escaped the viewport vertically.');
    assert(Math.abs(landscapeGame.canvasWidth - landscapeGame.canvasHeight) <= 1, 'Landscape board was stretched out of square.');
    assert(landscapeGame.documentWidth <= landscapeGame.viewportWidth, 'Landscape game overflowed horizontally.');
    checks.push(`Landscape game contained at 844x390 (game ${Math.round(landscapeGame.gameTop)}–${Math.round(landscapeGame.gameBottom)}px of ${landscapeGame.viewport}px; board ${Math.round(landscapeGame.canvasWidth)}x${Math.round(landscapeGame.canvasHeight)}px)`);
    await screenshot('08-game-844x390');

    assert(await click('button[aria-label="Leave level"]'), 'Could not leave the landscape level.');
    await waitFor("!!document.querySelector('[role=dialog][aria-labelledby=quit-title]')", 'landscape quit dialog');
    await delay(400);
    await screenshot('09-quit-dialog-844x390');
    assert(await clickButtonNamed('Leave level'), 'Could not confirm landscape exit.');
    await waitFor("!!document.querySelector('[data-testid=adventure-map]')", 'map after landscape exit');

    await setViewport(390, 844);
    const accountA = 'user:11111111-1111-4111-8111-111111111111';
    const accountB = 'user:22222222-2222-4222-8222-222222222222';
    apiScenario.mode = 'scoped';
    apiScenario.serverScope = accountB;
    apiScenario.syncBodies.length = 0;
    await evaluate(`(() => {
      localStorage.setItem('mazle_storage_scope_v1', ${JSON.stringify(accountA)});
      localStorage.setItem('mazle_adventure_progress_v1:' + ${JSON.stringify(accountA)}, JSON.stringify({
        catalogVersion: '1.0.0',
        progress: { 1: { stars: 3, bestMoves: 4, bestTimeMs: 1200 } },
        energy: { hearts: 3, maxHearts: 3, nextHeartAt: null, refillTickets: 9, dailyRefillAvailable: false },
        activeAttempt: null,
      }));
      localStorage.removeItem('mazle_adventure_progress_v1:' + ${JSON.stringify(accountB)});
      return true;
    })()`);
    const accountReload = client.once('Page.loadEventFired');
    await client.send('Page.reload', { ignoreCache: true });
    await accountReload;
    await waitFor("!!document.querySelector('[data-testid=adventure-map]')", 'server-scoped account map');
    await waitFor(`localStorage.getItem('mazle_storage_scope_v1') === ${JSON.stringify(accountB)}`, 'server account scope');
    const serverScopedAccount = await evaluate(`(() => ({
      levelTwoLocked: document.querySelector('[data-testid=adventure-level-2]')?.disabled === true,
      accountA: JSON.parse(localStorage.getItem('mazle_adventure_progress_v1:' + ${JSON.stringify(accountA)}) || '{}'),
      accountB: JSON.parse(localStorage.getItem('mazle_adventure_progress_v1:' + ${JSON.stringify(accountB)}) || '{}'),
    }))()`);
    assert(serverScopedAccount.levelTwoLocked, 'Account A progress appeared in the server-selected account B map.');
    assert(serverScopedAccount.accountA.progress?.['1']?.stars === 3, 'Switching accounts damaged account A cache.');
    assert(!serverScopedAccount.accountB.progress?.['1'], 'Account A progress leaked into account B cache.');
    assert(apiScenario.syncBodies.length === 0, 'The client uploaded account A progress into account B.');
    checks.push('Server-confirmed identity prevents stale account A progress from uploading into account B');

    apiScenario.mode = 'offline';
    await evaluate(`(() => {
      localStorage.setItem('mazle_storage_scope_v1', 'guest');
      localStorage.setItem('mazle_adventure_progress_v1:guest', JSON.stringify({
        catalogVersion: 'adventure-v1',
        progress: {},
        energy: { hearts: 100, maxHearts: 100, nextHeartAt: 'not-a-date', refillTickets: 0, dailyRefillAvailable: false },
        activeAttempt: null,
      }));
      return true;
    })()`);
    const reloaded = client.once('Page.loadEventFired');
    await client.send('Page.reload', { ignoreCache: true });
    await reloaded;
    await waitFor("!!document.querySelector('[data-testid=adventure-map]')", 'map after malformed energy reload');
    await delay(1_200);
    const energyText = await evaluate("document.querySelector('button[aria-label*=\"hearts\"]')?.textContent ?? ''");
    assert(!energyText.includes('NaN'), 'Malformed energy timestamp rendered NaN.');
    const heartLabel = await evaluate("document.querySelector('button[aria-label*=\"hearts\"]')?.getAttribute('aria-label') ?? ''");
    assert(heartLabel.startsWith('5 of 5'), `Persisted max hearts was not capped at 5: ${heartLabel}`);
    checks.push('Malformed energy timestamps recover and persisted max hearts is capped at 5');
    await screenshot('10-sanitized-energy-390x844');

    const summaryPath = join(outputDirectory, 'summary.json');
    writeFileSync(summaryPath, JSON.stringify({ baseUrl, checks, screenshots }, null, 2));
    process.stdout.write(`${JSON.stringify({ ok: true, checks, screenshots, summaryPath }, null, 2)}\n`);
  } finally {
    client?.close();
    chrome.kill('SIGTERM');
    await delay(250);
    rmSync(profileDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
