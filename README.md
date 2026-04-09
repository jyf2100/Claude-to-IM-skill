# Claude-to-IM Skill

Bridge AI coding agents to IM platforms — chat with Claude Code, Codex, or any OpenAI-compatible LLM from Telegram, Discord, Feishu/Lark, QQ, or WeChat.

[中文文档](README_CN.md)

> **Want a desktop GUI instead?** Check out [CodePilot](https://github.com/op7418/CodePilot) — a full-featured desktop app with visual chat interface, session management, file tree preview, permission controls, and more. This skill was extracted from CodePilot's IM bridge module for users who prefer a lightweight, CLI-only setup.

---

## How It Works

This skill runs a background daemon that connects your IM bots to AI coding agent sessions. Messages from IM are forwarded to the AI agent, and responses (including tool use, permission requests, streaming previews) are sent back to your chat.

```
You (Telegram/Discord/Feishu/QQ/WeChat)
  ↕ Bot API
Background Daemon (Node.js)
  ↕ LLMProvider interface (configurable via CTI_RUNTIME)
     ├─ Claude Code SDK  → Anthropic API
     ├─ Codex SDK        → OpenAI API
     └─ OpenAI Compat    → Any /v1/chat/completions API
AI Agent → reads/writes your codebase
```

## Supported Runtimes

| Runtime | Config | How It Works |
|---------|--------|-------------|
| **Claude Code** | `CTI_RUNTIME=claude` | Spawns Claude CLI as subprocess → Anthropic API |
| **Codex** | `CTI_RUNTIME=codex` | Spawns Codex CLI as subprocess → OpenAI API |
| **OpenAI Compat** | `CTI_RUNTIME=openai-compat` | Direct HTTP to any `/v1/chat/completions` API |
| **Auto** | `CTI_RUNTIME=auto` | Tries Claude first, falls back to Codex |

The OpenAI-compatible runtime works with **Ollama, vLLM, OneAPI, LM Studio**, or any service implementing the `/v1/chat/completions` endpoint — no local CLI process needed.

## Features

- **Five IM platforms** — Telegram, Discord, Feishu/Lark, QQ, WeChat — enable any combination
- **Three AI runtimes** — Claude Code, Codex, or any OpenAI-compatible API (Ollama, vLLM, etc.)
- **Interactive setup** — guided wizard collects tokens with step-by-step instructions
- **Permission control** — tool calls require explicit approval via inline buttons (Telegram/Discord) or text `/perm` commands (Feishu/QQ)
- **WeChat support** — official OpenClaw plugin integration via weixin-agent-sdk, QR code login
- **Streaming preview** — see the AI's response as it types (Telegram & Discord)
- **Session persistence** — conversations survive daemon restarts
- **Secret protection** — tokens stored with `chmod 600`, auto-redacted in all logs
- **Zero code required** — install the skill and run `/claude-to-im setup`, that's it

## Prerequisites

- **Node.js >= 20** (>= 22 for WeChat)
- **Claude Code CLI** (for `CTI_RUNTIME=claude` or `auto`) — installed and authenticated (`claude` command available)
- **Codex CLI** (for `CTI_RUNTIME=codex` or `auto`) — `npm install -g @openai/codex`. Auth: run `codex auth login`, or set `OPENAI_API_KEY`
- **OpenAI-compatible API** (for `CTI_RUNTIME=openai-compat`) — any service implementing `/v1/chat/completions`

## Installation

### npx skills (recommended)

```bash
npx skills add op7418/Claude-to-IM-skill
```

### Git clone

```bash
git clone https://github.com/op7418/Claude-to-IM-skill.git ~/.claude/skills/claude-to-im
```

Clones the repo directly into your personal skills directory. Claude Code discovers it automatically.

### Symlink

If you prefer to keep the repo elsewhere (e.g., for development):

```bash
git clone https://github.com/op7418/Claude-to-IM-skill.git ~/code/Claude-to-IM-skill
mkdir -p ~/.claude/skills
ln -s ~/code/Claude-to-IM-skill ~/.claude/skills/claude-to-im
```

### Codex

If you use [Codex](https://github.com/openai/codex), clone directly into the Codex skills directory:

```bash
git clone https://github.com/op7418/Claude-to-IM-skill.git ~/.codex/skills/claude-to-im
```

Or use the provided install script for automatic dependency installation and build:

```bash
# Clone and install (copy mode)
git clone https://github.com/op7418/Claude-to-IM-skill.git ~/code/Claude-to-IM-skill
bash ~/code/Claude-to-IM-skill/scripts/install-codex.sh

# Or use symlink mode for development
bash ~/code/Claude-to-IM-skill/scripts/install-codex.sh --link
```

### Verify installation

**Claude Code:** Start a new session and type `/` — you should see `claude-to-im` in the skill list. Or ask Claude: "What skills are available?"

**Codex:** Start a new session and say "claude-to-im setup" or "start bridge" — Codex will recognize the skill and run the setup wizard.

## Quick Start

### 1. Setup

```
/claude-to-im setup
```

The wizard will guide you through:

1. **Choose channels** — pick Telegram, Discord, Feishu, QQ, or any combination
2. **Enter credentials** — the wizard explains exactly where to get each token, which settings to enable, and what permissions to grant
3. **Set defaults** — working directory, model, and mode
4. **Validate** — tokens are verified against platform APIs immediately

### 2. Start

```
/claude-to-im start
```

The daemon starts in the background. You can close the terminal — it keeps running.

### 3. Chat

Open your IM app and send a message to your bot. Claude Code will respond.

When Claude needs to use a tool (edit a file, run a command), you'll see a permission prompt with **Allow** / **Deny** buttons right in the chat (Telegram/Discord), or a text `/perm` command prompt (Feishu/QQ).

## Commands

All commands are run inside Claude Code or Codex:

| Claude Code | Codex (natural language) | Description |
|---|---|---|
| `/claude-to-im setup` | "claude-to-im setup" / "配置" | Interactive setup wizard |
| `/claude-to-im start` | "start bridge" / "启动桥接" | Start the bridge daemon |
| `/claude-to-im stop` | "stop bridge" / "停止桥接" | Stop the bridge daemon |
| `/claude-to-im status` | "bridge status" / "状态" | Show daemon status |
| `/claude-to-im logs` | "查看日志" | Show last 50 log lines |
| `/claude-to-im logs 200` | "logs 200" | Show last 200 log lines |
| `/claude-to-im reconfigure` | "reconfigure" / "修改配置" | Update config interactively |
| `/claude-to-im doctor` | "doctor" / "诊断" | Diagnose issues |

### WeChat Commands

WeChat runs separately from the main bridge. Use npm scripts directly:

```bash
npm run wechat:login   # Scan QR to connect WeChat
npm run wechat:start   # Start WeChat bridge daemon
npm run wechat:dev     # Development mode (foreground)
```

## Platform Setup Guides

The `setup` wizard provides inline guidance for every step. Here's a summary:

### Telegram

1. Message `@BotFather` on Telegram → `/newbot` → follow prompts
2. Copy the bot token (format: `123456789:AABbCc...`)
3. Recommended: `/setprivacy` → Disable (for group use)
4. Find your User ID: message `@userinfobot`

### Discord

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → New Application
2. Bot tab → Reset Token → copy it
3. Enable **Message Content Intent** under Privileged Gateway Intents
4. OAuth2 → URL Generator → scope `bot` → permissions: Send Messages, Read Message History, View Channels → copy invite URL

### Feishu / Lark

1. Go to [Feishu Open Platform](https://open.feishu.cn/app) (or [Lark](https://open.larksuite.com/app))
2. Create Custom App → get App ID and App Secret
3. **Batch-add permissions**: go to "Permissions & Scopes" → use batch configuration to add all required scopes (the `setup` wizard provides the exact JSON)
4. Enable Bot feature under "Add Features"
5. **Events & Callbacks**: select **"Long Connection"** as event dispatch method → add `im.message.receive_v1` event
6. **Publish**: go to "Version Management & Release" → create version → submit for review → approve in Admin Console
7. **Important**: The bot will NOT work until the version is approved and published

### QQ

> QQ currently supports **C2C private chat only**. No group/channel support, no inline permission buttons, no streaming preview. Permissions use text `/perm ...` commands. Image inbound only (no image replies).

1. Go to [QQ Bot OpenClaw](https://q.qq.com/qqbot/openclaw)
2. Create a QQ Bot or select an existing one → get **App ID** and **App Secret** (only two required fields)
3. Configure sandbox access and scan QR code with QQ to add the bot
4. `CTI_QQ_ALLOWED_USERS` takes `user_openid` values (not QQ numbers) — can be left empty initially
5. Set `CTI_QQ_IMAGE_ENABLED=false` if the underlying provider doesn't support image input

### WeChat (微信)

> **Requirements**: Node.js >= 22, latest WeChat app with OpenClaw plugin support (update via App Store or scan QR on login)

WeChat integration uses the official OpenClaw plugin via [weixin-agent-sdk](https://github.com/wong2/weixin-agent-sdk). It runs as a **separate process** from the main bridge daemon.

#### Setup

```bash
# 1. Login (scan QR code with WeChat)
npm run wechat:login

# 2. Start WeChat bridge
npm run wechat:start

# 3. (Optional) Development mode with auto-reload
npm run wechat:dev
```

#### Configuration

Add to `~/.claude-to-im/config.env`:

```bash
# WeChat settings
CTI_WEIXIN_AUTO_APPROVE=true   # Auto-approve tool permissions (recommended for WeChat)
CTI_WEIXIN_ACCOUNT_ID=         # Optional: specific account ID (auto-selected if empty)
CTI_WEIXIN_ALLOWED_USERS=      # Optional: comma-separated user IDs

# Runtime: claude | codex | openai-compat | auto
CTI_RUNTIME=claude

# If using openai-compat runtime:
# CTI_OPENAI_COMPAT_BASE_URL=http://localhost:8000/v1
# CTI_OPENAI_COMPAT_MODEL=hermes-agent
```

#### Limitations

- **No inline permission buttons** — WeChat doesn't support interactive buttons like Telegram/Discord
- **Auto-approve recommended** — Set `CTI_WEIXIN_AUTO_APPROVE=true` for tool usage
- **No streaming preview** — Response is sent after completion
- **Separate process** — WeChat runs independently from other channels (Telegram, Discord, etc.)

## Runtime Configuration

All runtime settings go in `~/.claude-to-im/config.env`:

### Claude Code (default)

```bash
CTI_RUNTIME=claude
# Claude CLI must be installed and authenticated
```

### Codex

```bash
CTI_RUNTIME=codex
# Codex CLI must be installed: npm install -g @openai/codex
# Auth via: codex auth login  OR  set OPENAI_API_KEY
```

### OpenAI-Compatible API

```bash
CTI_RUNTIME=openai-compat
CTI_OPENAI_COMPAT_BASE_URL=http://localhost:8000/v1   # Required
CTI_OPENAI_COMPAT_MODEL=hermes-agent                   # Required
CTI_OPENAI_COMPAT_API_KEY=sk-xxx                       # Optional
CTI_OPENAI_COMPAT_TIMEOUT=120000                       # Optional (ms, default 120000)
```

Works with any service implementing `/v1/chat/completions`: Ollama, vLLM, OneAPI, LM Studio, or self-hosted APIs.

### Auto

```bash
CTI_RUNTIME=auto
# Tries Claude CLI first; if not found or preflight fails, falls back to Codex
```

### Network Topology

All connections are **outbound** — no public IP, port mapping, or domain needed:

```
Your machine ──HTTPS──→ ilinkai.weixin.qq.com   (WeChat, long polling)
Your machine ──HTTPS──→ api.anthropic.com       (Claude)
Your machine ──HTTPS──→ api.openai.com          (Codex)
Your machine ──HTTP───→ localhost:8000/v1       (OpenAI-compat)
```

## Architecture

```
~/.claude-to-im/
├── config.env             ← Credentials & settings (chmod 600)
├── data/                  ← Persistent JSON storage
│   ├── sessions.json
│   ├── bindings.json
│   ├── permissions.json
│   └── messages/          ← Per-session message history
├── logs/
│   └── bridge.log         ← Auto-rotated, secrets redacted
└── runtime/
    ├── bridge.pid          ← Daemon PID file
    └── status.json         ← Current status
```

### Architecture Diagram

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   IM User   │ ←→ │  IM SDK / Bot API │ ←→ │  Bridge Daemon  │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                      │
                                                      ▼
                                            ┌─────────────────┐
                                            │   LLMProvider   │
                                            │   (interface)   │
                                            └────────┬────────┘
                                                      │
              ┌───────────────────────────────────────┼──────────────────────┐
              ▼                                       ▼                      ▼
     ┌─────────────────┐                    ┌─────────────────┐    ┌──────────────────┐
     │ SDKLLMProvider  │                    │  CodexProvider  │    │ OpenAICompat     │
     │ (Claude CLI)    │                    │  (Codex CLI)    │    │ Provider         │
     └────────┬────────┘                    └────────┬────────┘    └────────┬─────────┘
              │                                      │                      │
              ▼                                      ▼                      ▼
     ┌─────────────────┐                    ┌─────────────────┐    ┌──────────────────┐
     │  Anthropic API  │                    │   OpenAI API    │    │ Any OpenAI-compat│
     └─────────────────┘                    └─────────────────┘    │ API service      │
                                                                     └──────────────────┘
```

### Key components

| Component | File | Role |
|---|---|---|
| `src/main.ts` | Daemon entry | Assembles DI, starts bridge |
| `src/wechat-main.ts` | WeChat entry | Separate process for WeChat mode |
| `src/wechat-agent.ts` | WeChat agent | Bridges weixin-agent-sdk to LLMProvider |
| `src/config.ts` | Config | Load/save `config.env`, runtime selection |
| `src/store.ts` | Storage | JSON file BridgeStore (30 methods, write-through cache) |
| `src/llm-provider.ts` | Claude runtime | Claude Agent SDK `query()` → SSE stream |
| `src/codex-provider.ts` | Codex runtime | Codex SDK `runStreamed()` → SSE stream |
| `src/openai-compat-provider.ts` | OpenAI-compat runtime | Direct HTTP to `/v1/chat/completions`, SSE streaming |
| `src/sse-utils.ts` | Utility | Shared SSE formatting helper |
| `src/permission-gateway.ts` | Permissions | Async bridge: SDK `canUseTool` ↔ IM buttons |
| `src/logger.ts` | Logging | Secret-redacted file logging with rotation |
| `scripts/daemon.sh` | Process mgmt | start/stop/status/logs |
| `scripts/doctor.sh` | Diagnostics | Health checks |
| `SKILL.md` | Skill def | Claude Code skill definition |

### Permission flow

```
1. Claude wants to use a tool (e.g., Edit file)
2. SDK calls canUseTool() → LLMProvider emits permission_request SSE
3. Bridge sends inline buttons to IM chat: [Allow] [Deny]
4. canUseTool() blocks, waiting for user response (5 min timeout)
5. User taps Allow → bridge resolves the pending permission
6. SDK continues tool execution → result streamed back to IM
```

## Troubleshooting

Run diagnostics:

```
/claude-to-im doctor
```

This checks: Node.js version, config file existence and permissions, token validity (live API calls), log directory, PID file consistency, and recent errors.

| Issue | Solution |
|---|---|
| `Bridge won't start` | Run `doctor`. Check if Node >= 20. Check logs. |
| `Messages not received` | Verify token with `doctor`. Check allowed users config. |
| `Permission timeout` | User didn't respond within 5 min. Tool call auto-denied. |
| `Stale PID file` | Run `stop` then `start`. daemon.sh auto-cleans stale PIDs. |

See [references/troubleshooting.md](references/troubleshooting.md) for more details.

## Security

- All credentials stored in `~/.claude-to-im/config.env` with `chmod 600`
- Tokens are automatically redacted in all log output (pattern-based masking)
- Allowed user/channel/guild lists restrict who can interact with the bot
- The daemon is a local process with no inbound network listeners
- See [SECURITY.md](SECURITY.md) for threat model and incident response

## Development

```bash
npm install        # Install dependencies
npm run dev        # Run in dev mode
npm run typecheck  # Type check
npm test           # Run tests
npm run build      # Build bundle
```

## License

[MIT](LICENSE)
