import type { FormEvent } from "react"
import { flushSync } from "react-dom"
import { createParser, type EventSourceMessage } from "eventsource-parser";
import type { User } from "@supabase/supabase-js"
import { useEffect, useRef, useState, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { createClient } from "../lib/client"

const BACKEND_URL = process.env.BUN_PUBLIC_BACKEND_URL ?? "http://localhost:3000"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Source {
  title?: string
  url?: string
  link?: string
  content?: string
}

interface Message {
  role: "user" | "assistant"
  content: string
  sources?: Source[]
}

interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  _count?: { messages: number }
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
  </svg>
)
const IconPlus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)
const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </svg>
)
const IconChevronRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
)
const IconSend = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 2 11 13M22 2 15 22l-4-9-9-4 20-7Z" />
  </svg>
)
const IconGlobe = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
)
const IconMenu = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12h18M3 6h18M3 18h18" />
  </svg>
)
const IconX = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
)
const IconClock = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
  </svg>
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "")
  } catch {
    return url
  }
}

function getFavicon(url: string): string {
  try {
    const domain = new URL(url).origin
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
  } catch {
    return ""
  }
}

// ─── Markdown-lite renderer ───────────────────────────────────────────────────
// Renders **bold**, *italic*, `code`, and newlines — lightweight, no dep needed

function renderMarkdown(text: string, sources?: Source[]) {
  const lines = text.split("\n")
  return lines.map((line, i) => {
    const parts: React.ReactNode[] = []
    // Added citation patterns: [1] and 【1】
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(\d+)\]|【(\d+)】)/g
    let last = 0
    let match
    while ((match = regex.exec(line)) !== null) {
      if (match.index > last) parts.push(line.slice(last, match.index))
      if (match[2]) {
        parts.push(<strong key={match.index}>{match[2]}</strong>)
      } else if (match[3]) {
        parts.push(<em key={match.index}>{match[3]}</em>)
      } else if (match[4]) {
        parts.push(<code key={match.index} className="inline-code">{match[4]}</code>)
      } else if (match[5] || match[6]) {
        const num = parseInt(match[5] || match[6] || "0", 10)
        const source = sources?.[num - 1]
        const href = source?.url || source?.link
        parts.push(
          href ? (
            <a
              key={match.index}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="citation-link"
            >
              [{num}]
            </a>
          ) : (
            <span key={match.index} className="citation-link citation-link-disabled">[{num}]</span>
          )
        )
      }
      last = match.index + match[0].length
    }
    if (last < line.length) parts.push(line.slice(last))
    return (
      <span key={i}>
        {parts.length ? parts : line}
        {i < lines.length - 1 && "\n"}
      </span>
    )
  })
}

function renderInline(line: string, sources?: Source[], keyPrefix: string | number = 0) {
  const parts: React.ReactNode[] = []
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[(\d+)\]|【(\d+)】)/g
  let last = 0
  let match
  let i = 0
  while ((match = regex.exec(line)) !== null) {
    if (match.index > last) parts.push(line.slice(last, match.index))
    const key = `${keyPrefix}-${i++}`
    if (match[2]) {
      parts.push(<strong key={key}>{match[2]}</strong>)
    } else if (match[3]) {
      parts.push(<em key={key}>{match[3]}</em>)
    } else if (match[4]) {
      parts.push(<code key={key} className="inline-code">{match[4]}</code>)
    } else if (match[5] || match[6]) {
      const num = parseInt(match[5] || match[6] || "0", 10)
      const source = sources?.[num - 1]
      const href = source?.url || source?.link
      parts.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="citation-link">
            [{num}]
          </a>
        ) : (
          <span key={key} className="citation-link citation-link-disabled">[{num}]</span>
        )
      )
    }
    last = match.index + match[0].length
  }
  if (last < line.length) parts.push(line.slice(last))
  return parts.length ? parts : [line]
}

