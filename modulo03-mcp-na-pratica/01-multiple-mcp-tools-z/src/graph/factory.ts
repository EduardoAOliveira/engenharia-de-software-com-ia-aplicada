import { buildGraphPipeline } from './graph.ts';
import { OpenRouterService } from '../services/openRouterService.ts';

export async function buildGraph() {
  const llm = new OpenRouterService();
  const graph = buildGraphPipeline(llm);
  // Retornamos o `llm` junto para que o dono do processo possa fechar os
  // recursos MCP (llm.close()) no shutdown.
  return { graph, llm };
}

// langgraph.json aponta para este export e espera o grafo compilado.
export const graph = async () => (await buildGraph()).graph;

export default graph;
