import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { createClient } from "../lib/client"
import logo from "../public/ai_logo.svg"

export const Auth = () => {
  const supabase = createClient()
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState<"google" | "github" | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const login = async (provider: "google" | "github") => {
    setErrorMessage(null)
    setIsLoading(provider)

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/dashboard` },
    })

    setIsLoading(null)

    if (error) {
      setErrorMessage(error.message)
    }
  }

  return (
    <div className="auth-root w-screen">
      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <img
              src={logo}
              alt="Logo"
              width={40}
              height={40}
              className="w-10 h-10"
            />
          <span className="auth-logo-text">Perplexity</span>
        </div>

        <h1 className="auth-heading">Sign in to Perplexity</h1>
        <p className="auth-sub">Search the web with AI. Your conversations, saved.</p>

        {errorMessage && (
          <div className="auth-error">{errorMessage}</div>
        )}

        <div className="auth-buttons">
          <button
            className="auth-btn auth-btn-google"
            onClick={() => login("google")}
            disabled={isLoading !== null}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615Z" fill="#4285F4" />
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853" />
              <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332Z" fill="#FBBC05" />
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335" />
            </svg>
            {isLoading === "google" ? "Signing in…" : "Continue with Google"}
          </button>

          <button
            className="auth-btn auth-btn-github"
            onClick={() => login("github")}
            disabled={isLoading !== null}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12Z" />
            </svg>
            {isLoading === "github" ? "Signing in…" : "Continue with GitHub"}
          </button>
        </div>

        <p className="auth-footer">
          By continuing, you agree to Perplexity's Terms and Privacy Policy.
        </p>
      </div>

      <style>{`
        .auth-root {
          min-height: 100vh;
          background: #0a0a0f;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
        }
        .auth-card {
          width: 100%;
          max-width: 400px;
          background: #111118;
          border: 1px solid #1e1e2e;
          border-radius: 16px;
          padding: 40px 36px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
        }
        .auth-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 28px;
        }
        .auth-logo-text {
          font-size: 18px;
          font-weight: 600;
          color: #e8e8f0;
          letter-spacing: -0.3px;
        }
        .auth-heading {
          font-size: 22px;
          font-weight: 600;
          color: #e8e8f0;
          text-align: center;
          margin: 0 0 8px;
          letter-spacing: -0.4px;
        }
        .auth-sub {
          font-size: 14px;
          color: #6b6b80;
          text-align: center;
          margin: 0 0 28px;
          line-height: 1.5;
        }
        .auth-error {
          width: 100%;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #fca5a5;
          font-size: 13px;
          padding: 10px 14px;
          border-radius: 8px;
          margin-bottom: 16px;
          text-align: center;
        }
        .auth-buttons {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 24px;
        }
        .auth-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 11px 16px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: opacity 0.15s, background 0.15s;
          border: none;
        }
        .auth-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .auth-btn-google {
          background: #fff;
          color: #1a1a1a;
        }
        .auth-btn-google:hover:not(:disabled) {
          background: #f0f0f0;
        }
        .auth-btn-github {
          background: #21262d;
          color: #e8e8f0;
          border: 1px solid #30363d;
        }
        .auth-btn-github:hover:not(:disabled) {
          background: #2d333a;
        }
        .auth-footer {
          font-size: 11px;
          color: #44445a;
          text-align: center;
          line-height: 1.6;
          margin: 0;
        }
      `}</style>
    </div>
  )
}