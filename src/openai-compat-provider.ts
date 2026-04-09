/**
 * OpenAI-Compatible Provider — calls any /v1/chat/completions API.
 *
 * No local CLI process needed; auto-approves all tool usage since plain
 * chat completions have no tool-call permission model.
 *
 * Config: CTI_OPENAI_COMPAT_BASE_URL, _API_KEY, _MODEL, _TIMEOUT
 */

import type { LLMProvider, StreamChatParams, FileAttachment } from 'claude-to-im/src/lib/bridge/host.js';
import type { PendingPermissions } from './permission-gateway.js';
import { sseEvent } from './sse-utils.js';

// ── Types ────────────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | OpenAIContentPart[];
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

interface StreamDelta {
  choices?: Array<{
    delta?: { content?: string; role?: string };
    finish_reason?: string | null;
    index?: number;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  id?: string;
  model?: string;
}

// ── Image helpers ────────────────────────────────────────────

const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
]);

function normalizeImageMime(type: string): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' {
  if (type === 'image/jpg') return 'image/jpeg';
  return type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

function buildImageParts(files: FileAttachment[]): OpenAIContentPart[] {
  return files
    .filter(f => SUPPORTED_IMAGE_TYPES.has(f.type))
    .map(f => ({
      type: 'image_url' as const,
      image_url: {
        url: `data:${normalizeImageMime(f.type)};base64,${f.data}`,
        detail: 'auto' as const,
      },
    }));
}

// ── SSE line parser ──────────────────────────────────────────

/**
 * Parse a chunk of SSE text into individual data lines.
 * Handles partial lines across chunk boundaries.
 */
function parseSSELines(
  buffer: { value: string },
  chunk: string,
): string[] {
  buffer.value += chunk;
  const lines: string[] = [];
  let pos = 0;
  let idx: number;

  while ((idx = buffer.value.indexOf('\n', pos)) !== -1) {
    const line = buffer.value.slice(pos, idx).replace(/\r$/, '');
    if (line.startsWith('data: ')) {
      lines.push(line.slice(6));
    }
    pos = idx + 1;
  }

  buffer.value = buffer.value.slice(pos);
  return lines;
}

// ── Provider ─────────────────────────────────────────────────

