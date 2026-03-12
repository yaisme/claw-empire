import { type ReactNode, useCallback, useEffect, useState } from "react";

const SESSION_URL = "/api/auth/session";
const TOKEN_KEY = "claw_api_auth_token";

interface LoginGateProps {
  children: ReactNode;
}

export default function LoginGate({ children }: LoginGateProps) {
  const [status, setStatus] = useState<"checking" | "login" | "authenticated">("checking");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const checkSession = useCallback(async (bearerToken?: string) => {
    const headers: HeadersInit = {};
    if (bearerToken) headers["Authorization"] = `Bearer ${bearerToken}`;
    try {
      const res = await fetch(SESSION_URL, { headers, credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        // Store CSRF token
        if (data.csrf_token) {
          sessionStorage.setItem("claw_api_csrf_token", data.csrf_token);
        }
        // Store auth token if provided
        if (bearerToken) {
          sessionStorage.setItem(TOKEN_KEY, bearerToken);
        }
        setStatus("authenticated");
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    // Try existing stored token first
    const stored = sessionStorage.getItem(TOKEN_KEY);
    checkSession(stored || undefined).then((ok) => {
      if (!ok) setStatus("login");
    });
  }, [checkSession]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;
    setError("");
    setSubmitting(true);
    const ok = await checkSession(trimmed);
    setSubmitting(false);
    if (!ok) {
      setError("Invalid token. Please check and try again.");
    }
  };

  if (status === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="text-sm text-slate-400">Connecting...</div>
      </div>
    );
  }

  if (status === "authenticated") {
    return <>{children}</>;
  }

  // Login form
  return (
    <div className="flex h-screen items-center justify-center bg-slate-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900/80 p-8 backdrop-blur-md"
      >
        <h1 className="mb-1 text-center text-2xl font-bold text-white">Claw-Empire</h1>
        <p className="mb-6 text-center text-sm text-slate-400">
          Enter your API token to continue
        </p>

        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="API Token"
          autoFocus
          className="mb-4 w-full rounded-lg border border-slate-600/50 bg-slate-800/80 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30"
        />

        {error && <p className="mb-3 text-center text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !token.trim()}
          className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Authenticating..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
