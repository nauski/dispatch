import { useState, useEffect, useCallback } from "react";
import { Board } from "./components/Board.tsx";
import { CreateTaskModal } from "./components/CreateTaskModal.tsx";
import { TaskDetail } from "./components/TaskDetail.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { Settings } from "./components/Settings.tsx";
import { useWebSocket } from "./hooks/useWebSocket.ts";
import { api } from "./api/client.ts";
import type { Task, Role, Daemon } from "./types.ts";

type Page = "board" | "settings";

function getInitialPage(): Page {
  return window.location.pathname === "/settings" ? "settings" : "board";
}

export function App() {
  const [page, setPage] = useState<Page>(getInitialPage);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [daemons, setDaemons] = useState<Daemon[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState(0);

  const navigate = useCallback((p: Page) => {
    setPage(p);
    window.history.pushState(null, "", p === "board" ? "/" : `/${p}`);
  }, []);

  useEffect(() => {
    const onPopState = () => setPage(getInitialPage());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const refresh = useCallback(async () => {
    const [t, r, d] = await Promise.all([api.tasks.list(), api.roles.list(), api.daemons.list()]);
    setTasks(t);
    setRoles(r);
    setDaemons(d);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Load server config (langfuse URL etc.)
  useEffect(() => {
    api.config.get().then((cfg) => {
      if (cfg.langfuseUrl) window.__LANGFUSE_URL__ = cfg.langfuseUrl;
    }).catch(() => {});
  }, []);

  useWebSocket(useCallback((event: any) => {
    if (event.type === "task:created" && event.task) {
      setTasks((prev) => [...prev, event.task]);
    } else if (event.type === "task:updated" && event.task) {
      setTasks((prev) => prev.map((t) => (t.id === event.task.id ? event.task : t)));
    } else if (event.type === "task:comment") {
      setDetailKey((k) => k + 1);
    } else if (event.type === "task:execution_updated") {
      setDetailKey((k) => k + 1);
      // Refresh to get updated execution summaries
      refresh();
    } else if (event.type === "daemon:connected" && event.daemon) {
      setDaemons((prev) => [...prev.filter((d) => d.id !== event.daemon.id), { ...event.daemon, connected: true }]);
    } else if (event.type === "daemon:disconnected") {
      setDaemons((prev) => prev.filter((d) => d.id !== event.daemonId));
    }
  }, []));

  const handleMove = async (taskId: string, newStatus: string) => {
    await api.tasks.update(taskId, { status: newStatus, actor: "web-ui" });
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
  };

  const handleCreate = async (data: Parameters<typeof api.tasks.create>[0]) => {
    await api.tasks.create(data);
    setShowCreate(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="relative z-10 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1
            className="text-xl font-bold text-gray-900 cursor-pointer"
            onClick={() => navigate("board")}
          >
            Dispatch
          </h1>
          <nav className="flex items-center gap-1">
            <button
              onClick={() => navigate("board")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                page === "board"
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              Board
            </button>
            <button
              onClick={() => navigate("settings")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                page === "settings"
                  ? "bg-gray-100 text-gray-900"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <StatusBar daemons={daemons} />
          {page === "board" && (
            <button
              onClick={() => setShowCreate(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              New Task
            </button>
          )}
        </div>
      </header>

      <main className="p-6">
        {page === "board" && (
          <Board tasks={tasks} onMove={handleMove} onSelect={setSelectedTask} />
        )}
        {page === "settings" && <Settings />}
      </main>

      {showCreate && (
        <CreateTaskModal roles={roles} onSubmit={handleCreate} onClose={() => setShowCreate(false)} />
      )}

      {selectedTask && (
        <TaskDetail
          key={detailKey}
          taskId={selectedTask}
          onClose={() => setSelectedTask(null)}
          onUpdate={refresh}
        />
      )}
    </div>
  );
}
