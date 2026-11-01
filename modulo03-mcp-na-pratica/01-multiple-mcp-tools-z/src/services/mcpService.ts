import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { getMongoDBTool } from "../tools/mongodbTool.ts";
import { getCSVTOJSONTool } from "../tools/csvToJSONTool.ts";
import { getFSTool } from "../tools/fsTool.ts";

export const getMCPTools = async () => {
  const client = new MultiServerMCPClient({
    mcpServers: {
      ...getMongoDBTool(),
      ...getFSTool(),
    },
    onMessage: (log, source) => {
      console.log(`[${source.server}] ${log.data}`)
    }
  })

  const mcpTools = await client.getTools()

  // Devolvemos também o `client` para que o dono do ciclo de vida possa chamar
  // `client.close()` no shutdown. Sem isso, ao encerrar o processo (process.exit),
  // os servidores MCP filhos (stdio, via npx) morrem por pipe quebrado → EPIPE.
  return {
    client,
    tools: [
      ...mcpTools,
      getCSVTOJSONTool()
    ],
  };
};
