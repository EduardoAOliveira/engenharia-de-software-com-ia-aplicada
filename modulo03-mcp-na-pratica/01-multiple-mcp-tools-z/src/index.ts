import { createServer } from './server.ts';
import { readFileSync } from 'fs';

const app = await createServer();
const host = process.env.HOST ?? '0.0.0.0';
const requestedPort = Number.parseInt(process.env.PORT ?? '3000', 10);

let serverUrl: string;

try {
  serverUrl = await app.listen({ port: requestedPort, host });
} catch (error) {
  const isPortBusy = typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'EADDRINUSE';

  if (!isPortBusy) {
    throw error;
  }

  console.warn(`Port ${requestedPort} is already in use. Falling back to a random free port.`);
  serverUrl = await app.listen({ port: 0, host });
}

console.log(`Server is running on ${serverUrl}`);

// const salesData = readFileSync('./data/sales.csv', 'utf-8');
const salesData = readFileSync('./data/sales-complete.csv', 'utf-8');

// const question = `
// Rank the top 5 most sold products:

// ${salesData}
// `
const question =`
Here is a CSV file called sales.csv.
What's the total revenue from this sales data?.

${salesData}
`

app.inject({
  method: 'POST',
  url: '/chat',
  payload: {
    question,
  },
}).then(async response => {
  console.log('Response from /chat:', response.statusCode)
  console.log(response.body);
  // Encerra o Fastify (dispara o hook onClose → llm.close() → fecha os MCPs)
  // antes de matar o processo. Sem isso, os servidores MCP filhos morrem por
  // pipe quebrado (EPIPE) ao sair.
  await app.close();
  process.exit(0);
}).catch(async error => {
  console.error('Error testing /chat endpoint:', error);
  await app.close();
  process.exit(1);
});