function renderRichContent(text: string, sources?: Source[]) {
  const blocks: React.ReactNode[] = []
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let blockKey = 0

  const renderTextChunk = (chunk: string, key: number) => {
    const lines = chunk.split("\n")
    const elements: React.ReactNode[] = []
    let listBuffer: string[] = []

    const flushList = () => {
      if (listBuffer.length > 0) {
        elements.push(
          <ul className="md-list" key={`list-${key}-${elements.length}`}>
            {listBuffer.map((item, li) => (
              <li key={li}>{renderInline(item, sources, `${key}-${elements.length}-${li}`)}</li>
            ))}
          </ul>
        )
        listBuffer = []
      }
    }

    lines.forEach((line, li) => {
      const trimmed = line.trim()
      const bulletMatch = trimmed.match(/^[-*]\s+(.*)/)
      if (bulletMatch) {
        listBuffer.push(bulletMatch[1] ?? "")
        return
      }
      flushList()
      if (trimmed === "") {
        elements.push(<div key={`sp-${key}-${li}`} style={{ height: 6 }} />)
      } else if (/^#{1,3}\s+/.test(trimmed)) {
        const headingText = trimmed.replace(/^#{1,3}\s+/, "")
        elements.push(
          <h4 className="md-heading" key={`h-${key}-${li}`}>
            {renderInline(headingText, sources, `${key}-${li}`)}
          </h4>
        )
      } else {
        elements.push(
          <p className="md-para" key={`p-${key}-${li}`}>
            {renderInline(line, sources, `${key}-${li}`)}
          </p>
        )
      }
    })
    flushList()
    return elements
  }

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const m = match
    if (m.index > lastIndex) {
      blocks.push(...renderTextChunk(text.slice(lastIndex, m.index), blockKey++))
    }
    const lang = m[1] ?? ""
    const code = (m[2] ?? "").replace(/\n$/, "")
    blocks.push(
      <pre className="md-code-block" key={`code-${blockKey++}`}>
        {lang && <div className="md-code-lang">{lang}</div>}
        <code>{code}</code>
      </pre>
    )
    lastIndex = codeBlockRegex.lastIndex
  }
  if (lastIndex < text.length) {
    blocks.push(...renderTextChunk(text.slice(lastIndex), blockKey++))
  }

  return blocks
}

// ─── Main Component ───────────────────────────────────────────────────────────

