import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, User, ArrowRight, Loader2 } from "lucide-react";

interface AuthFormProps {
  onAuthSuccess?: () => void;
  mode?: "login" | "signup";
}

export function AuthForm({ onAuthSuccess, mode: initialMode = "login" }: AuthFormProps) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // These will be wired to the auth context in App.tsx
  // For now, interface only
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Auth will be called from App.tsx — this is a presentational component
      // The actual signIn/signUp is passed via props in the integrated version
      if (onAuthSuccess) onAuthSuccess();
    } catch (err: any) {
      setError(err.message || "Errore durante l'autenticazione");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-sm mx-auto"
    >
      <div className="text-center mb-8">
        <h2 className="text-2xl font-serif text-brand-ink">
          {mode === "login" ? "Bentornato" : "Crea il tuo account"}
        </h2>
        <p className="text-sm text-brand-ink/50 mt-2">
          {mode === "login"
            ? "Accedi per ritrovare i tuoi viaggi salvati"
            : "Registrati per salvare i tuoi viaggi e il tuo profilo"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {mode === "signup" && (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
              <User className="w-3 h-3" /> Nome
            </label>
            <input
              type="text"
              placeholder="Il tuo nome"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-transparent border-b-2 border-brand-ink/10 py-3 text-base focus:border-brand-accent outline-none transition-colors placeholder:text-brand-ink/20"
            />
          </div>
        )}

        <div className="space-y-1">
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
            <Mail className="w-3 h-3" /> Email
          </label>
          <input
            type="email"
            required
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-transparent border-b-2 border-brand-ink/10 py-3 text-base focus:border-brand-accent outline-none transition-colors placeholder:text-brand-ink/20"
          />
        </div>

        <div className="space-y-1">
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
            <Lock className="w-3 h-3" /> Password
          </label>
          <input
            type="password"
            required
            minLength={6}
            placeholder="Almeno 6 caratteri"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-transparent border-b-2 border-brand-ink/10 py-3 text-base focus:border-brand-accent outline-none transition-colors placeholder:text-brand-ink/20"
          />
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-red-500 text-sm bg-red-50 p-3 rounded-xl"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-accent text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-3 hover:bg-brand-accent/85 transition-all disabled:opacity-50 shadow-lg shadow-brand-accent/25"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              {mode === "login" ? "Accedi" : "Registrati"}
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>
      </form>

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
          }}
          className="text-sm text-brand-ink/40 hover:text-brand-accent transition-colors underline"
        >
          {mode === "login"
            ? "Non hai un account? Registrati"
            : "Hai già un account? Accedi"}
        </button>
      </div>
    </motion.div>
  );
}