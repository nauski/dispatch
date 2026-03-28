import { useState } from "react";
import type { Daemon } from "../types.ts";

export function StatusBar({ daemons }: { daemons: Daemon[] }) {
  const [showModal, setShowModal] = useState(false);
  const online = daemons.filter((d) => d.connected).length;

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
      >
        <div className={`w-2 h-2 rounded-full ${online > 0 ? "bg-green-500" : "bg-gray-400"}`} />
        <span>
          {online} daemon{online !== 1 ? "s" : ""} online
        </span>
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Connected Daemons</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {daemons.length === 0 ? (
              <p className="text-sm text-gray-500">No daemons connected.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {daemons.map((d) => {
                  const typeLabel = d.type === "executor" ? "hands" : d.type === "runner" ? "brain" : "standalone";
                  const typeColor = d.type === "executor" ? "bg-amber-100 text-amber-700" : d.type === "runner" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700";
                  return (
                    <div key={d.id} className="border border-gray-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`w-2 h-2 rounded-full ${d.connected ? "bg-green-500" : "bg-gray-400"}`} />
                        <span className="font-medium text-sm text-gray-900">{d.machineName}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${typeColor}`}>{typeLabel}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {d.roles.map((role) => (
                          <span key={role} className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                            {role}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
