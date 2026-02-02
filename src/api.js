const parseJson = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const apiFetch = async (path, options = {}) => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(`/api${normalized}`, {
    headers: {
      accept: "application/json",
      ...(options.headers ?? {})
    },
    ...options
  });

  const payload = await parseJson(response);
  if (!response.ok) {
    const message = payload?.error || payload?.message || response.statusText;
    const error = new Error(message || "Request failed");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload ?? {};
};

export const getLeaderboard = () => apiFetch("/leaderboard");

export const getPortfolio = (agentId) =>
  apiFetch(`/portfolio/${encodeURIComponent(agentId)}`);

export const getPortfolioAnalytics = (agentId) =>
  apiFetch(`/v1/portfolio/${encodeURIComponent(agentId)}/analytics`);

export const getPendingAgent = (token) =>
  apiFetch(`/v1/pending/${encodeURIComponent(token)}`);

export const registerAgentApi = (agentName) =>
  apiFetch("/v1/register", {
    method: "POST",
    body: JSON.stringify({ agent_name: agentName })
  });

export const verifyAgent = (token, tweetUrl) =>
  apiFetch(`/v1/verify/${encodeURIComponent(token)}`, {
    method: "POST",
    body: JSON.stringify({ tweet_url: tweetUrl })
  });

export const claimAgent = (claimToken) =>
  apiFetch("/v1/claim", {
    method: "POST",
    body: JSON.stringify({ claim_token: claimToken })
  });

export const rotateApiKey = (agentId) =>
  apiFetch(`/v1/agents/${encodeURIComponent(agentId)}/api-key/rotate`, {
    method: "POST"
  });

export const getRefillRequest = (token) =>
  apiFetch(`/v1/refill/${encodeURIComponent(token)}`);

export const verifyRefill = (token, tweetUrl) =>
  apiFetch(`/v1/refill/${encodeURIComponent(token)}`, {
    method: "POST",
    body: JSON.stringify({ tweet_url: tweetUrl })
  });
