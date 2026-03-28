import { DndContext, DragEndEvent, DragOverlay, closestCenter } from "@dnd-kit/core";
import { useState } from "react";
import { Column } from "./Column.tsx";
import { TaskCard } from "./TaskCard.tsx";
import { COLUMNS, COLUMN_LABELS, type Task } from "../types.ts";

interface BoardProps {
  tasks: Task[];
  onMove: (taskId: string, newStatus: string) => void;
  onSelect: (taskId: string) => void;
}

export function Board({ tasks, onMove, onSelect }: BoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeTask = tasks.find((t) => t.id === activeId);

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const newStatus = over.id as string;
    const task = tasks.find((t) => t.id === taskId);
    if (task && task.status !== newStatus && COLUMNS.includes(newStatus as any)) {
      onMove(taskId, newStatus);
    }
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragStart={(e) => setActiveId(e.active.id as string)}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <Column
            key={col}
            id={col}
            title={COLUMN_LABELS[col]}
            tasks={tasks.filter((t) => t.status === col)}
            onSelect={onSelect}
            collapsible={col === "done" || col === "failed"}
          />
        ))}
      </div>
      <DragOverlay>
        {activeTask ? <TaskCard task={activeTask} onSelect={() => {}} isDragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}
