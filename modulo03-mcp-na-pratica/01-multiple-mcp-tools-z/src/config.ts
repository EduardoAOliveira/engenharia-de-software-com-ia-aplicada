export type ModelConfig = {
  apiKey: string;
  httpReferer: string;
  xTitle: string;

  provider: {
    sort: {
      by: string;
      partition: string;
    };
  };

  models: string[];
  temperature: number;
  maxTokens: number;

  // Fallback local (LLM rodando via MLX no mac). Usado quando o OpenRouter
  // falha (ex: 429 dos modelos :free). Exposto pelo mlx_lm.server, que é
  // compatível com a API da OpenAI e estrutura tool_calls / structured output.
  fallback?: {
    baseURL: string;
    apiKey: string;
    model: string;
  };
};

console.assert(process.env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY is not set in environment variables');

export const config: ModelConfig = {
  apiKey: process.env.OPENROUTER_API_KEY!,
  httpReferer: '',
  xTitle: 'IA Devs - Transforming Services into Tools',
  models: [
    // Modelos :free do Google Gemma. Ambos suportam tools + response_format
    // (requisito das MCP tools + structured output desta app). Como `models` é um
    // array, o OpenRouter tenta o seguinte se o primeiro ficar indisponível.
    // Obs: modelos :free sofrem 429 (rate-limit upstream) intermitente — quando os
    // dois caem, o fallback MLX local (config.fallback) assume. Sem crédito na conta,
    // modelos pagos retornam 402.
    'google/gemma-4-31b-it:free',
    'google/gemma-4-26b-a4b-it:free',
  ],
  provider: {
    sort: {
      by: 'throughput', // Route to model with highest throughput (fastest response)
      partition: 'none',
    },
  },
  temperature: 0.7,
  // Teto de geração. O intent node ecoa o fileContent (CSV/JSON inteiro) de volta
  // no structured output, então precisa caber o arquivo + campos. 2048 truncava
  // (finish_reason: length) no modelo local. É só um teto — não força gerar mais.
  maxTokens: 8192,

  // mlx_lm.server local com Qwen2.5-7B-Instruct-4bit (emite <tool_call>, que o
  // mlx_lm parseia para o formato OpenAI). Subir com:
  //   mlx_lm server --model mlx-community/Qwen2.5-7B-Instruct-4bit --port 8090
  fallback: {
    baseURL: process.env.MLX_BASE_URL ?? 'http://127.0.0.1:8090/v1',
    apiKey: process.env.MLX_API_KEY ?? 'mlx-local',
    // Precisa bater com o --model do servidor; um id diferente faz o mlx_lm
    // tentar BAIXAR outro repo do HuggingFace (erro "Repository Not Found").
    model: process.env.MLX_MODEL ?? 'mlx-community/Qwen2.5-7B-Instruct-4bit',
  },
};
