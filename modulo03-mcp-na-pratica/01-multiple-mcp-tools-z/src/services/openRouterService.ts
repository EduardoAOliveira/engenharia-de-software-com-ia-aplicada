import { ChatOpenAI } from '@langchain/openai';
import { config, type ModelConfig } from '../config.ts';
import { SystemMessage, HumanMessage, BaseMessage, AIMessage } from '@langchain/core/messages';
import { createAgent, providerStrategy, toolStrategy } from 'langchain';
import { getMCPTools } from './mcpService.ts';
import { type MultiServerMCPClient } from '@langchain/mcp-adapters';
import { z } from 'zod/v3';
import { type ChatGeneration } from '@langchain/core/outputs';

export class OpenRouterService {
    private config: ModelConfig;
    private llmClient: ChatOpenAI;
    private fallbackClient?: ChatOpenAI;
    private tools: any[];
    private mcpClient?: MultiServerMCPClient;

    constructor(configOverride?: ModelConfig) {
        this.config = configOverride ?? config;
        this.llmClient = this.#createChatModel(this.config.models[0]);
        if (this.config.fallback) {
            this.fallbackClient = this.#createLocalModel(this.config.fallback);
        }
        this.tools = [];
    }

    #createChatModel(modelName: string): ChatOpenAI {
        return new ChatOpenAI({
            apiKey: this.config.apiKey,
            modelName: modelName,
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
            configuration: {
                baseURL: 'https://openrouter.ai/api/v1',
                defaultHeaders: {
                    'HTTP-Referer': this.config.httpReferer,
                    'X-Title': this.config.xTitle,
                },
            },
            modelKwargs: {
                models: this.config.models,
                provider: this.config.provider,
            },
        });
    }

    // Client apontando para o LLM local (mlx_lm.server, API compatível com OpenAI).
    #createLocalModel(fb: NonNullable<ModelConfig['fallback']>): ChatOpenAI {
        return new ChatOpenAI({
            apiKey: fb.apiKey,
            modelName: fb.model,
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
            configuration: {
                baseURL: fb.baseURL,
            },
        });
    }

    async #getTools() {
        if (!this.tools.length) {
            const { client, tools } = await getMCPTools();
            this.mcpClient = client;
            this.tools = tools;
        }
        return this.tools;
    }

    // Shutdown gracioso: fecha os transportes MCP (encerra os servidores filhos
    // stdio de forma limpa) antes do processo sair. Evita o EPIPE de pipe quebrado.
    async close(): Promise<void> {
        await this.mcpClient?.close();
        this.mcpClient = undefined;
    }

    async generateStructured<T>(
        systemPrompt: string,
        userPrompt: string,
        schema?: z.ZodSchema<T>,
    ): Promise<{ data?: T | string; }> {
        // Tools são resolvidas uma vez e reusadas nas duas tentativas (remoto/local).
        const tools = schema ? [] : await this.#getTools();

        const messages = [
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt),
        ];

        try {
            return await this.#invoke<T>(this.llmClient, tools, messages, schema, false);
        } catch (error) {
            if (!this.fallbackClient) throw error;
            const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            console.warn(`⚠️  OpenRouter falhou (${reason}). Recorrendo ao LLM local (MLX)...`);
            return await this.#invoke<T>(this.fallbackClient, tools, messages, schema, true);
        }
    }

    async #invoke<T>(
        client: ChatOpenAI,
        tools: any[],
        messages: BaseMessage[],
        schema?: z.ZodSchema<T>,
        isLocal = false,
    ): Promise<{ data?: T | string; }> {
        // Structured output: o mlx_lm local não faz constrained JSON (embrulha em
        // markdown), então usamos toolStrategy (via tool calling, que ele estrutura
        // bem). No OpenRouter mantemos providerStrategy (response_format nativo).
        const agentConfig = schema
            ? { responseFormat: isLocal ? toolStrategy(schema) : providerStrategy(schema), tools: [] }
            : { tools };

        const agent = createAgent({
            ...agentConfig,
            model: client,
        });

        const data = await agent.invoke(
            {
                messages
            },
            {
                callbacks: [{
                    handleChatModelStart(_llm, promptMessages) {
                        const lastMsg = promptMessages.at(-1)?.at(-1);
                        console.log(`\n🧠 LLM thinking...`);
                        console.log(` (last message: "${lastMsg?.content?.toString()}")`);
                    },
                    handleLLMEnd(output) {
                        const msg = (output.generations?.at(0)?.at(0) as ChatGeneration)?.message as AIMessage;
                        const toolCalls = msg?.tool_calls;
                        if (toolCalls?.length) {
                            console.log(`🎯 Decided to call: ${toolCalls.map((t) => t.name).join(', ')}`);
                        }
                    },
                    handleToolStart(_tool, input, _runId, _parentRunId, _tags, _metadata, runName) {
                        console.log(`🔧 Tool called: ${runName} →`, input);
                    },
                    handleToolEnd(output, _runId, _parentRunId, runName) {
                        console.log(`✅ Tool done:   ${runName} →`, output);
                    },
                }]
            });
        console.log('✅ LLM Response:', JSON.stringify(data, null, 2));

        return {
            data: (schema ?
                ((data as any).structuredResponse as T) :
                data.messages.at(-1)?.text as string ?? ""
            ),
        };
    }
}
