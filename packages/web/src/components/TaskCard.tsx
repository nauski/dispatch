import { useDraggable } from "@dnd-kit/core";
import type { Task } from "../types.ts";
import { PRIORITY_COLORS } from "../types.ts";

interface TaskCardProps {
  task: Task;
  onSelect: (taskId: string) => void;
  isDragging?: boolean;
}

export function TaskCard({ task, onSelect, isDragging }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id });

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onSelect(task.id)}
      className={`bg-white rounded-lg p-3 shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0 select-none"
          onClick={(e) => e.stopPropagation()}
          title="Drag to move"
        >
          ⠿
        </div>
        <h3 className="text-sm font-medium text-gray-900 line-clamp-2 flex-1">{task.title}</h3>
        {task.requiresApproval && !task.approvedBy && (
          <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded shrink-0">
            Needs approval
          </span>
        )}
      </div>
      {task.description && (
        <p className="text-xs text-gray-500 line-clamp-2 mb-2">{task.description}</p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {task.mode === "broadcast" && (
          <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
            broadcast
          </span>
        )}
        {task.priority && (
          <span className={`text-xs px-1.5 py-0.5 rounded ${PRIORITY_COLORS[task.priority] || ""}`}>
            {task.priority}
          </span>
        )}
        {task.toRole && (
          <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
            {task.toRole}
          </span>
        )}
        {task.fromRole && (
          <span className="text-xs text-gray-400">from {task.fromRole}</span>
        )}
      </div>
      {task.mode === "broadcast" && task.executionSummary && (
        <div className="mt-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <span>{task.executionSummary.done}/{task.executionSummary.total} done</span>
            {task.executionSummary.failed > 0 && (
              <span className="text-red-500">{task.executionSummary.failed} failed</span>
            )}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-green-500 h-1.5 rounded-full transition-all"
              style={{ width: `${task.executionSummary.total > 0 ? (task.executionSummary.done / task.executionSummary.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
