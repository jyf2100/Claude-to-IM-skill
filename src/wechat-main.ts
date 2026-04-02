/**
 * WeChat entry point for claude-to-im-skill.
 *
 * Provides separate login and start commands for WeChat mode,
 * using weixin-agent-sdk's lifecycle management.
 */

import { login, start } from 'weixin-agent-sdk';
import { loadConfig, configToSettings, CTI_HOME } from './config.js';
import { JsonFileStore } from './store.js';
import { SDKLLMProvider, resolveClaudeCliPath, preflightCheck } from './llm-provider.js';
import { PendingPermissions } from './permission-gateway.js';
import { WeChatAgent } from './wechat-agent.js';
import { setupLogger } from './logger.js';
import fs from 'node:fs';
import path from 'node:path';

const RUNTIME_DIR = path.join(CTI_HOME, 'runtime');
const WECHAT_STATUS_FILE = path.join(RUNTIME_DIR, 'wechat-status.json');
const WECHAT_PID_FILE = path.join(RUNTIME_DIR, 'wechat.pid');

// Node.js version check (weixin-agent-sdk requires >= 22)
const NODE_MAJOR = parseInt(process.version.slice(1).split('.')[0], 10);
if (NODE_MAJOR < 22) {
  console.error(
    `[claude-to-im] FATAL: WeChat mode requires Node.js >= 22 (current: ${process.version})\n` +
    `  weixin-agent-sdk has this requirement.\n` +
    `  Upgrade Node.js or use a version manager (nvm, fnm, etc.).`
  );
  process.exit(1);
}

interface WeChatStatus {
  running: boolean;
  pid?: number;
  startedAt?: string;
}

function writeStatus(info: WeChatStatus): void {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const tmp = WECHAT_STATUS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(info, null, 2), 'utf-8');
  fs.renameSync(tmp, WECHAT_STATUS_FILE);
}

function printUsage(): void {
  console.log(`
Usage: tsx src/wechat-main.ts <command>

Commands:
  login    Scan QR code to connect WeChat account
  start    Start the WeChat bridge daemon
  dev      Start in development mode (foreground)
  status   Show WeChat bridge status
  help     Show this help message

Environment variables:
  CTI_HOME                Configuration directory (default: ~/.claude-to-im)
  CTI_RUNTIME             Runtime: claude | codex | auto (default: claude)
  CTI_DEFAULT_WORKDIR     Default working directory for Claude
  CTI_DEFAULT_MODEL       Default model name
  CTI_WEIXIN_AUTO_APPROVE Auto-approve tool permissions (default: false)
`);
}

async function doLogin(): Promise<void> {
  console.log('[claude-to-im] Starting WeChat login...');
  try {
    const accountId = await login();
    console.log(`[claude-to-im] ✅ WeChat connected! Account ID: ${accountId}`);
    console.log('[claude-to-im] You can now run: npm run wechat:start');
  } catch (err) {
    console.error('[claude-to-im] Login failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function doStart(devMode = false): Promise<void> {
  const config = loadConfig();
  setupLogger();

  console.log('[claude-to-im] Starting WeChat bridge...');
  console.log(`[claude-to-im] Runtime: ${config.runtime}`);

  // Resolve LLM provider
  const pendingPerms = new PendingPermissions();
  const cliPath = resolveClaudeCliPath();

  if (config.runtime === 'codex') {
    const { CodexProvider } = await import('./codex-provider.js');
    const llm = new CodexProvider(pendingPerms);
    const agent = new WeChatAgent(llm, config, pendingPerms);
    await runAgent(agent, devMode);
    return;
  }

  if (config.runtime === 'auto' && !cliPath) {
    console.log('[claude-to-im] Auto: Claude CLI not found, falling back to Codex');
    const { CodexProvider } = await import('./codex-provider.js');
    const llm = new CodexProvider(pendingPerms);
    const agent = new WeChatAgent(llm, config, pendingPerms);
    await runAgent(agent, devMode);
    return;
  }

  if (!cliPath) {
    console.error(
      '[claude-to-im] FATAL: Cannot find the `claude` CLI executable.\n' +
      '  Set CTI_RUNTIME=codex to use Codex instead'
    );
    process.exit(1);
  }

  const check = preflightCheck(cliPath);
  if (!check.ok) {
    console.error(`[claude-to-im] FATAL: Claude CLI preflight failed: ${check.error}`);
    process.exit(1);
  }

  console.log(`[claude-to-im] CLI: ${cliPath} (${check.version})`);

  const llm = new SDKLLMProvider(pendingPerms, cliPath, config.weixinAutoApprove || config.autoApprove);
  const agent = new WeChatAgent(llm, config, pendingPerms);

  await runAgent(agent, devMode);
}

async function runAgent(agent: WeChatAgent, devMode: boolean): Promise<void> {
  const config = loadConfig();

  // Write PID file
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(WECHAT_PID_FILE, String(process.pid), 'utf-8');
  writeStatus({ running: true, pid: process.pid, startedAt: new Date().toISOString() });

  console.log(`[claude-to-im] WeChat bridge started (PID: ${process.pid})`);
  console.log(`[claude-to-im] Auto-approve: ${config.weixinAutoApprove || config.autoApprove || false}`);

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal?: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const reason = signal ? `signal: ${signal}` : 'shutdown requested';
    console.log(`[claude-to-im] Shutting down (${reason})...`);
    writeStatus({ running: false });
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));

  // Error handling
  process.on('unhandledRejection', (reason) => {
    console.error('[claude-to-im] unhandledRejection:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[claude-to-im] uncaughtException:', err.stack || err.message);
    writeStatus({ running: false });
    process.exit(1);
  });

  // Start the WeChat bot
  const abortController = new AbortController();

  try {
    await start(agent, {
      accountId: config.weixinAccountId,
      abortSignal: abortController.signal,
      log: (msg: string) => console.log(`[weixin] ${msg}`),
    });
  } catch (err) {
    console.error('[claude-to-im] WeChat bridge error:', err instanceof Error ? err.message : err);
    writeStatus({ running: false });
    process.exit(1);
  }
}

function doStatus(): void {
  try {
    const status: WeChatStatus = JSON.parse(fs.readFileSync(WECHAT_STATUS_FILE, 'utf-8'));
    console.log('WeChat Bridge Status:');
    console.log(`  Running: ${status.running}`);
    if (status.pid) console.log(`  PID: ${status.pid}`);
    if (status.startedAt) console.log(`  Started: ${status.startedAt}`);
  } catch {
    console.log('WeChat Bridge Status: not running (no status file)');
  }
}

// Main entry
const [,, command] = process.argv;

switch (command) {
  case 'login':
    doLogin();
    break;
  case 'start':
    doStart(false);
    break;
  case 'dev':
    doStart(true);
    break;
  case 'status':
    doStatus();
    break;
  case 'help':
  case '--help':
  case '-h':
    printUsage();
    break;
  default:
    if (command) {
      console.error(`Unknown command: ${command}`);
    }
    printUsage();
    process.exit(command ? 1 : 0);
}
