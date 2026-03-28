import { resolveTools } from "../tools/index.js";
import type { ToolDefinition } from "../tools/types.js";
import type { Provider, ProviderRunOptions } from "./types.js";

export type ProviderType = "openai" | "openrouter" | "mistral";

const BASE_URLS: Record<ProviderType, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  mistral: "https://api.mistral.ai/v1",
};

const DEFAULT_MODELS: Record<ProviderType, string> = {
  openai: "gpt-4.1",
  openrouter: "anthropic/claude-sonnet-4",
  mistral: "mistral-large-latest",
};

const MAX_ITERATIONS = 50;
const MAX_RETRIES = 3;

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      role: "assistant";
      content?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
}

export class OpenAICompatProvider implements Provider {
  private providerType: ProviderType;
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(opts: {
    providerType: ProviderType;
    apiKey: string;
    model?: string;
    baseUrl?: string;
  }) {
    this.providerType = opts.providerType;
    this.apiKey = opts.apiKey;
    this.model = opts.model || DEFAULT_MODELS[opts.providerType];
    this.baseUrl = opts.baseUrl || BASE_URLS[opts.providerType];
  }

  async run(options: ProviderRunOptions): Promise<{ output: string }> {
    const tools = resolveTools(options.allowedTools, options.dispatchBaseUrl);
    const toolMap = new Map(tools.map(t => [t.definition.name, t]));
    const toolDefs = tools.map(t => toOpenAITool(t.definition));

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: "You are a helpful coding agent. You have access to tools for reading, writing, and searching files, running shell commands, and interacting with the task board. Use tools to complete tasks. Work in the provided working directory.",
      },
      { role: "user", content: options.prompt },
    ];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.chatCompletion(messages, toolDefs);
      const choice = response.choices[0];

      if (!choice) {
        return { output: "Error: Empty response from API" };
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: choice.message.content,
      };
      if (choice.message.tool_calls?.length) {
        assistantMsg.tool_calls = choice.message.tool_calls;
      }
      messages.push(assistantMsg);

      // If no tool calls, we're done
      if (!choice.message.tool_calls?.length || choice.finish_reason === "stop") {
        return { output: choice.message.content || "(no output)" };
      }

      // Execute tool calls
      for (const toolCall of choice.message.tool_calls) {
        const tool = toolMap.get(toolCall.function.name);
        let result: string;

        if (!tool) {
          result = `Error: Unknown tool "${toolCall.function.name}"`;
        } else {
          try {
            const params = JSON.parse(toolCall.function.arguments);
            const toolResult = await tool.execute(params, options.workDir);
            result = toolResult.output;
          } catch (err) {
            result = `Error executing tool: ${(err as Error).message}`;
          }
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }

    return { output: "Warning: reached maximum iteration limit (50). Last output may be incomplete." };
  }

  private async chatCompletion(
    messages: ChatMessage[],
    tools: ReturnType<typeof toOpenAITool>[],
  ): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
    };

    // OpenRouter requires extra headers
    if (this.providerType === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/nauski/dispatch";
      headers["X-Title"] = "Dispatch Daemon";
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (res.status === 429 && attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Rate limited (429), retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API request failed: ${res.status} ${text}`);
      }

      return await res.json() as ChatCompletionResponse;
    }

    throw new Error("Max retries exceeded for rate limit");
  }
}

function toOpenAITool(def: ToolDefinition) {
  return {
    type: "function" as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
