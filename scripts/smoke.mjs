// Hermetic smoke test: mock the `vscode` API, activate the bundled extension,
// verify its public commands/status entry point, then dispose every resource.
import Module from 'node:module';
import path from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const commands = new Map();
let statusItem;
let quickPickResult;
let saveDialogResult;
const writtenFiles = [];

const makeConfig = (section) => ({
  get: (key, def) => {
    if (section === 'tokenlens.passiveCapture' && key === 'enabled') return false;
    return def;
  },
  update: async () => {},
});

class EventEmitter {
  constructor() {
    this._handlers = [];
    this.event = (h) => {
      this._handlers.push(h);
      return { dispose: () => {} };
    };
  }
  fire(v) {
    for (const h of this._handlers) h(v);
  }
  dispose() {}
}

const vscodeMock = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  EventEmitter,
  Uri: {
    file: (f) => ({ fsPath: f, toString: () => f }),
    joinPath: (base, ...p) => ({ fsPath: path.join(base.fsPath ?? String(base), ...p) }),
  },
  RelativePattern: class {
    constructor(base, pattern) {
      this.base = base;
      this.pattern = pattern;
    }
  },
  window: {
    activeTextEditor: undefined,
    createOutputChannel: () => ({
      appendLine() {},
      append() {},
      clear() {},
      show() {},
      hide() {},
      dispose() {},
    }),
    createStatusBarItem: () => {
      statusItem = { text: '', tooltip: '', command: '', show() {}, hide() {}, dispose() {} };
      return statusItem;
    },
    registerWebviewViewProvider: () => ({ dispose() {} }),
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    showQuickPick: async () => quickPickResult,
    showSaveDialog: async () => saveDialogResult,
    onDidChangeWindowState: () => ({ dispose() {} }),
  },
  commands: {
    registerCommand: (id, cb) => {
      commands.set(id, cb);
      return { dispose() {} };
    },
    executeCommand: async (id, ...args) => {
      const cb = commands.get(id);
      return cb ? cb(...args) : undefined;
    },
  },
  workspace: {
    getConfiguration: makeConfig,
    fs: {
      writeFile: async (uri, content) => {
        writtenFiles.push({ uri, content: Buffer.from(content).toString('utf8') });
      },
    },
    onDidChangeConfiguration: () => ({ dispose() {} }),
    createFileSystemWatcher: () => ({
      onDidCreate: () => ({ dispose() {} }),
      onDidChange: () => ({ dispose() {} }),
      onDidDelete: () => ({ dispose() {} }),
      dispose() {},
    }),
  },
  env: { clipboard: { writeText: async () => {} } },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeMock;
  return origLoad.apply(this, arguments);
};

const ext = require(path.resolve('dist/extension.js'));
const manifest = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));

const memState = () => {
  const m = new Map();
  return {
    get: (k, d) => (m.has(k) ? m.get(k) : d),
    update: (k, v) => {
      m.set(k, v);
      return Promise.resolve();
    },
  };
};

const context = {
  subscriptions: [],
  globalState: memState(),
  workspaceState: memState(),
  secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} },
  extensionUri: { fsPath: process.cwd() },
  globalStorageUri: { fsPath: mkdtempSync(path.join(tmpdir(), 'tokenlens-smoke-')) },
};

ext.activate(context);
console.log('activate() ok — commands:', [...commands.keys()].join(', '));
console.log('initial status:', statusItem.text);

const expectedCommands = [
  'tokenlens.openDashboard',
  'tokenlens.manage',
  'tokenlens.toggleCapture',
  'tokenlens.togglePinChat',
  'tokenlens.pinChat',
  'tokenlens.unpinChat',
  'tokenlens.diagnostics',
  'tokenlens.captureSelfTest',
  'tokenlens.exportLedger',
  'tokenlens.clearLedger',
  'tokenlens.rebuildLedger',
  'tokenlens.ledgerDiagnostics',
];
for (const id of expectedCommands) {
  if (!commands.has(id)) {
    console.error(`SMOKE FAIL: command not registered: ${id}`);
    process.exitCode = 1;
  }
}
const publicCommands = manifest.contributes.commands.map((entry) => entry.command);
if (
  JSON.stringify(publicCommands) !==
  JSON.stringify([
    'tokenlens.openDashboard',
    'tokenlens.toggleCapture',
    'tokenlens.togglePinChat',
    'tokenlens.exportLedger',
    'tokenlens.rebuildLedger',
    'tokenlens.manage',
  ])
) {
  console.error(`SMOKE FAIL: unexpected public commands: ${publicCommands.join(', ')}`);
  process.exitCode = 1;
}
if (statusItem.text !== '$(debug-pause) Token Lens') {
  console.error(`SMOKE FAIL: unexpected initial status: ${statusItem.text}`);
  process.exitCode = 1;
}

await commands.get('tokenlens.openDashboard')();
quickPickResult = { label: 'Open dashboard', command: 'tokenlens.openDashboard' };
await commands.get('tokenlens.manage')();
// Let the async empty-ledger initialization settle before lifecycle cleanup.
await new Promise((resolve) => setTimeout(resolve, 50));

quickPickResult = { label: 'JSON' };
saveDialogResult = vscodeMock.Uri.file(path.join(context.globalStorageUri.fsPath, 'usage.json'));
await commands.get('tokenlens.exportLedger')();
const jsonExport = JSON.parse(writtenFiles.at(-1)?.content ?? 'null');
if (
  jsonExport?.kind !== 'token-lens-local-usage-ledger' ||
  jsonExport?.privacy?.metadataOnly !== true ||
  !Array.isArray(jsonExport?.records)
) {
  console.error('SMOKE FAIL: JSON export contract or privacy marker is invalid.');
  process.exitCode = 1;
}

quickPickResult = { label: 'CSV' };
saveDialogResult = vscodeMock.Uri.file(path.join(context.globalStorageUri.fsPath, 'usage.csv'));
await commands.get('tokenlens.exportLedger')();
const csvExport = writtenFiles.at(-1)?.content ?? '';
if (!csvExport.includes('metering_status') || csvExport.includes('prompt_text')) {
  console.error('SMOKE FAIL: CSV export is missing status or contains a content column.');
  process.exitCode = 1;
}

// ExtensionContext owns lifecycle cleanup in VS Code; mimic that here so leaked
// intervals/listeners make the smoke test fail by hanging instead of being hidden.
for (const disposable of context.subscriptions.slice().reverse()) {
  disposable?.dispose?.();
}

Module._load = origLoad;
rmSync(context.globalStorageUri.fsPath, { recursive: true, force: true });

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('SMOKE PASS: activation, contributions, command routing, and disposal succeeded.');
