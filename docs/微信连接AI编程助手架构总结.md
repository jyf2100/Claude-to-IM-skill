# 微信连接 AI 编程助手架构总结

## 架构图

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   微信用户   │ ←→ │  weixin-agent-sdk │ ←→ │  WeChatAgent    │
│  (OpenClaw)  │     │   (微信 SDK)       │     │  (Agent 适配器)  │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                      │
                                                      ▼
                                            ┌─────────────────┐
                                            │   LLMProvider   │
                                            │   (接口抽象)     │
                                            └────────┬────────┘
                                                      │
              ┌───────────────────────────────────────┼───────────────────────────┐
              ▼                                       ▼                           ▼
     ┌─────────────────┐                    ┌─────────────────┐          ┌──────────────────┐
     │ SDKLLMProvider  │                    │CodexProvider    │          │OpenAICompat      │
     │ (Claude CLI)    │                    │(Codex CLI)      │          │Provider          │
     └────────┬────────┘                    └────────┬────────┘          └────────┬─────────┘
              │                                      │                            │
              ▼                                      ▼                            ▼
     ┌─────────────────┐                    ┌─────────────────┐          ┌──────────────────┐
     │  Anthropic API  │                    │   OpenAI API    │          │ 任意 OpenAI 兼容  │
     └─────────────────┘                    └─────────────────┘          │   API 服务       │
                                                                           └──────────────────┘
```

## 支持的运行时

| 运行时 | 组件 | 通信方式 | 适用场景 |
|--------|------|----------|----------|
| `claude` | SDKLLMProvider → Claude CLI → Anthropic API | 本地 CLI 子进程 | Claude Code 编程 |
| `codex` | CodexProvider → Codex CLI → OpenAI API | 本地 CLI 子进程 | Codex 编程 |
| `openai-compat` | OpenAICompatProvider → HTTP API | 直接 HTTP 请求 | 任意 OpenAI 兼容服务 |
| `auto` | 先试 Claude，失败回退 Codex | 自动选择 | 混合场景 |

## 运行时切换

```bash
# ~/.claude-to-im/config.env

# Claude Code
CTI_RUNTIME=claude

# OpenAI Codex
CTI_RUNTIME=codex

# OpenAI 兼容 API（如 Ollama、vLLM、OneAPI、自建服务等）
CTI_RUNTIME=openai-compat
CTI_OPENAI_COMPAT_BASE_URL=http://192.168.31.113:8642/v1
CTI_OPENAI_COMPAT_MODEL=hermes-agent

# 自动选择
CTI_RUNTIME=auto
```

## 关键组件

| 组件 | 文件 | 作用 |
|------|------|------|
| `weixin-agent-sdk` | 外部依赖 | 微信 OpenClaw 连接，接收/发送消息 |
| `WeChatAgent` | `src/wechat-agent.ts` | 适配器，连接微信 SDK 与 LLMProvider |
| `LLMProvider` | 接口抽象 | 屏蔽底层 LLM 差异 |
| `SDKLLMProvider` | `src/llm-provider.ts` | Claude CLI 封装 |
| `CodexProvider` | `src/codex-provider.ts` | Codex CLI 封装 |
| `OpenAICompatProvider` | `src/openai-compat-provider.ts` | OpenAI 兼容 API 直接调用 |

## OpenAI 兼容模式

### 特点

- **无本地进程**：直接 HTTP 请求，不拉起 CLI
- **零额外依赖**：只用原生 `fetch`
- **流式 SSE**：支持流式响应
- **会话记忆**：自动维护多轮对话历史
- **图片支持**：支持 vision 格式（base64 图片）

### 配置项

```bash
CTI_OPENAI_COMPAT_BASE_URL   # API 地址（如 http://localhost:8000/v1）
CTI_OPENAI_COMPAT_API_KEY    # API Key（可选）
CTI_OPENAI_COMPAT_MODEL      # 模型名称（如 hermes-agent）
CTI_OPENAI_COMPAT_TIMEOUT    # 超时时间 ms（默认 120000）
```

### 兼容的服务

- Ollama
- vLLM
- OneAPI / New API
- LM Studio
- 自建 OpenAI 兼容服务
- 任何实现 `/v1/chat/completions` 的服务

## 微信注册方式

**不需要注册！** 扫码即用：

```bash
npm run wechat:login   # 扫二维码
npm run wechat:start   # 启动桥接
```

## 所有连接都是出站的

```
你的机器 ──HTTPS──→ ilinkai.weixin.qq.com  (微信云端，长轮询)
你的机器 ──HTTPS──→ api.anthropic.com     (Claude)
你的机器 ──HTTP───→ 192.168.31.113:8642   (OpenAI 兼容)
```

不需要公网 IP、端口映射、域名。

---
*创建日期: 2026-03-24*
*更新日期: 2026-04-09*
*项目: claude-to-im-skill*