export class OpenAICompatProvider implements LLMProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private timeoutMs: number;

  /**
   * Conversation history keyed by sessionId.
   * Each entry is an array of {role, content} messages sent to the API.
   */
  private sessions = new Map<string, ChatMessage[]>();

  constructor(
    _pendingPerms: PendingPermissions,
    opts?: { baseUrl?: string; apiKey?: string; model?: string; timeoutMs?: number },
  ) {
    // _pendingPerms accepted for interface consistency but not used —
    // plain chat completions have no tool-call permission model.
    this.baseUrl = (
      opts?.baseUrl
      || process.env.CTI_OPENAI_COMPAT_BASE_URL
      || 'http://localhost:8000/v1'
    ).replace(/\/+$/, '');
    this.apiKey = opts?.apiKey || process.env.CTI_OPENAI_COMPAT_API_KEY || '';
    this.model = opts?.model || process.env.CTI_OPENAI_COMPAT_MODEL || 'gpt-3.5-turbo';
    this.timeoutMs = opts?.timeoutMs || parseInt(process.env.CTI_OPENAI_COMPAT_TIMEOUT || '120000', 10);
  }

  streamChat(params: StreamChatParams): ReadableStream<string> {
    const {
      baseUrl, apiKey, model, timeoutMs, sessions,
    } = this;

    return new ReadableStream<string>({
      start(controller) {
        (async () => {
          try {
            // ── Build messages array ──
            const messages: ChatMessage[] = [];

            if (params.systemPrompt) {
              messages.push({ role: 'system', content: params.systemPrompt });
            }

            if (params.sdkSessionId) {
              const history = sessions.get(params.sdkSessionId);
              if (history) {
                messages.push(...history);
              }
            }

            // Bridge conversation history (inserted before current message)
            if (params.conversationHistory?.length) {
              messages.push(...params.conversationHistory.map(m => ({
                role: m.role,
                content: m.content,
              })));
            }

            // Current user message (with optional images)
            const imageParts = buildImageParts(params.files ?? []);
            if (imageParts.length > 0) {
              messages.push({
                role: 'user',
                content: [
                  { type: 'text', text: params.prompt },
                  ...imageParts,
                ],
              });
            } else {
              messages.push({ role: 'user', content: params.prompt });
            }

            const url = `${baseUrl}/chat/completions`;
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            if (apiKey) {
              headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const body = JSON.stringify({
              model: params.model || model,
              messages,
              stream: true,
            });

            // ── Fetch with timeout ──
            const response = await fetch(url, {
              method: 'POST',
              headers,
              body,
              signal: params.abortController?.signal
                ? AbortSignal.any([
                    params.abortController.signal,
                    AbortSignal.timeout(timeoutMs),
                  ])
                : AbortSignal.timeout(timeoutMs),
            });

            if (!response.ok) {
              let errorBody = '';
              try {
                errorBody = await response.text();
              } catch {
                // ignore
              }
              const errorMsg = errorBody || response.statusText || `HTTP ${response.status}`;
              throw new Error(`OpenAI-compat API error: ${response.status} - ${errorMsg}`);
            }

            if (!response.body) {
              throw new Error('OpenAI-compat API returned no response body');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const sseBuffer = { value: '' };
            const textChunks: string[] = [];
            let usageData: StreamDelta['usage'] | undefined;
            let responseId: string | undefined;
            let responseModel: string | undefined;

            try {
              while (true) {
                if (params.abortController?.signal.aborted) {
                  break;
                }

                const { done, value: chunk } = await reader.read();
                if (done) break;

                const text = decoder.decode(chunk, { stream: true });
                const dataLines = parseSSELines(sseBuffer, text);

                for (const line of dataLines) {
                  if (line === '[DONE]') continue;

                  let delta: StreamDelta;
                  try {
                    delta = JSON.parse(line);
                  } catch {
                    // Skip malformed JSON lines
                    console.warn('[openai-compat-provider] Skipping malformed SSE data:', line.slice(0, 200));
                    continue;
                  }

                  // Capture metadata
                  if (delta.id) responseId = delta.id;
                  if (delta.model) responseModel = delta.model;
                  if (delta.usage) usageData = delta.usage;

                  // Emit text deltas
                  const choice = delta.choices?.[0];
                  if (choice?.delta?.content) {
                    textChunks.push(choice.delta.content);
                    controller.enqueue(sseEvent('text', choice.delta.content));
                  }
                }
              }
            } finally {
              reader.releaseLock();
            }

            const sessionId = params.sdkSessionId || params.sessionId;
            const fullText = textChunks.join('');
            if (fullText && sessionId) {
              const existingHistory = sessions.get(sessionId) ?? [];
              sessions.set(sessionId, [
                ...existingHistory,
                { role: 'user' as const, content: params.prompt },
                { role: 'assistant' as const, content: fullText },
              ]);
            }
            controller.enqueue(sseEvent('result', {
              session_id: responseId || sessionId,
              usage: usageData ? {
                input_tokens: usageData.prompt_tokens ?? 0,
                output_tokens: usageData.completion_tokens ?? 0,
              } : {
                input_tokens: 0,
                output_tokens: 0,
              },
              model: responseModel || params.model || model,
            }));

            controller.close();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[openai-compat-provider] Error:', err instanceof Error ? err.stack || err.message : err);

            // Distinguish abort from real errors
            if (params.abortController?.signal.aborted) {
              controller.enqueue(sseEvent('result', {
                session_id: params.sdkSessionId || params.sessionId,
                usage: { input_tokens: 0, output_tokens: 0 },
              }));
              controller.close();
              return;
            }

            try {
              controller.enqueue(sseEvent('error', message));
              controller.close();
            } catch {
              // Controller already closed
            }
          }
        })();
      },
    });
  }
}
