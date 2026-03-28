import { useDroppable } from "@dnd-kit/core";
import { useState } from "react";
import { TaskCard } from "./TaskCard.tsx";
import type { Task } from "../types.ts";

export type SortOption = "newest" | "oldest" | "priority";

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function sortTasks(tasks: Task[], sort: SortOption): Task[] {
  const sorted = [...tasks];
  switch (sort) {
    case "newest":
      return sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    case "oldest":
      return sorted.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
    case "priority":
      return sorted.sort((a, b) => (PRIORITY_ORDER[a.priority ?? "normal"] ?? 2) - (PRIORITY_ORDER[b.priority ?? "normal"] ?? 2));
  }
}

interface ColumnProps {
  id: string;
  title: string;
  tasks: Task[];
  onSelect: (taskId: string) => void;
  collapsible?: boolean;
  defaultCollapsed?: number;
}

export function Column({ id, title, tasks, onSelect, collapsible, defaultCollapsed = 5 }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const [sort, setSort] = useState<SortOption>("newest");
  const [expanded, setExpanded] = useState(false);

  const sorted = sortTasks(tasks, sort);
  const shouldCollapse = collapsible && !expanded && sorted.length > defaultCollapsed;
  const visible = shouldCollapse ? sorted.slice(0, defaultCollapsed) : sorted;
  const hiddenCount = sorted.length - visible.length;

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-72 bg-gray-100 rounded-xl p-3 border-2 transition-colors ${
        isOver ? "bg-blue-50 border-blue-300" : "border-transparent"
      }`}
    >
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-700 text-sm">{title}</h2>
          <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="text-xs text-gray-500 bg-transparent border-none cursor-pointer focus:outline-none"
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="priority">Priority</option>
        </select>
      </div>
      <div className="flex flex-col gap-2 min-h-[100px]">
        {visible.map((task) => (
          <TaskCard key={task.id} task={task} onSelect={onSelect} />
        ))}
        {shouldCollapse && (
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-blue-600 hover:text-blue-800 py-2 text-center"
          >
            Show {hiddenCount} more...
          </button>
        )}
        {collapsible && expanded && sorted.length > defaultCollapsed && (
          <button
            onClick={() => setExpanded(false)}
            className="text-xs text-gray-500 hover:text-gray-700 py-1 text-center"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}
