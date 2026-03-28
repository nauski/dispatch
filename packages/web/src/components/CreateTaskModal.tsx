import { useState } from "react";
import type { Role } from "../types.ts";

interface CreateTaskModalProps {
  roles: Role[];
  onSubmit: (data: {
    title: string;
    description?: string;
    toRole?: string;
    priority?: string;
    requiresApproval?: boolean;
    mode?: "single" | "broadcast";
    targets?: string[];
    excludeTargets?: string[];
  }) => void;
  onClose: () => void;
}

export function CreateTaskModal({ roles, onSubmit, onClose }: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [toRole, setToRole] = useState("");
  const [priority, setPriority] = useState("normal");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [mode, setMode] = useState<"single" | "broadcast">("single");
  const [targetsInput, setTargetsInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targets = targetsInput.trim()
      ? targetsInput.split(",").map(s => s.trim()).filter(Boolean)
      : undefined;
    onSubmit({
      title,
      description: description || undefined,
      toRole: toRole || undefined,
      priority,
      requiresApproval,
      mode,
      targets,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 mb-4">Create Task</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="What needs to be done?"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              placeholder="Additional details..."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Assign to role</label>
              <input
                type="text"
                list="roles-list"
                value={toRole}
                onChange={(e) => setToRole(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="e.g. infra, dev, frontend"
              />
              <datalist id="roles-list">
                {roles.map((r) => (
                  <option key={r.name} value={r.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={requiresApproval}
                onChange={(e) => setRequiresApproval(e.target.checked)}
                className="rounded"
              />
              Requires approval
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={mode === "broadcast"}
                onChange={(e) => setMode(e.target.checked ? "broadcast" : "single")}
                className="rounded"
              />
              Broadcast to all daemons
            </label>
          </div>
          {mode === "broadcast" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target machines (optional, comma-separated)</label>
              <input
                type="text"
                value={targetsInput}
                onChange={(e) => setTargetsInput(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Leave empty for all daemons with the role"
              />
            </div>
          )}
          <div className="flex justify-end gap-3 mt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
              Cancel
            </button>
            <button type="submit" disabled={!title} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
