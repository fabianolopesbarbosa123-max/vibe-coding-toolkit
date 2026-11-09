import type { Agent, Project, Task } from "@/lib/domain";

const SHARED_RULES = `You work inside "AI Virtual Office", a team of AI agents.
- Reply in the same language as the owner's request.
- Produce the deliverable itself, structured with short headings and lists.
- You cannot browse the web, run code, or access files in this version. Never claim you did; state assumptions instead.
- Be concrete and concise. Do not invent metrics, sources, or results.`;

export function agentSystemPrompt(agent: Agent): string {
  return `${SHARED_RULES}\n\nYour name is ${agent.name}; your role is ${agent.title}.\n${agent.instructions}`;
}

export function planPrompt(request: string, team: Agent[]): string {
  const roster = team.map(agent => `- id "${agent.id}": ${agent.name}, ${agent.title} — ${agent.instructions}`).join("\n");
  return `The owner asked:\n<request>\n${request}\n</request>\n\nTeam available (excluding you):\n${roster}\n\nSplit the request into 2-6 ordered tasks. Each task goes to exactly one team member by id, and later tasks may build on earlier results. Give each task a short title, a self-contained description of the expected deliverable, and a priority. Also give the project a short name and a one-paragraph summary of the plan.`;
}

export function taskPrompt(task: Task, project: Project | null, previous: { task: Task; agent: Agent | undefined }[]): string {
  const parts: string[] = [];
  if (project) parts.push(`Project "${project.name}". Owner's request:\n<request>\n${project.request}\n</request>`);
  if (previous.length) {
    const shared = previous
      .map(({ task: done, agent }) => `### ${done.title} (by ${agent?.name ?? "unknown"}, ${agent?.title ?? ""})\n${done.result}`)
      .join("\n\n");
    parts.push(`Results already shared by teammates:\n<shared_results>\n${shared}\n</shared_results>`);
  }
  parts.push(`Your task: ${task.title}\n${task.description}`);
  return parts.join("\n\n");
}

export function summaryPrompt(project: Project, results: { task: Task; agent: Agent | undefined }[]): string {
  const body = results
    .map(({ task, agent }) => `### ${task.title} — ${agent?.name ?? "unknown"} (${task.status})\n${task.result ?? task.error ?? ""}`)
    .join("\n\n");
  return `Present the final result of project "${project.name}" to the owner.\n<request>\n${project.request}\n</request>\n\nTeam results:\n<results>\n${body}\n</results>\n\nWrite an executive summary: what was delivered, key decisions, open risks, and recommended next steps.`;
}
