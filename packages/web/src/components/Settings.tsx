import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client.ts";
import type { ApiKey } from "../types.ts";

export function Settings() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Revoke confirmation
  const [revokeId, setRevokeId] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    try {
      const data = await api.keys.list();
      setKeys(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadKeys();
  }, [loadKeys]);

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const trimmedName = name.trim();
    const trimmedKey = key.trim();

    if (!trimmedName) {
      setError("Name is required");
      return;
    }
    if (!trimmedKey) {
      setError("Key is required");
      return;
    }

    setSubmitting(true);
    try {
      const newKey = await api.keys.create({ name: trimmedName, key: trimmedKey });
      setKeys((prev) => [...prev, newKey]);
      setName("");
      setKey("");
      setSuccess("Key registered successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register key");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setError(null);
    setSuccess(null);
    try {
      await api.keys.revoke(id);
      setKeys((prev) =>
        prev.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k))
      );
      setRevokeId(null);
      setSuccess("Key revoked successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    }
  };

  const formatDate = (date: string | null) => {
    if (!date) return "—";
    return new Date(date).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Settings</h2>

      {/* API Keys Section */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">API Keys</h3>
          <p className="text-sm text-gray-500 mt-1">
            Manage API keys used by daemons and runners to authenticate with the server.
          </p>
        </div>

        {/* Messages */}
        {error && (
          <div className="mx-6 mt-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="mx-6 mt-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
            {success}
          </div>
        )}

        {/* Keys Table */}
        <div className="px-6 py-4">
          {loading ? (
            <p className="text-sm text-gray-500">Loading keys...</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-gray-500">No API keys registered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Key Prefix</th>
                    <th className="pb-2 font-medium">Created</th>
                    <th className="pb-2 font-medium">Last Used</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => {
                    const revoked = !!k.revokedAt;
                    return (
                      <tr
                        key={k.id}
                        className={`border-b border-gray-100 last:border-b-0 ${revoked ? "opacity-50" : ""}`}
                      >
                        <td className={`py-3 text-gray-900 ${revoked ? "line-through" : ""}`}>
                          {k.name}
                        </td>
                        <td className="py-3">
                          <code className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                            {k.keyPrefix}...
                          </code>
                        </td>
                        <td className="py-3 text-gray-600">{formatDate(k.createdAt)}</td>
                        <td className="py-3 text-gray-600">{formatDate(k.lastUsedAt)}</td>
                        <td className="py-3">
                          {revoked ? (
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                              Revoked
                            </span>
                          ) : (
                            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="py-3 text-right">
                          {!revoked && (
                            <>
                              {revokeId === k.id ? (
                                <span className="flex items-center justify-end gap-2">
                                  <span className="text-xs text-gray-500">Revoke?</span>
                                  <button
                                    onClick={() => handleRevoke(k.id)}
                                    className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700 transition-colors"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    onClick={() => setRevokeId(null)}
                                    className="text-xs text-gray-500 hover:text-gray-700"
                                  >
                                    Cancel
                                  </button>
                                </span>
                              ) : (
                                <button
                                  onClick={() => setRevokeId(k.id)}
                                  className="text-xs text-red-600 hover:text-red-800 transition-colors"
                                >
                                  Revoke
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Add Key Form */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">Register New Key</h4>
          <p className="text-xs text-gray-500 mb-3">
            Generate a key on the target machine during install, then paste it here.
          </p>
          <form onSubmit={handleRegister} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="e.g. prod-runner-01"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Key</label>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="Paste the generated key"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !name.trim() || !key.trim()}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {submitting ? "Registering..." : "Register Key"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