const Dashboard = () => {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [messages, setMessages] = useState<Message[]>([])
  const [currentSources, setCurrentSources] = useState<Source[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [followups, setFollowups] = useState<string[]>([])
  const [loadingFollowups, setLoadingFollowups] = useState(false)
  const [activeConvId, setActiveConvId] = useState<string | null>(null)
  const [sourcesVisible, setSourcesVisible] = useState(true)

  const supabase = createClient()
  const navigate = useNavigate()
  // const bottomRef = useRef<HTMLDivElement>(null)
  // const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const streamedTextRef = useRef("")
  const animationFrameRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  // ── Auth ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const fetchUser = async () => {
      const { data } = await supabase.auth.getUser()
      setUser(data.user)
      setIsLoading(false)
    }
    fetchUser()
  }, [])

  // ── Conversations ───────────────────────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    if (!token) return
    const res = await fetch(`${BACKEND_URL}/conversations`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      setConversations(data.conversations || [])
    }
  }, [])

  useEffect(() => {
    if (!isLoading && user) fetchConversations()
  }, [isLoading, user])

  // ── Auto-scroll ──────────────────────────────────────────────────────────────

  // useEffect(() => {
  //   bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  // }, [messages])
  useEffect(() => {
    bottomRef.current?.scrollIntoView({
        behavior: isSubmitting ? "instant" : "smooth",
        block: "end",
    })
  }, [messages, isSubmitting])

  // ── Textarea auto-resize ─────────────────────────────────────────────────────

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px"
  }, [query])

  // ── Sign out ─────────────────────────────────────────────────────────────────

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    navigate("/auth")
  }

  // ── Load conversation ─────────────────────────────────────────────────────────

  const loadConversation = async (convId: string) => {
    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    if (!token) return
    const res = await fetch(`${BACKEND_URL}/conversation/${convId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      const msgs: Message[] = data.conversation.messages.map((m: any) => ({
        role: m.role,
        content: m.content,
        sources: m.sources || [],
      }))
      setMessages(msgs)
      setConversationId(convId)
      setActiveConvId(convId)
      // Set sources from last assistant message
      const lastAssistant = [...msgs].reverse().find(m => m.role === "assistant")
      setCurrentSources(lastAssistant?.sources || [])
      setFollowups([])
    }
  }

  // ── Delete conversation ──────────────────────────────────────────────────────

  const deleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    if (!token) return
    await fetch(`${BACKEND_URL}/conversation/${convId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    })
    setConversations(prev => prev.filter(c => c.id !== convId))
    if (activeConvId === convId) {
      setMessages([])
      setConversationId(null)
      setActiveConvId(null)
      setCurrentSources([])
      setFollowups([])
    }
  }

  // ── New conversation ──────────────────────────────────────────────────────────

  const newConversation = () => {
    setMessages([])
    setConversationId(null)
    setActiveConvId(null)
    setCurrentSources([])
    setFollowups([])
    setQuery("")
    setError(null)
    textareaRef.current?.focus()
  }

  // ── Fetch followups ──────────────────────────────────────────────────────────

  const fetchFollowups = async (convId: string) => {
    setLoadingFollowups(true)
    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    if (!token) { setLoadingFollowups(false); return }
    try {
      const res = await fetch(`${BACKEND_URL}/perplexity-ask-followups`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId: convId }),
      })
      if (res.ok) {
        const data = await res.json()
        setFollowups(data.followups || [])
      }
    } finally {
      setLoadingFollowups(false)
    }
  }

  // ── Submit query ──────────────────────────────────────────────────────────────

  const handleSubmit = async (queryText: string) => {
    if (!queryText.trim() || isSubmitting) return
    setError(null)
    setIsSubmitting(true)
    setFollowups([])

    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    if (!token) {
      setError("Authentication failed. Please sign in again.")
      setIsSubmitting(false)
      return
    }

    setMessages(prev => [...prev, { role: "user", content: queryText }])
    setCurrentSources([])

    try {
      const response = await fetch(`${BACKEND_URL}/perplexity-ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: queryText, conversationId }),
      })

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error || "Unable to reach the backend.")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let assistantText = ""
      let newConvId: string | null = null
      let streamedSources: Source[] = []

      // setMessages(prev => [...prev, { role: "assistant", content: "" }])
      streamedTextRef.current = ""

      flushSync(() => {
        setMessages(prev => [
          ...prev,
          {
            role: "assistant",
            content: "",
          },
        ])
      })

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          // flush whatever's left in buffer as a final event, if it looks complete
          if (buffer.trim()) {
            const lines = buffer.split("\n")
            const eventLine = lines.find(l => l.startsWith("event:"))
            const dataLine = lines.find(l => l.startsWith("data:"))
            if (eventLine && dataLine) {
              const eventName = eventLine.replace("event:", "").trim()
              try {
                const eventData = JSON.parse(dataLine.replace("data:", "").trim())
                if (eventName === "delta") {
                  assistantText += eventData.text
                  streamedTextRef.current = assistantText
                }
                if (eventName === "sources") streamedSources = eventData.sources
              } catch { /* ignore malformed trailing chunk */ }
            }
          }
          break
        }
      
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split("\n\n")
        buffer = parts.pop() ?? ""
      
        for (const part of parts) {
          const lines = part.split("\n")
          const eventLine = lines.find(l => l.startsWith("event:"))
          const dataLine = lines.find(l => l.startsWith("data:"))
          if (!eventLine || !dataLine) continue
      
          const eventName = eventLine.replace("event:", "").trim()
          const eventData = JSON.parse(dataLine.replace("data:", "").trim())
      
          // console.log("delta received", eventData.text)
          if (eventName === "delta") {
            assistantText += eventData.text
            streamedTextRef.current = assistantText
          
            flushSync(() => {
              setMessages(prev => {
                const next = [...prev]
                const lastIndex = next.length - 1
                if (lastIndex < 0) return prev
                const last = next[lastIndex]
                if (!last || last.role !== "assistant") return prev
                next[lastIndex] = { role: last.role, content: streamedTextRef.current, sources: last.sources }
                return next
              })
            })
          }        
          
          if (eventName === "sources") {
            streamedSources = eventData.sources
            setCurrentSources(eventData.sources)
          }
          
          if (eventName === "conversation") {
            newConvId = eventData.conversationId
            setConversationId(eventData.conversationId)
            setActiveConvId(eventData.conversationId)
          }
          
          if (eventName === "error") {
            throw new Error(eventData.message || "Backend error")
          }
        }
      }
      
      // Cancel any pending rAF and force-render the final text immediately,
      // so the UI never ends up one delta behind what actually streamed.
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      flushSync(() => {
        setMessages(prev => {
          const next = [...prev]
          const lastIndex = next.length - 1
          const last = next[lastIndex]
          if (!last || last.role !== "assistant") return prev
          next[lastIndex] = { role: last.role, content: assistantText, sources: streamedSources }
          return next
        })
      })     

      // Refresh sidebar + fetch followups
      await fetchConversations()
      if (newConvId) fetchFollowups(newConvId)

    } catch (err) {
      setMessages(prev => prev.slice(0, -1)) // remove empty assistant bubble on error
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleFormSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = query.trim()
    setQuery("")
    handleSubmit(q)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      const q = query.trim()
      setQuery("")
      handleSubmit(q)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="dash-loading">
        <div className="dash-spinner" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="dash-loading">
        <div style={{ textAlign: "center", color: "#6b6b80" }}>
          <p>Please sign in to continue.</p>
          <button className="btn-primary" style={{ marginTop: 16 }} onClick={() => navigate("/auth")}>
            Sign in
          </button>
        </div>
      </div>
    )
  }

  const isEmpty = messages.length === 0

  return (
    <div className="dash-root w-screen">
      {/* ── Sidebar ── */}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <svg width="24" height="24" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="16" fill="#20b8a4" />
              <path d="M10 16c0-3.314 2.686-6 6-6s6 2.686 6 6-2.686 6-6 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="16" cy="16" r="2.5" fill="#fff" />
            </svg>
            <span className="sidebar-logo-label">Perplexity</span>
          </div>
          <button className="icon-btn" onClick={() => setSidebarOpen(false)} title="Close sidebar">
            <IconX />
          </button>
        </div>

        <button className="new-chat-btn" onClick={newConversation}>
          <IconPlus />
          New search
        </button>

        <div className="sidebar-section-label">Recent</div>

        <div className="conv-list">
          {conversations.length === 0 ? (
            <p className="conv-empty">No conversations yet.</p>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                className={`conv-item ${activeConvId === conv.id ? "conv-item-active" : ""}`}
                onClick={() => loadConversation(conv.id)}
              >
                <div className="conv-item-inner">
                  <IconSearch />
                  <div className="conv-item-text">
                    <span className="conv-item-title">{conv.title}</span>
                    <span className="conv-item-meta">
                      <IconClock />
                      {formatRelativeTime(conv.updatedAt)}
                    </span>
                  </div>
                </div>
                <button
                  className="conv-delete-btn"
                  onClick={(e) => deleteConversation(conv.id, e)}
                  title="Delete"
                >
                  <IconTrash />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-avatar">
              {user.email?.[0]?.toUpperCase() ?? "U"}
            </div>
            <span className="sidebar-user-email">{user.email}</span>
          </div>
          <button className="signout-btn" onClick={handleSignOut}>Sign out</button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className={`main-area ${sidebarOpen ? "main-area-with-sidebar" : ""}`}>

        {/* Top bar */}
        <div className="topbar">
          {!sidebarOpen && (
            <button className="icon-btn" onClick={() => setSidebarOpen(true)} title="Open sidebar">
              <IconMenu />
            </button>
          )}
          {!sidebarOpen && (
            <div className="topbar-logo">
              <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="16" fill="#20b8a4" />
                <path d="M10 16c0-3.314 2.686-6 6-6s6 2.686 6 6-2.686 6-6 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="16" cy="16" r="2.5" fill="#fff" />
              </svg>
              <span>Perplexity</span>
            </div>
          )}
          <div style={{ flex: 1 }} />
          {!sidebarOpen && (
            <button className="new-chat-btn-top" onClick={newConversation}>
              <IconPlus /> New
            </button>
          )}
        </div>

        {/* Content */}
        <div className="content-area">
          {isEmpty ? (
            /* ── Home / empty state ── */
            <div className="home-screen">
              <div className="home-hero">
                <div className="home-logo-mark">
                  <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
                    <circle cx="16" cy="16" r="16" fill="#20b8a4" />
                    <path d="M10 16c0-3.314 2.686-6 6-6s6 2.686 6 6-2.686 6-6 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
                    <circle cx="16" cy="16" r="2.5" fill="#fff" />
                  </svg>
                </div>
                <h1 className="home-heading">Where knowledge begins</h1>
                <p className="home-sub">Ask anything. Get answers backed by the web.</p>
              </div>

              {/* Search box */}
              <div className="search-box-wrap">
                <form className="search-box" onSubmit={handleFormSubmit}>
                  <textarea
                    ref={textareaRef}
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask anything…"
                    rows={1}
                    className="search-textarea"
                    disabled={isSubmitting}
                  />
                  <div className="search-box-footer">
                    <span className="search-hint">
                      <IconGlobe /> Web search enabled
                    </span>
                    <button
                      type="submit"
                      className={`search-send-btn ${query.trim() && !isSubmitting ? "active" : ""}`}
                      disabled={!query.trim() || isSubmitting}
                    >
                      <IconSend />
                    </button>
                  </div>
                </form>
              </div>

              {/* Suggestions */}
              <div className="suggestions">
                {["How does quantum computing work?", "Latest in AI research 2025", "Best practices for TypeScript APIs", "Explain React Server Components"].map(s => (
                  <button
                    key={s}
                    className="suggestion-chip"
                    onClick={() => { setQuery(s); textareaRef.current?.focus() }}
                  >
                    <IconSearch />
                    {s}
                    <IconChevronRight />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* ── Chat view ── */
            <div className="chat-layout">
              <div className="chat-main">
              {/* {currentSources.length > 0 && (
                <>
                  <button
                    className="sources-toggle-btn"
                    onClick={() => setSourcesVisible(v => !v)}
                  >
                    <IconGlobe />
                    <span>Sources</span>
                    <span className="sources-count-badge">{currentSources.length}</span>
                    <span className={`chevron-icon ${sourcesVisible ? "chevron-open" : ""}`}>
                      <IconChevronRight />
                    </span>
                  </button>

                  {sourcesVisible && (
                    <div className="sources-grid">
                      {currentSources.map((s, i) => (
                        <a
                          key={i}
                          href={s.url || s.link || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="source-grid-card"
                        >
                          <div className="source-grid-header">
                            <img
                              src={getFavicon(s.url || s.link || "")}
                              alt=""
                              width="14"
                              height="14"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                            />
                            <span className="source-grid-domain">{getDomain(s.url || s.link || s.title || "")}</span>
                            <span className="source-grid-idx">{i + 1}</span>
                          </div>
                          <p className="source-grid-title">{s.title || "Source"}</p>
                        </a>
                      ))}
                    </div>
                  )}
                </>
              )} */}
              
                <div className="messages-list">
                  {messages.map((msg, idx) => (
                    <div key={idx} className={`message-block message-${msg.role}`}>
                      {msg.role === "user" ? (
                        <div className="user-bubble">{msg.content}</div>
                      ) : (
                        <div className="assistant-block">
                          <div className="assistant-label">
                            <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
                              <circle cx="16" cy="16" r="16" fill="#20b8a4" />
                              <path d="M10 16c0-3.314 2.686-6 6-6s6 2.686 6 6-2.686 6-6 6" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
                              <circle cx="16" cy="16" r="2.5" fill="#fff" />
                            </svg>
                            <span>Perplexity</span>
                            {idx === messages.length - 1 && isSubmitting && (
                              <span className="streaming-dot" />
                            )}
                          </div>

                          {/* Inline sources (small chips) */}
                          {msg.sources && msg.sources.length > 0 && (
                            <div className="inline-sources">
                              {msg.sources.slice(0, 4).map((s, si) => (
                                <a
                                  key={si}
                                  href={s.url || s.link || "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="source-chip"
                                >
                                  <img
                                    src={getFavicon(s.url || s.link || "")}
                                    alt=""
                                    width="12"
                                    height="12"
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
                                  />
                                  <span>{getDomain(s.url || s.link || s.title || "")}</span>
                                </a>
                              ))}
                              {msg.sources.length > 4 && (
                                <span className="source-chip source-chip-more">+{msg.sources.length - 4} more</span>
                              )}
                            </div>
                          )}

                          <div className="assistant-content">
                            {msg.content ? (
                              <div className="assistant-text">{renderRichContent(msg.content, msg.sources)}</div>
                            ) : (
                              <div className="skeleton-lines">
                                <div className="skeleton-line" style={{ width: "85%" }} />
                                <div className="skeleton-line" style={{ width: "70%" }} />
                                <div className="skeleton-line" style={{ width: "90%" }} />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Follow-up suggestions */}
                  {!isSubmitting && followups.length > 0 && (
                    <div className="followup-section">
                      <p className="followup-label">Related</p>
                      <div className="followup-list">
                        {followups.map((f, i) => (
                          <button
                            key={i}
                            className="followup-btn"
                            onClick={() => handleSubmit(f)}
                          >
                            <IconSearch />
                            {f}
                            <span style={{ marginLeft: "auto" }}><IconChevronRight /></span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {loadingFollowups && !isSubmitting && (
                    <div className="followup-section">
                      <div className="skeleton-line" style={{ width: "40%", height: "10px" }} />
                    </div>
                  )}

                  <div ref={bottomRef} />
                </div>

                {/* Error */}
                {error && (
                  <div className="chat-error">{error}</div>
                )}

                {/* Input */}
                <div className="chat-input-wrap">
                  <form className="chat-input-box" onSubmit={handleFormSubmit}>
                    <textarea
                      ref={textareaRef}
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ask a follow-up…"
                      rows={1}
                      className="chat-textarea"
                      disabled={isSubmitting}
                    />
                    <div className="chat-input-footer">
                      <span className="search-hint">
                        <IconGlobe /> Web search
                      </span>
                      <button
                        type="submit"
                        className={`search-send-btn ${query.trim() && !isSubmitting ? "active" : ""}`}
                        disabled={!query.trim() || isSubmitting}
                      >
                        <IconSend />
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              {currentSources.length > 0 && (
                <aside className="sources-panel">
                  {/* <p className="sources-panel-heading">Sources</p> */}
                  <button
                    className="sources-toggle-btn"
                    onClick={() => setSourcesVisible(v => !v)}
                  >
                    <IconGlobe />
                    <span>Sources</span>

                    <span className="sources-count-badge">
                      {currentSources.length}
                    </span>

                    <span
                      className={`chevron-icon ${
                        sourcesVisible ? "chevron-open" : ""
                      }`}
                    >
                      <IconChevronRight />
                    </span>
                  </button>
                  {sourcesVisible && (
                    <div className="sources-panel-list">
                      {currentSources.map((s, i) => (
                        <a
                          key={i}
                          href={s.url || s.link || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="sources-panel-card"
                        >
                          <div className="sources-panel-card-header">
                            <img
                              src={getFavicon(s.url || s.link || "")}
                              alt=""
                              width="14"
                              height="14"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none"
                              }}
                            />

                            <span className="sources-panel-domain">
                              {getDomain(s.url || s.link || s.title || "")}
                            </span>

                            <span className="sources-panel-idx">
                              {i + 1}
                            </span>
                          </div>

                          <p className="sources-panel-title">
                            {s.title || "Source"}
                          </p>

                          {s.content && (
                            <p className="sources-panel-snippet">
                              {s.content.slice(0, 100)}…
                            </p>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                </aside>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; }

        .dash-root {
          display: flex;
          height: 100vh;
          background: #0a0a0f;
          font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
          color: #e8e8f0;
          overflow: hidden;
        }

        /* ── Sidebar ── */
        .sidebar {
          width: 260px;
          flex-shrink: 0;
          background: #0e0e16;
          border-right: 1px solid #1a1a28;
          display: flex;
          flex-direction: column;
          transition: width 0.2s ease, opacity 0.2s;
          overflow: hidden;
        }
        .sidebar-closed { width: 0; opacity: 0; pointer-events: none; }
        .sidebar-open { width: 260px; opacity: 1; }

        .sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 14px 12px;
          border-bottom: 1px solid #1a1a28;
        }
        .sidebar-logo {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sidebar-logo-label {
          font-size: 15px;
          font-weight: 600;
          color: #e8e8f0;
          letter-spacing: -0.3px;
          white-space: nowrap;
        }
        .new-chat-btn {
          margin: 12px 10px 4px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 14px;
          background: #20b8a4;
          color: #fff;
          border: none;
          border-radius: 9px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s;
          white-space: nowrap;
        }
        .new-chat-btn:hover { background: #1da898; }

        .sidebar-section-label {
          padding: 16px 14px 6px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #44445a;
          white-space: nowrap;
        }

        .conv-list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 6px;
          scrollbar-width: thin;
          scrollbar-color: #1e1e2e transparent;
        }
        .conv-empty {
          padding: 12px 8px;
          font-size: 12px;
          color: #44445a;
        }
        .conv-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 8px 8px 10px;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.12s;
          gap: 4px;
        }
        .conv-item:hover { background: #14141f; }
        .conv-item-active { background: #16162a; }
        .conv-item-inner {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          flex: 1;
          min-width: 0;
          color: #7070a0;
          padding-top: 1px;
        }
        .conv-item-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .conv-item-title {
          font-size: 12.5px;
          color: #b0b0c8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 160px;
        }
        .conv-item-meta {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          color: #44445a;
        }
        .conv-delete-btn {
          opacity: 0;
          background: none;
          border: none;
          color: #44445a;
          cursor: pointer;
          padding: 4px;
          border-radius: 5px;
          transition: opacity 0.12s, background 0.12s, color 0.12s;
          flex-shrink: 0;
        }
        .conv-item:hover .conv-delete-btn { opacity: 1; }
        .conv-delete-btn:hover { background: rgba(239,68,68,0.12); color: #f87171; }

        .sidebar-footer {
          padding: 12px 10px;
          border-top: 1px solid #1a1a28;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .sidebar-user {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sidebar-avatar {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #20b8a4;
          color: #fff;
          font-size: 12px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .sidebar-user-email {
          font-size: 11.5px;
          color: #6b6b80;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 160px;
        }
        .signout-btn {
          width: 100%;
          padding: 7px;
          background: none;
          border: 1px solid #1e1e2e;
          border-radius: 7px;
          font-size: 12px;
          color: #6b6b80;
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }
        .signout-btn:hover { background: #14141f; color: #e8e8f0; }

        /* ── Main area ── */
        .main-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          height: 100vh;
          overflow: hidden;
        }

        .topbar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 16px;
          border-bottom: 1px solid #1a1a28;
          background: #0a0a0f;
          height: 52px;
          flex-shrink: 0;
        }
        .topbar-logo {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 600;
          color: #e8e8f0;
        }
        .new-chat-btn-top {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: #20b8a4;
          color: #fff;
          border: none;
          border-radius: 7px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s;
        }
        .new-chat-btn-top:hover { background: #1da898; }

        .icon-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          background: none;
          border: none;
          border-radius: 7px;
          color: #6b6b80;
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }
        .icon-btn:hover { background: #14141f; color: #e8e8f0; }

        .content-area {
          flex: 1;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: #1e1e2e transparent;
        }

        /* ── Home screen ── */
        .home-screen {
          max-width: 700px;
          margin: 0 auto;
          padding: 64px 24px 40px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 32px;
        }
        .home-hero {
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .home-logo-mark {
          margin-bottom: 4px;
        }
        .home-heading {
          font-size: 32px;
          font-weight: 700;
          color: #e8e8f0;
          letter-spacing: -0.8px;
          margin: 0;
          line-height: 1.2;
        }
        .home-sub {
          font-size: 15px;
          color: #6b6b80;
          margin: 0;
        }

        .search-box-wrap {
          width: 100%;
          max-width: 680px;
        }
        .search-box {
          background: #111118;
          border: 1px solid #1e1e2e;
          border-radius: 16px;
          padding: 16px 16px 12px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .search-box:focus-within {
          border-color: #20b8a4;
          box-shadow: 0 0 0 3px rgba(32, 184, 164, 0.12);
        }
        .search-textarea {
          width: 100%;
          background: none;
          border: none;
          outline: none;
          color: #e8e8f0;
          font-size: 15px;
          font-family: inherit;
          resize: none;
          line-height: 1.6;
          min-height: 28px;
          max-height: 200px;
        }
        .search-textarea::placeholder { color: #44445a; }

        .search-box-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 8px;
        }
        .search-hint {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: #44445a;
        }
        .search-send-btn {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: none;
          background: #1e1e2e;
          color: #44445a;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s, color 0.15s;
        }
        .search-send-btn.active {
          background: #20b8a4;
          color: #fff;
        }
        .search-send-btn.active:hover { background: #1da898; }

        .suggestions {
          width: 100%;
          max-width: 680px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .suggestion-chip {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 11px 14px;
          background: #111118;
          border: 1px solid #1a1a28;
          border-radius: 10px;
          color: #9090b0;
          font-size: 13px;
          cursor: pointer;
          transition: background 0.12s, border-color 0.12s, color 0.12s;
          text-align: left;
        }
        .suggestion-chip:hover {
          background: #14141f;
          border-color: #20b8a4;
          color: #e8e8f0;
        }
        .suggestion-chip svg:last-child { margin-left: auto; opacity: 0.4; }

        /* ── Chat view ── */
        .messages-list {
          flex: 1;
          padding: 28px 0 16px;
          display: flex;
          flex-direction: column;
          gap: 28px;
        }

        .message-user .user-bubble {
          font-size: 22px;
          font-weight: 600;
          color: #e8e8f0;
          letter-spacing: -0.4px;
          line-height: 1.35;
        }

        .assistant-block {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .assistant-label {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 13px;
          font-weight: 500;
          color: #20b8a4;
        }
        .streaming-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #20b8a4;
          animation: pulse 1s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }

        .inline-sources {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .source-chip {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 9px;
          background: #111118;
          border: 1px solid #1e1e2e;
          border-radius: 20px;
          font-size: 11px;
          color: #6b6b80;
          text-decoration: none;
          transition: border-color 0.12s, color 0.12s;
          white-space: nowrap;
        }
        .source-chip:hover { border-color: #20b8a4; color: #20b8a4; }
        .source-chip-more { cursor: default; }
        .source-chip-more:hover { border-color: #1e1e2e; color: #6b6b80; }

        .assistant-content {}
        .assistant-text {
          font-size: 15px;
          line-height: 1.75;
          color: #c8c8e0;
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .inline-code {
          font-family: 'SF Mono', 'Fira Code', monospace;
          font-size: 12.5px;
          background: #1a1a28;
          color: #20b8a4;
          padding: 1px 5px;
          border-radius: 4px;
        }

        .skeleton-lines { display: flex; flex-direction: column; gap: 10px; }
        .skeleton-line {
          height: 14px;
          background: linear-gradient(90deg, #1a1a28 25%, #20203a 50%, #1a1a28 75%);
          background-size: 200% 100%;
          border-radius: 4px;
          animation: shimmer 1.5s infinite;
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }

        .followup-section {
          border-top: 1px solid #1a1a28;
          padding-top: 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .followup-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #44445a;
          margin: 0 0 4px;
        }
        .followup-list { display: flex; flex-direction: column; gap: 4px; }
        .followup-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          background: none;
          border: 1px solid #1a1a28;
          border-radius: 9px;
          color: #9090b0;
          font-size: 13px;
          cursor: pointer;
          text-align: left;
          transition: background 0.12s, border-color 0.12s, color 0.12s;
        }
        .followup-btn:hover {
          background: #111118;
          border-color: #20b8a4;
          color: #e8e8f0;
        }
        .followup-btn svg { flex-shrink: 0; color: #44445a; }

        /* Chat input */
        .chat-input-wrap {
          position: sticky;
          bottom: 0;
          padding: 16px 0 0;
          background: linear-gradient(to top, #0a0a0f 70%, transparent);
        }
        .chat-input-box {
          background: #111118;
          border: 1px solid #1e1e2e;
          border-radius: 14px;
          padding: 14px 14px 10px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .chat-input-box:focus-within {
          border-color: #20b8a4;
          box-shadow: 0 0 0 3px rgba(32, 184, 164, 0.1);
        }
        .chat-textarea {
          width: 100%;
          background: none;
          border: none;
          outline: none;
          color: #e8e8f0;
          font-size: 14px;
          font-family: inherit;
          resize: none;
          line-height: 1.6;
          min-height: 24px;
          max-height: 160px;
        }
        .chat-textarea::placeholder { color: #44445a; }
        .chat-input-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 6px;
        }

        .chat-error {
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.18);
          color: #fca5a5;
          font-size: 13px;
          padding: 10px 14px;
          border-radius: 9px;
          margin-bottom: 12px;
        }

        /* ── Loading state ── */
        .dash-loading {
          height: 100vh;
          background: #0a0a0f;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .dash-spinner {
          width: 28px;
          height: 28px;
          border: 2px solid #1e1e2e;
          border-top-color: #20b8a4;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Responsive ── */

        .btn-primary {
          padding: 10px 20px;
          background: #20b8a4;
          color: #fff;
          border: none;
          border-radius: 9px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }
      `}</style>
    </div>
  )
}

export default Dashboard