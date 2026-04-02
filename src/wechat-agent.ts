/**
 * WeChat Agent — bridges weixin-agent-sdk's Agent interface to LLMProvider.
 *
 * Converts synchronous chat() calls to streamChat() SSE consumption.
 */

import fs from 'node:fs/promises';
import type { Agent, ChatRequest, ChatResponse } from 'weixin-agent-sdk';
import type { LLMProvider, FileAttachment } from 'claude-to-im/src/lib/bridge/host.js';
import type { Config } from './config.js';
import type { PendingPermissions } from './permission-gateway.js';

/** Parameters for streamChat - subset of full StreamChatParams */
interface WeChatStreamParams {
  prompt: string;
  sessionId: string;
  workingDirectory?: string;
  model?: string;
  sdkSessionId?: string;
  permissionMode?: string;
  abortController?: AbortController;
  files?: FileAttachment[];
}

/** SSE event format: data: {"type":"...","data":"..."} */
interface SSEEvent {
  type: string;
  data: string;
}

/** Parse a single SSE event line. */
function parseSSELine(line: string): SSEEvent | null {
  if (!line.startsWith('data: ')) return null;
  try {
    const json = JSON.parse(line.slice(6));
    if (typeof json.type === 'string' && json.data !== undefined) {
      return { type: json.type, data: json.data };
    }
  } catch {
    // Invalid JSON, skip
  }
  return null;
}

/** Convert WeChat media attachment to FileAttachment for LLMProvider. */
async function convertMedia(
  media: ChatRequest['media']
): Promise<FileAttachment[] | undefined> {
  if (!media) return undefined;

  // Only process images for now
  if (media.type !== 'image') {
    console.log(`[wechat-agent] Skipping non-image media: ${media.type}`);
    return undefined;
  }

  try {
    const data = await fs.readFile(media.filePath);
    const base64Data = data.toString('base64');
    return [
      {
        id: `wechat-img-${Date.now()}`,
        name: media.fileName || 'image',
        type: media.mimeType || 'image/jpeg',
        size: data.length,
        data: base64Data,
        filePath: media.filePath,
      },
    ];
  } catch (err) {
    console.error(`[wechat-agent] Failed to read media file: ${media.filePath}`, err);
    return undefined;
  }
}

/** Result collected from SSE stream. */
interface StreamResult {
  text: string;
  sessionId?: string;
  isError: boolean;
  errorMessage?: string;
}

/**
 * WeChat Agent implementation.
 *
 * Bridges weixin-agent-sdk's synchronous Agent interface to the
 * streaming LLMProvider used by claude-to-im.
 */
export class WeChatAgent implements Agent {
  private sessions = new Map<string, string>();

  constructor(
    private llm: LLMProvider,
    private config: Config,
    private pendingPerms: PendingPermissions
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    console.log(`[wechat-agent] chat() called: conversation=${request.conversationId.slice(0, 8)}...`);

    // Convert media attachments
    const files = await convertMedia(request.media);

    // Get existing session for conversation continuity
    const sdkSessionId = this.sessions.get(request.conversationId);

    // Build stream params
    // Map defaultMode to valid permissionMode values
    // 'code' -> 'default', 'plan' -> 'plan', 'ask' -> 'default'
    const permissionMode = this.config.defaultMode === 'plan' ? 'plan' : 'default';

    const params: WeChatStreamParams = {
      prompt: request.text,
      sessionId: request.conversationId,
      workingDirectory: this.config.defaultWorkDir,
      model: this.config.defaultModel,
      sdkSessionId,
      permissionMode,
      abortController: new AbortController(),
      files,
    };

    // Consume the SSE stream
    const result = await this.consumeStream(params);

    // Update session ID for next turn
    if (result.sessionId) {
      this.sessions.set(request.conversationId, result.sessionId);
    }

    if (result.isError) {
      const errorResponse = { text: `❌ Error: ${result.errorMessage || 'Unknown error'}` };
      console.log(`[wechat-agent] Returning error response: ${errorResponse.text.slice(0, 100)}`);
      return errorResponse;
    }

    console.log(`[wechat-agent] Returning response: ${result.text.slice(0, 100)}...`);
    return { text: result.text };
  }

  /** Consume the SSE stream and collect the result. */
  private async consumeStream(params: WeChatStreamParams): Promise<StreamResult> {
    console.log('[wechat-agent] consumeStream() called with:', JSON.stringify({
      prompt: params.prompt?.slice(0, 50),
      sessionId: params.sessionId?.slice(0, 8),
      permissionMode: params.permissionMode,
      workingDirectory: params.workingDirectory,
      model: params.model,
    }));
    const result: StreamResult = { text: '', isError: false };

    let stream: ReadableStream<string>;
    try {
      stream = this.llm.streamChat(params as Parameters<LLMProvider['streamChat']>[0]);
      console.log('[wechat-agent] streamChat() returned successfully');
    } catch (err) {
      console.error('[wechat-agent] streamChat() threw error:', err);
      result.isError = true;
      result.errorMessage = err instanceof Error ? err.message : String(err);
      return result;
    }

    const reader = stream.getReader();
    console.log('[wechat-agent] Stream reader obtained, starting to read...');

    try {
      let chunkCount = 0;
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`[wechat-agent] Stream ended after ${chunkCount} chunks, ${totalBytes} bytes`);
          break;
        }
        chunkCount++;
        if (value) totalBytes += value.length;

        // Parse SSE events from the chunk
        const lines = value.split('\n');
        for (const line of lines) {
          const event = parseSSELine(line);
          if (!event) continue;

          switch (event.type) {
            case 'text':
              result.text += event.data;
              break;

            case 'status': {
              const data = JSON.parse(event.data);
              if (data.session_id) {
                result.sessionId = data.session_id;
              }
              break;
            }

            case 'result': {
              const data = JSON.parse(event.data);
              if (data.session_id) {
                result.sessionId = data.session_id;
              }
              if (data.is_error) {
                result.isError = true;
              }
              break;
            }

            case 'error':
              result.isError = true;
              result.errorMessage = event.data;
              break;

            case 'permission_request': {
              // Auto-approve if configured, otherwise deny with message
              const data = JSON.parse(event.data);
              if (this.config.weixinAutoApprove || this.config.autoApprove) {
                this.pendingPerms.resolve(data.permissionRequestId, {
                  behavior: 'allow',
                });
              } else {
                // WeChat doesn't support interactive permission prompts
                // Deny and inform user to use auto-approve mode
                this.pendingPerms.resolve(data.permissionRequestId, {
                  behavior: 'deny',
                  message: 'WeChat requires CTI_WEIXIN_AUTO_APPROVE=true for tool usage',
                });
                result.isError = true;
                result.errorMessage = `Tool "${data.toolName}" requires permission. Set CTI_WEIXIN_AUTO_APPROVE=true to auto-approve.`;
              }
              break;
            }

            // Ignore other event types (tool_use, tool_result, etc.)
          }
        }
      }
    } catch (err) {
      console.error('[wechat-agent] Stream error:', err);
      result.isError = true;
      result.errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      reader.releaseLock();
    }

    console.log(`[wechat-agent] Stream complete. text length=${result.text.length}, isError=${result.isError}, sessionId=${result.sessionId?.slice(0, 8)}`);
    return result;
  }

  /** Clear all sessions (useful for testing). */
  clearSessions(): void {
    this.sessions.clear();
  }
}
