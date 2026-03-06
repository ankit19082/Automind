"use client";

import { useEffect, useState, useRef } from "react";

export default function Dashboard() {
  const [tasks, setTasks] = useState([]);
  const [jiraTickets, setJiraTickets] = useState([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [loadingJira, setLoadingJira] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const [logs, setLogs] = useState({});
  const logEndRef = useRef(null);

  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/tasks/list");
      const data = await res.json();
      if (data.tasks) {
        setTasks(data.tasks);
        // Find first active job to show logs
        const activeJob = data.tasks.find(
          (t) => t.status === "active" || t.status === "running",
        );
        if (activeJob && !activeJobId) {
          setActiveJobId(activeJob.id);
        }
      }
    } catch (e) {
      console.error("Failed to fetch tasks", e);
    } finally {
      setLoadingTasks(false);
    }
  };

  const fetchJiraTickets = async () => {
    setLoadingJira(true);
    try {
      const res = await fetch("/api/jira/assigned");
      const data = await res.json();
      if (data.tickets) {
        setJiraTickets(data.tickets);
      }
    } catch (e) {
      console.error("Failed to fetch JIRA tickets", e);
    } finally {
      setLoadingJira(false);
    }
  };

  const updateJiraStatus = async (ticketId, status) => {
    try {
      const res = await fetch("/api/jira/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          status,
          comment: "Updated via AutoMind Dashboard",
        }),
      });
      if (res.ok) {
        fetchJiraTickets();
      }
    } catch (e) {
      console.error("Failed to update JIRA status", e);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchJiraTickets();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!activeJobId) return;

    const eventSource = new EventSource(`/api/logs?jobId=${activeJobId}`);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setLogs((prev) => ({
        ...prev,
        [activeJobId]: [...(prev[activeJobId] || []), data],
      }));
    };

    return () => eventSource.close();
  }, [activeJobId]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, activeJobId]);

  const getStatusColor = (status) => {
    switch (status) {
      case "completed":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "failed":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      case "active":
      case "running":
        return "bg-sky-500/10 text-sky-400 border-sky-500/20 animate-pulse";
      case "waiting":
      case "delayed":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20";
      default:
        return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 py-8 px-4 sm:px-6 lg:px-8 font-sans selection:bg-sky-500/30">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Navigation / Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center bg-slate-800/50 backdrop-blur-xl p-6 rounded-3xl border border-slate-700/50 shadow-2xl">
          <div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 bg-gradient-to-br from-sky-400 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/20">
                <svg
                  className="w-6 h-6 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                AutoMind OS
              </h1>
            </div>
            <p className="mt-1 text-slate-400 text-sm">
              Autonomous Agent Management System v1.0
            </p>
          </div>
          <div className="mt-4 md:mt-0 flex gap-4">
            <button
              onClick={fetchJiraTickets}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-sm font-medium rounded-xl border border-slate-600 transition-all flex items-center gap-2 group"
            >
              <svg
                className={`w-4 h-4 ${loadingJira ? "animate-spin" : "group-hover:rotate-180 transition-transform"}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Fetch JIRA Tasks
            </button>
            <div className="flex items-center gap-2 bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-bold text-emerald-400">
                CORE ONLINE
              </span>
            </div>
          </div>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
          {/* Left Column: Tasks & JIRA */}
          <div className="lg:col-span-4 space-y-8">
            {/* JIRA Tasks Section */}
            <section className="bg-slate-800/40 border border-slate-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
              <div className="px-6 py-4 bg-slate-800/60 border-b border-slate-700/50 flex justify-between items-center">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                  Assigned JIRA Tickets
                </h2>
                <span className="text-xs bg-sky-500/20 text-sky-400 px-2 py-0.5 rounded-full border border-sky-500/20">
                  {jiraTickets.length}
                </span>
              </div>
              <div className="max-h-[300px] overflow-y-auto p-2 space-y-2 custom-scrollbar">
                {loadingJira ? (
                  <div className="p-8 text-center">
                    <div className="animate-pulse text-slate-500 text-sm">
                      Synchronizing JIRA...
                    </div>
                  </div>
                ) : jiraTickets.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-sm">
                    No active tickets found.
                  </div>
                ) : (
                  jiraTickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="p-4 bg-slate-900/40 rounded-2xl border border-slate-700/30 hover:border-sky-500/50 transition-all group"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-mono text-sky-400">
                          {ticket.id}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-700 rounded-md uppercase">
                          {ticket.status}
                        </span>
                      </div>
                      <h3 className="text-sm font-medium mb-3 line-clamp-1 group-hover:text-white transition-colors">
                        {ticket.title}
                      </h3>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            updateJiraStatus(ticket.id, "In Progress")
                          }
                          className="flex-1 py-1.5 bg-sky-500/10 hover:bg-sky-500 text-sky-400 hover:text-white text-[10px] font-bold rounded-lg border border-sky-500/30 transition-all"
                        >
                          START
                        </button>
                        <button
                          onClick={() =>
                            updateJiraStatus(ticket.id, "Human-Review")
                          }
                          className="flex-1 py-1.5 bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-white text-[10px] font-bold rounded-lg border border-emerald-500/30 transition-all"
                        >
                          REVIEW
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* Recent Agent Tasks */}
            <section className="bg-slate-800/40 border border-slate-700/50 rounded-3xl overflow-hidden backdrop-blur-sm">
              <div className="px-6 py-4 bg-slate-800/60 border-b border-slate-700/50 flex justify-between items-center">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
                  Agent Queue
                </h2>
              </div>
              <div className="max-h-[400px] overflow-y-auto p-2 space-y-2 custom-scrollbar">
                {tasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => setActiveJobId(task.id)}
                    className={`w-full text-left p-4 rounded-2xl border transition-all ${activeJobId === task.id ? "bg-sky-500/10 border-sky-500/50 shadow-lg shadow-sky-500/5" : "bg-slate-900/40 border-slate-700/30 hover:border-slate-500/50"}`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getStatusColor(task.status)} uppercase`}
                      >
                        {task.status}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(task.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm font-medium line-clamp-1">
                      {task.prompt}
                    </p>
                  </button>
                ))}
              </div>
            </section>
          </div>

          {/* Right Column: Terminal Output */}
          <div className="lg:col-span-8 flex flex-col h-full min-h-[600px]">
            <section className="flex-1 bg-slate-950/80 border border-slate-700/50 rounded-[2rem] shadow-2xl flex flex-col overflow-hidden">
              <div className="px-6 py-4 bg-slate-900/80 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-rose-500/50"></div>
                    <div className="w-3 h-3 rounded-full bg-amber-500/50"></div>
                    <div className="w-3 h-3 rounded-full bg-emerald-500/50"></div>
                  </div>
                  <span className="ml-4 text-xs font-mono text-slate-500">
                    terminal &mdash; {activeJobId || "no active job"}
                  </span>
                </div>
                {activeJobId && (
                  <div className="text-xs bg-slate-800 text-slate-400 px-3 py-1 rounded-lg font-mono border border-slate-700">
                    job_id: {activeJobId}
                  </div>
                )}
              </div>
              <div className="flex-1 p-6 font-mono text-sm overflow-y-auto custom-scrollbar bg-[radial-gradient(circle_at_top_right,_#1e293b_0%,_transparent_100%)]">
                {activeJobId ? (
                  <div className="space-y-1.5">
                    {logs[activeJobId]?.map((log, i) => (
                      <div key={i} className="flex gap-4 group">
                        <span className="text-slate-600 shrink-0 select-none">
                          [{new Date(log.timestamp).toLocaleTimeString()}]
                        </span>
                        <span
                          className={`
                          ${log.msg.includes("Task completed") ? "text-emerald-400 font-bold" : ""}
                          ${log.msg.includes("Error") ? "text-rose-400" : ""}
                          ${log.msg.includes("Thinking") ? "text-sky-400 italic" : ""}
                          ${log.msg.includes("Calling tool") ? "text-amber-400" : "text-slate-300"}
                         tracking-tight`}
                        >
                          {log.msg}
                        </span>
                      </div>
                    ))}
                    {(!logs[activeJobId] || logs[activeJobId].length === 0) && (
                      <div className="text-slate-500 animate-pulse">
                        Establishing connection to agent logs...
                      </div>
                    )}
                    <div ref={logEndRef} />
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-4">
                    <svg
                      className="w-16 h-16 opacity-20"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1}
                        d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 00-2 2z"
                      />
                    </svg>
                    <p className="text-sm font-medium">
                      Select a task from the queue to view real-time logs
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
      `}</style>
    </div>
  );
}
