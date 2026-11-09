"use client";

import { ActivityFeed } from "@/components/activity-feed";
import { FileManager } from "@/components/files/file-manager";
import { WithSnapshot } from "@/components/page-state";
import { ProjectForm } from "@/components/tasks/project-form";
import { ProjectList } from "@/components/tasks/project-list";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskForm } from "@/components/tasks/task-form";
import { Card } from "@/components/ui";

export default function TasksPage() {
  return (
    <WithSnapshot>
      {snapshot => (
        <div className="grid gap-4">
          <h1 className="text-xl font-semibold text-slate-100">Tarefas e projetos</h1>
          <TaskBoard tasks={snapshot.tasks} agents={snapshot.agents} projects={snapshot.projects} />
          <div className="grid items-start gap-4 lg:grid-cols-3">
            <TaskForm />
            <div className="grid content-start gap-4">
              <ProjectForm />
              <FileManager snapshot={snapshot} />
            </div>
            <Card title="Histórico de atividades"><ActivityFeed events={snapshot.events} limit={20} /></Card>
          </div>
          <Card title="Projetos"><ProjectList projects={snapshot.projects} tasks={snapshot.tasks} /></Card>
        </div>
      )}
    </WithSnapshot>
  );
}
