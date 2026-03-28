import { useState, useEffect } from "react";
import { api } from "../api/client.ts";
import type { Task, Comment, TaskExecution } from "../types.ts";
import { PRIORITY_COLORS } from "../types.ts";

declare global {
  interface Window {
    __LANGFUSE_URL__?: string;
  }
}

interface TaskDetailProps {
  taskId: string;
  onClose: () => void;
  onUpdate: () => void;
}

interface TaskWithDetails extends Task {
  history: { id: string; action: string; actor: string; details: any; createdAt: string }[];
  dependencies: { id: string; dependsOn: string }[];
  attachments: { id: string; filename: string; mimeType: string; sizeBytes: number; createdAt: string }[];
  comments: Comment[];
  executions: TaskExecution[];
}

export function TaskDetail({ taskId, onClose, onUpdate }: TaskDetailProps) {
  const [task, setTask] = useState<TaskWithDetails | null>(null);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.tasks.get(taskId).then(setTask);
  }, [taskId]);

  if (!task) return null;

  const handleApprove = async () => {
    await api.tasks.approve(task.id, "web-ui");
    onUpdate();
    const updated = await api.tasks.get(taskId);
    setTask(updated);
  };

  const handleComment = async () => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    await api.tasks.addComment(task.id, { author: "web-ui", body: commentText.trim() });
    setCommentText("");
    setSubmitting(false);
    onUpdate();
    const updated = await api.tasks.get(taskId);
    setTask(updated);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{task.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`text-xs px-1.5 py-0.5 rounded ${PRIORITY_COLORS[task.priority || "normal"]}`}>
                {task.priority}
              </span>
              <span className="text-xs text-gray-500">Status: {task.status}</span>
              {task.toRole && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{task.toRole}</span>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {task.description && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-1">Description</h3>
            <p className="text-sm text-gray-600 whitespace-pre-wrap">{task.description}</p>
          </div>
        )}

        {task.result && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-1">Result</h3>
            <pre className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{task.result}</pre>
          </div>
        )}

        {task.mode === "broadcast" && task.executions.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Executions</h3>
            <div className="flex flex-col gap-1.5">
              {task.executions.map((exec) => (
                <div key={exec.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">{exec.machineName}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      exec.status === "done" ? "bg-green-100 text-green-700" :
                      exec.status === "failed" ? "bg-red-100 text-red-700" :
                      exec.status === "in_progress" ? "bg-blue-100 text-blue-700" :
                      "bg-gray-100 text-gray-600"
                    }`}>
                      {exec.status}
                    </span>
                  </div>
                  {exec.completedAt && (
                    <span className="text-xs text-gray-400">{new Date(exec.completedAt).toLocaleString()}</span>
                  )}
                </div>
              ))}
            </div>
            {task.executions.some(e => e.result) && (
              <details className="mt-2">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Show results</summary>
                <div className="mt-1 flex flex-col gap-2">
                  {task.executions.filter(e => e.result).map((exec) => (
                    <div key={exec.id} className="bg-gray-50 rounded-lg p-3">
                      <span className="text-xs font-medium text-gray-700">{exec.machineName}</span>
                      <pre className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{exec.result}</pre>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {task.requiresApproval && !task.approvedBy && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-center justify-between">
            <span className="text-sm text-yellow-800">This task requires approval before execution.</span>
            <button onClick={handleApprove} className="bg-green-600 text-white px-3 py-1 rounded-lg text-sm hover:bg-green-700">
              Approve
            </button>
          </div>
        )}

        {task.langfuseTraceId && window.__LANGFUSE_URL__ && (
          <div className="mb-4">
            <a
              href={`${window.__LANGFUSE_URL__}/trace/${task.langfuseTraceId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              View Langfuse trace
            </a>
          </div>
        )}

        {task.attachments.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Attachments</h3>
            <div className="flex flex-col gap-1">
              {task.attachments.map((a) => (
                <div key={a.id} className="text-sm text-gray-600 flex items-center gap-2">
                  <span>{a.filename}</span>
                  <span className="text-xs text-gray-400">({(a.sizeBytes / 1024).toFixed(1)} KB)</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {task.comments.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Comments</h3>
            <div className="flex flex-col gap-2">
              {task.comments.map((c) => (
                <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-700">{c.author}</span>
                    <span className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !submitting && handleComment()}
              placeholder="Add a comment..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleComment}
              disabled={submitting || !commentText.trim()}
              className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-2">History</h3>
          <div className="flex flex-col gap-2">
            {task.history.map((h) => (
              <div key={h.id} className="text-xs text-gray-500 flex items-center gap-2">
                <span className="font-mono">{new Date(h.createdAt).toLocaleString()}</span>
                <span className="font-medium text-gray-700">{h.action}</span>
                <span>by {h.actor}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
