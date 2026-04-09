import { fetchAuthSession } from "aws-amplify/auth";

let refreshTimer = null;

const scheduleTokenRefresh = (accessToken) => {
  if (refreshTimer) clearTimeout(refreshTimer);

  try {
    const exp = accessToken?.payload?.exp;
    if (!exp) return;

    // Refresh 5 minutes before expiry
    const msUntilRefresh = exp * 1000 - Date.now() - 5 * 60 * 1000;
    if (msUntilRefresh <= 0) return;

    refreshTimer = setTimeout(async () => {
      try {
        await fetchAuthSession({ forceRefresh: true });
      } catch (err) {
        console.warn("Proactive token refresh failed:", err);
      }
    }, msUntilRefresh);
  } catch {
    // Ignore parse errors — worst case we just don't pre-refresh
  }
};

export const getAuthToken = async () => {
  try {
    const session = await fetchAuthSession();
    const accessToken = session.tokens?.accessToken;
    scheduleTokenRefresh(accessToken);
    return accessToken?.toString();
  } catch (error) {
    console.error("Failed to get auth token:", error);
    throw new Error("Authentication required");
  }
};

export const checkForInterruptInTurn = (turn) => {
  if (!turn || !turn.aiMessage || !Array.isArray(turn.aiMessage)) {
    return null;
  }

  return turn.aiMessage.find((message) => message.type === "interrupt");
};

export const checkForInterruptInChatTurns = (chatTurns) => {
  if (!chatTurns || chatTurns.length === 0) {
    return null;
  }

  const lastTurn = chatTurns[chatTurns.length - 1];
  return checkForInterruptInTurn(lastTurn);
};
