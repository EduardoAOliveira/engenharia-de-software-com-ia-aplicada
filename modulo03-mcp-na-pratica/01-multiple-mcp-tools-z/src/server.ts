import { HumanMessage } from '@langchain/core/messages';
import { buildGraph } from './graph/factory.ts';

import Fastify from 'fastify';

export const createServer = async () => {
    const { graph, llm } = await buildGraph();
    const app = Fastify();

    // Fecha os transportes MCP quando o servidor encerra (app.close()), garantindo
    // shutdown limpo dos servidores MCP filhos e evitando o EPIPE de pipe quebrado.
    app.addHook('onClose', async () => {
        await llm.close();
    });

    app.post('/chat', {
        schema: {
            body: {
                type: 'object',
                required: ['question'],
                properties: {
                    question: { type: 'string', minLength: 10 },
                },
            }
        }
    }, async function (request, reply) {
        try {
            const { question } = request.body as {
                question: string;
            };

            const response = await graph.invoke({
                messages: [new HumanMessage(question)],
            });

            return reply.send(response.answer ?? response.messages.at(-1)?.text ?? 'No response generated.');

        } catch (error) {
            console.error('❌ Error processing request:', error);
            return reply.status(500).send({
                error: 'An error occurred while processing your request.',
            });
        }
    });

    return app;
};
