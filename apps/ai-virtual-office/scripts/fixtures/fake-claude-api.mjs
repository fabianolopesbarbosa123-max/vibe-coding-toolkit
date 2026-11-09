/**
 * TEST FIXTURE ONLY. A local stand-in for the Claude Messages API so automated tests can
 * exercise planning, execution, usage accounting, and budgets without a real key.
 * Start: node scripts/fixtures/fake-claude-api.mjs   (listens on 127.0.0.1:4010)
 * App:   ANTHROPIC_BASE_URL=http://127.0.0.1:4010 ANTHROPIC_API_KEY=test-only
 * Responses are labelled as fixture output and must never be shown as real results.
 */
import http from "node:http";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|agent-[a-z]+/g;
const DELAY_MS = Number(process.env.FIXTURE_DELAY_MS ?? 1500);

http
  .createServer((request, response) => {
    let body = "";
    request.on("data", chunk => (body += chunk));
    request.on("end", async () => {
      const data = JSON.parse(body || "{}");
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      let text;
      if (data.output_config?.format) {
        const ids = [...new Set(JSON.stringify(data.output_config.format).match(UUID))].slice(0, 4);
        text = JSON.stringify({
          projectName: "Projeto de teste (fixture)",
          summary: "Plano gerado pela fixture de testes.",
          tasks: ids.map((id, index) => ({ title: `Etapa ${index + 1}`, description: `Entrega ${index + 1}`, assigneeId: id, priority: "high" })),
        });
      } else {
        text = "[fixture de testes] resposta simulada; não é saída de um modelo real.";
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "msg_fixture",
          type: "message",
          role: "assistant",
          model: data.model,
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1200, output_tokens: 300 },
        }),
      );
    });
  })
  .listen(4010, "127.0.0.1");
