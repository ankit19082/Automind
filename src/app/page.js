"use client";

import { useEffect, useState } from "react";

export default function Dashboard() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/tasks/list");
      const data = await res.json();
      if (data.tasks) {
        setTasks(data.tasks);
      }
    } catch (e) {
      console.error("Failed to fetch tasks", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 2000); // Polling every 2s
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800 border-green-200";
      case "failed":
        return "bg-red-100 text-red-800 border-red-200";
      case "active":
      case "running":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "waiting":
      case "delayed":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-center bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              AutoMind Dashboard
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              View and monitor your autonomous agent requests in real-time.
            </p>
          </div>
          <div className="mt-4 sm:mt-0 flex items-center space-x-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            <span className="text-sm font-medium text-gray-600">
              System Online
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white shadow-xl shadow-gray-200/50 rounded-3xl overflow-hidden border border-gray-100">
          <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50">
            <h3 className="text-base font-semibold leading-6 text-gray-900">
              Recent Tasks
            </h3>
          </div>

          {loading && tasks.length === 0 ? (
            <div className="p-12 flex justify-center items-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : tasks.length === 0 ? (
            <div className="p-16 text-center text-gray-500">
              <svg
                className="mx-auto h-12 w-12 text-gray-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              <h3 className="mt-4 text-sm font-medium text-gray-900">
                No tasks found
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Run the 'automind task' command via CLI to start a new job.
              </p>
            </div>
          ) : (
            <ul role="list" className="divide-y divide-gray-100">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="p-6 hover:bg-gray-50/80 transition-colors duration-150 ease-in-out"
                >
                  <div className="flex items-center justify-between gap-x-6">
                    <div className="min-w-0 flex-auto">
                      <div className="flex items-start gap-x-3">
                        <p className="text-sm font-semibold leading-6 text-gray-900 line-clamp-2">
                          {task.prompt}
                        </p>
                        <p
                          className={`rounded-xl px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${getStatusColor(task.status)} capitalize whitespace-nowrap`}
                        >
                          {task.status}
                        </p>
                      </div>
                      <div className="mt-2 flex items-center gap-x-2 text-xs leading-5 text-gray-500">
                        <p className="whitespace-nowrap">
                          ID:{" "}
                          <span className="font-mono bg-gray-100 px-1 py-0.5 rounded">
                            {task.id}
                          </span>
                        </p>
                        <svg
                          viewBox="0 0 2 2"
                          className="h-0.5 w-0.5 fill-current"
                        >
                          <circle cx="1" cy="1" r="1" />
                        </svg>
                        <p className="truncate">
                          Started at {new Date(task.createdAt).toLocaleString()}
                        </p>
                      </div>

                      {task.status === "failed" && task.failedReason && (
                        <div className="mt-3 text-sm text-red-600 bg-red-50/50 p-4 rounded-xl border border-red-100 font-mono whitespace-pre-wrap">
                          <strong>Error:</strong> {task.failedReason}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
