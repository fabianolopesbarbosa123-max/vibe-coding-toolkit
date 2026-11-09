import type { AgentRole, AgentStatus, Priority, ProjectStatus, Provider, RoomId, TaskStatus } from "./domain";

export const ROOM_LABELS: Record<RoomId, string> = {
  planning: "Planejamento",
  programming: "Programação & Design",
  research: "Pesquisa",
  marketing: "Marketing",
  meeting: "Sala de reuniões",
  support: "Atendimento",
  monitoring: "Monitoramento",
};

export const ROLE_LABELS: Record<AgentRole, string> = {
  ceo: "CEO",
  programmer: "Programador",
  designer: "Designer",
  marketing: "Marketing",
  researcher: "Pesquisador",
  analyst: "Analista",
  support: "Atendimento",
  custom: "Personalizado",
};

export const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: "Disponível",
  working: "Trabalhando",
  meeting: "Em reunião",
  done: "Concluído",
  error: "Erro",
};

/** What a working agent looks like it is doing, by role. */
export const ACTIVITY_LABELS: Record<AgentRole, string> = {
  ceo: "Coordenando",
  programmer: "Programando",
  designer: "Desenhando interface",
  marketing: "Criando campanha",
  researcher: "Pesquisando",
  analyst: "Analisando dados",
  support: "Atendendo",
  custom: "Trabalhando",
};

export const PRIORITY_LABELS: Record<Priority, string> = { low: "Baixa", medium: "Média", high: "Alta", urgent: "Urgente" };

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pendente",
  running: "Em execução",
  completed: "Concluída",
  failed: "Falhou",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: "Planejando",
  ready: "Pronto",
  running: "Executando",
  completed: "Concluído",
  failed: "Falhou",
};

export const PROVIDER_LABELS: Record<Provider, string> = { anthropic: "Claude API", openai: "OpenAI API" };

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
