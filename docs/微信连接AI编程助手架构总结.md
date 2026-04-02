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
                          ┌───────────────────────────┴───────────────────────────┐
                          ▼                                                       ▼
                 ┌─────────────────┐                                  ┌─────────────────┐
                 │ SDKLLMProvider  │                                  │CodexProvider    │
                 └────────┬────────┘                                  └────────┬────────┘
                          │                                                       │
                          ▼                                                       ▼
                 ┌─────────────────┐                                  ┌─────────────────┐
                 │   Claude CLI    │                                  │    Codex CLI     │
                 │  (本地进程)      │                                  │   (本地进程)      │
                 └────────┬────────┘                                  └────────┬────────┘
                          │                                                       │
                          ▼                                                       ▼
                 ┌─────────────────┐                                  ┌─────────────────┐
                 │  Anthropic API  │                                  │   OpenAI API    │
                 └─────────────────┘                                  └─────────────────┘
```

## 关键组件

| 组件 | 作用 |
|------|------|
| `weixin-agent-sdk` | 微信连接，接收/发送消息 |
| `WeChatAgent` | 适配器，连接微信 SDK 与 LLMProvider |
| `LLMProvider` | 接口抽象，屏蔽底层差异 |
| `SDKLLMProvider` | Claude 实现 |
| `CodexProvider` | Codex 实现 |
| `Claude CLI` | 本地进程，调用 Anthropic API |
| `Codex CLI` | 本地进程，调用 OpenAI API |

## 运行时切换

```bash
CTI_RUNTIME=claude   # 使用 Claude CLI → Anthropic API
CTI_RUNTIME=codex   # 使用 Codex CLI → OpenAI API
CTI_RUNTIME=auto     # 先试 Claude，失败则回退 Codex
```

## 两者共同点

- 都由桥接服务**按需拉起本地 CLI 进程**
- 进程处理完请求后退出
- 会话数据保存在各服务端（Anthropic / OpenAI）

---
*创建日期: 2026-03-24*
*项目: claude-to-im-skill*
