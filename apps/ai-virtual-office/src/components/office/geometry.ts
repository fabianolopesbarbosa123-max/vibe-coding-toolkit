import type { Agent, RoomId } from "@/lib/domain";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Room rectangles in percent of the office floor (aspect ratio 5:3). */
export const ROOMS: Record<RoomId, Rect> = {
  planning: { x: 1, y: 2, w: 28, h: 42 },
  programming: { x: 30, y: 2, w: 40, h: 42 },
  research: { x: 71, y: 2, w: 28, h: 42 },
  marketing: { x: 1, y: 56, w: 28, h: 42 },
  meeting: { x: 30, y: 56, w: 24, h: 42 },
  support: { x: 55, y: 56, w: 18, h: 42 },
  monitoring: { x: 74, y: 56, w: 25, h: 42 },
};

export interface Point {
  x: number;
  y: number;
}

const DESK_GRID: Point[] = [
  { x: 0.28, y: 0.34 },
  { x: 0.72, y: 0.34 },
  { x: 0.28, y: 0.74 },
  { x: 0.72, y: 0.74 },
];

export function deskPosition(room: RoomId, index: number): Point {
  const rect = ROOMS[room];
  const slot = DESK_GRID[index % DESK_GRID.length];
  const ring = Math.floor(index / DESK_GRID.length) * 0.08;
  return { x: rect.x + rect.w * (slot.x + ring), y: rect.y + rect.h * slot.y };
}

export function meetingSeat(index: number): Point {
  const rect = ROOMS.meeting;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2 + 5;
  const angle = (index / 8) * Math.PI * 2 - Math.PI / 2;
  return { x: cx + Math.cos(angle) * rect.w * 0.36, y: cy + Math.sin(angle) * rect.h * 0.3 };
}

/** Desk index of each agent within its room, by creation order. */
export function assignDesks(agents: Agent[]): Map<string, number> {
  const counters = new Map<RoomId, number>();
  const desks = new Map<string, number>();
  for (const agent of agents) {
    const index = counters.get(agent.room) ?? 0;
    desks.set(agent.id, index);
    counters.set(agent.room, index + 1);
  }
  return desks;
}

export function agentPosition(agent: Agent, deskIndex: number, meetingIndex: number): { point: Point; seated: boolean } {
  if (agent.status === "meeting") return { point: meetingSeat(meetingIndex), seated: true };
  const desk = deskPosition(agent.room, deskIndex);
  if (agent.status === "idle") return { point: { x: desk.x + 4.5, y: desk.y + 8 }, seated: false };
  return { point: { x: desk.x, y: desk.y + 8 }, seated: true };
}
