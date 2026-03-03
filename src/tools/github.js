export const fetchCommitsSchema = {
  name: "fetch_commits",
  description: "Fetches recent commits from GitHub for a given repository.",
  parameters: {
    type: "object",
    properties: {
      repo: {
        type: "string",
        description: "Repository name (e.g., owner/repo)",
      },
    },
    required: ["repo"],
  },
};

export const fetchCommits = async ({ repo }) => {
  return [
    {
      message: "feat: add BullMQ queue integration",
      hash: "a1b2c3d",
      author: "Agent",
    },
    {
      message: "fix: resolve SSE heartbeat issue",
      hash: "e4f5g6h",
      author: "Agent",
    },
  ];
};
