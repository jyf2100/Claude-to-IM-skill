# 微信连接 AI 编程助手实现方案

支持 Claude Code 和 OpenAI Codex 两种运行时。

## 架构概览

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   微信用户   │ ←→ │  weixin-agent-sdk │ ←→ │  WeChatAgent    │
│  (OpenClaw)  │     │   (微信 SDK)       │     │  (Agent 适配器)  │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                      │
                                                      ▼
                                            ┌─────────────────┐
                                            │   LLM Provider  │
                                            │  (LLMProvider)  │
                                            └────────┬────────┘
                                                      │
                          ┌───────────────────────────┴───────────────────────────┐
                          ▼                                                       ▼
                 ┌─────────────────┐                                  ┌─────────────────┐
                 │ SDKLLMProvider  │                                  │ CodexProvider   │
                 │ (Claude CLI)    │                                  │ (@openai/codex) │
                 └─────────────────┘                                  └─────────────────┘
```

## 核心组件

### 1. weixin-agent-sdk (第三方 SDK)

- 通过微信 OpenClaw 插件接入
- 提供 `Agent` 接口：`chat(request) → Promise<ChatResponse>`
- 使用长轮询获取消息

### 2. WeChatAgent (`src/wechat-agent.ts`)

- 实现 weixin-agent-sdk 的 `Agent` 接口
- 将同步 `chat()` 调用转换为异步 SSE 流消费
- 管理 conversationId → sdkSessionId 映射（会话连续性）
- 处理权限请求（自动批准或拒绝）

### 3. LLM Provider（运行时选择）

#### SDKLLMProvider (`src/llm-provider.ts`)

- 使用 `@anthropic-ai/claude-agent-sdk` 的 `query()` 函数
- 将 Claude CLI 输出转换为 SSE 格式流
- 处理工具调用权限

#### CodexProvider (`src/codex-provider.ts`)

- 使用 `@openai/codex-sdk` 的 `thread.runStreamed()` 函数
- 将 Codex 事件转换为 SSE 格式流
- 支持图片、文件修改、命令执行等

## 关键代码

### wechat-agent.ts - 核心适配器

```typescript
export class WeChatAgent implements Agent {
  private sessions = new Map<string, string>();  // 会话持久化

  async chat(request: ChatRequest): Promise<ChatResponse> {
    // 1. 获取已有会话（保持对话连续性）
    const sdkSessionId = this.sessions.get(request.conversationId);

    // 2. 构建 LLM 参数
    const params = {
      prompt: request.text,
      sessionId: request.conversationId,
      sdkSessionId,  // 恢复会话
      permissionMode: config.defaultMode === 'plan' ? 'plan' : 'default',
      files: await convertMedia(request.media),  // 图片支持
    };

    // 3. 消费 SSE 流（由 LLM Provider 返回）
    const result = await this.consumeStream(params);

    // 4. 保存会话 ID
    if (result.sessionId) {
      this.sessions.set(request.conversationId, result.sessionId);
    }

    return { text: result.text };
  }

  private async consumeStream(params): Promise<StreamResult> {
    const stream = this.llm.streamChat(params);
    const reader = stream.getReader();

    // 解析 SSE 事件
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // text, status, result, error, permission_request
      // 根据 event.type 处理不同事件
    }

    return { text, sessionId, isError };
  }
}
```

### 运行时选择逻辑 (`wechat-main.ts`)

```typescript
const config = loadConfig();

if (config.runtime === 'codex') {
  const { CodexProvider } = await import('./codex-provider.js');
  const llm = new CodexProvider(pendingPerms);
  const agent = new WeChatAgent(llm, config, pendingPerms);
  await runAgent(agent, devMode);
  return;
}

// 默认使用 Claude
const llm = new SDKLLMProvider(pendingPerms, cliPath, config.autoApprove);
const agent = new WeChatAgent(llm, config, pendingPerms);
await runAgent(agent, devMode);
```

## 配置选项

```bash
# ~/.claude-to-im/config.env
CTI_RUNTIME=claude                    # 运行时: claude | codex | auto
CTI_DEFAULT_WORKDIR=/path/to/project  # 默认工作目录
CTI_WEIXIN_AUTO_APPROVE=true          # 自动批准工具调用（微信无交互按钮）

# Claude 配置
CTI_CLAUDE_CODE_EXECUTABLE=/path/to/claude  # Claude CLI 路径

# Codex 配置（API Key 优先级: CTI_CODEX_API_KEY > CODEX_API_KEY > OPENAI_API_KEY）
CTI_CODEX_API_KEY=sk-...              # 可选
CODEX_API_KEY=sk-...                  # 可选
OPENAI_API_KEY=sk-...                 # 可选（也用于 Codex）
CTI_CODEX_BASE_URL=https://api.openai.com  # 可选，自定义端点
```

### 运行时模式

| 模式 | 说明 |
|------|------|
| `claude` | 仅使用 Claude Code（默认） |
| `codex` | 仅使用 OpenAI Codex |
| `auto` | 先尝试 Claude，失败则回退到 Codex |

## 使用方式

```bash
# 首次登录（扫码）
npm run wechat:login

# 启动桥接服务
npm run wechat:start

# 开发模式（前台运行）
npm run wechat:dev
```

## 限制与注意事项

1. **无交互式权限** - 微信没有按钮，必须设置 `CTI_WEIXIN_AUTO_APPROVE=true`
2. **响应延迟** - 首次消息约1分钟（会话初始化），后续约10-20秒
3. **Node.js 版本** - 需要 >= 22（weixin-agent-sdk 要求）
4. **仅文本响应** - 当前只返回文本，工具调用结果已整合

## 文件结构

```
src/
├── wechat-main.ts       # 入口：login/start/dev 命令
├── wechat-agent.ts      # Agent 适配器：SSE → 同步响应
├── llm-provider.ts      # Claude LLM 提供者
├── codex-provider.ts    # Codex LLM 提供者
├── config.ts            # 配置加载（含微信配置项）
├── permission-gateway.ts # 权限管理
└── main.ts              # 主入口（飞书等平台）
```

## 依赖关系

```json
{
  "dependencies": {
    "weixin-agent-sdk": "file:../weixin-agent-sdk/packages/sdk",
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "@openai/codex-sdk": "^0.110.0"
  }
}
```

## 工作流程

1. 用户在微信发送消息
2. weixin-agent-sdk 通过 OpenClaw 接收消息
3. WeChatAgent.chat() 被调用
4. 根据 CTI_RUNTIME 选择 LLM Provider
5. 调用 LLM.streamChat() 获取 SSE 流
6. 消费流，累积文本响应
7. 返回 ChatResponse 给 weixin-agent-sdk
8. 微信用户收到回复

---
*创建日期: 2026-03-23*
*更新日期: 2026-03-24*
*项目: claude-to-im-skill*
