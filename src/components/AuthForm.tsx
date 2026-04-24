import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, User, ArrowRight, Loader2, CheckCircle2, KeyRound } from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

interface AuthFormProps {
  onAuthSuccess?: () => void;
  mode?: "login" | "signup";
}

export function AuthForm({ onAuthSuccess, mode: initialMode = "login" }: AuthFormProps) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Signup success state
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [signupEmail, setSignupEmail] = useState("");

  // Forgot password state
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSuccess, setForgotSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "signup") {
      if (password !== confirmPassword) {
        setError("Le password non coincidono");
        return;
      }
    }

    setLoading(true);

    try {
      if (mode === "login") {
        const result = await signIn(email, password);
        if (result.error) {
          setError(result.error);
          return;
        }
        if (onAuthSuccess) onAuthSuccess();
      } else {
        const result = await signUp(email, password, displayName || undefined);
        if (result.error) {
          setError(result.error);
          return;
        }
        // Show signup success screen — don't auto-login, Supabase requires email confirmation
        setSignupEmail(email);
        setSignupSuccess(true);
      }
    } catch (err: any) {
      setError(err.message || "Errore durante l'autenticazione");
    } finally {
      setLoading(false);
    }
  };



  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setForgotLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${window.location.origin}/`,
      });
      if (resetError) {
        setError(resetError.message || "Errore nell'invio dell'email di reset.");
      } else {
        setForgotSuccess(true);
      }
    } catch (err: any) {
      setError(err.message || "Errore nell'invio dell'email di reset.");
    } finally {
      setForgotLoading(false);
    }
  };

  // Signup success screen
  if (signupSuccess) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm mx-auto"
      >
        <div className="text-center">
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-serif text-brand-ink mb-3">
            Registrazione completata!
          </h2>
          <p className="text-sm text-brand-ink/60 leading-relaxed mb-6">
            Riceverai un'email di conferma all'indirizzo <strong className="text-brand-ink">{signupEmail}</strong>. 
            Clicca sul link per attivare il tuo account.
          </p>
          <button
            type="button"
            onClick={() => {
              setSignupSuccess(false);
              setMode("login");
              setSignupEmail("");
            }}
            className="w-full bg-brand-accent text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-3 hover:bg-brand-accent/85 transition-all shadow-lg shadow-brand-accent/25"
          >
            Vai al login
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </motion.div>
    );
  }

  // Forgot password screen
  if (showForgotPassword) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm mx-auto"
      >
        {forgotSuccess ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>
            <h2 className="text-2xl font-serif text-brand-ink mb-3">
              Email inviata!
            </h2>
            <p className="text-sm text-brand-ink/60 leading-relaxed mb-6">
              Se l'email è registrata, riceverai le istruzioni per reimpostare la password.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowForgotPassword(false);
                setForgotSuccess(false);
                setForgotEmail("");
              }}
              className="w-full bg-brand-accent text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-3 hover:bg-brand-accent/85 transition-all shadow-lg shadow-brand-accent/25"
            >
              Torna al login
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <div className="w-12 h-12 bg-brand-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <KeyRound className="w-6 h-6 text-brand-accent" />
              </div>
              <h2 className="text-2xl font-serif text-brand-ink">
                Password dimenticata?
              </h2>
              <p className="text-sm text-brand-ink/50 mt-2">
                Inserisci la tua email e ti invieremo le istruzioni per reimpostare la password.
              </p>
            </div>

            <form onSubmit={handleForgotPassword} className="space-y-5">
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
                  <Mail className="w-3 h-3" /> Email
                </label>
                <input
                  type="email"
                  required
                  placeholder="tu@email.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
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
                disabled={forgotLoading}
                className="w-full bg-brand-accent text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-3 hover:bg-brand-accent/85 transition-all disabled:opacity-50 shadow-lg shadow-brand-accent/25"
              >
                {forgotLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Invia istruzioni
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => {
                  setShowForgotPassword(false);
                  setError(null);
                }}
                className="text-sm text-brand-ink/40 hover:text-brand-accent transition-colors underline"
              >
                Torna al login
              </button>
            </div>
          </>
        )}
      </motion.div>
    );
  }

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

      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-brand-ink/10" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-3 text-brand-ink/30">accedi con email</span>
        </div>
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

        {mode === "signup" && (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-brand-ink/40">
              <Lock className="w-3 h-3" /> Conferma password
            </label>
            <input
              type="password"
              required
              minLength={6}
              placeholder="Ripeti la password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full bg-transparent border-b-2 border-brand-ink/10 py-3 text-base focus:border-brand-accent outline-none transition-colors placeholder:text-brand-ink/20"
            />
          </div>
        )}

        {mode === "login" && (
          <div className="text-right">
            <button
              type="button"
              onClick={() => {
                setShowForgotPassword(true);
                setError(null);
              }}
              className="text-xs text-brand-ink/40 hover:text-brand-accent transition-colors underline"
            >
              Password dimenticata?
            </button>
          </div>
        )}

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
            setConfirmPassword("");
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