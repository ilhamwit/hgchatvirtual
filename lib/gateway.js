// The only code that talks to the OpenClaw gateway (EPIC-002). The browser
// never reaches the gateway: it calls /api/..., and this module adds the
// operator token server-side.
const DEFAULT_URL = 'http://127.0.0.1:18789';
const TIMEOUT_MS = 240000; // tool-using agents can take minutes — but never forever

class GatewayError extends Error {
  constructor(message, { stopped = false, timedOut = false } = {}) {
    super(message);
    this.stopped = stopped;
    this.timedOut = timedOut;
  }
}

// Each conversation gets its own OpenClaw session, derived by the gateway from
// the OpenAI `user` field.
const sessionUser = (conversationId) => 'hgchat:' + conversationId;

function createGateway({ url = DEFAULT_URL, token, timeoutMs = TIMEOUT_MS } = {}) {
  async function ask({ agentId, conversationId, text, signal }) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res;
    try {
      res = await fetch(url + '/v1/chat/completions', {
        method: 'POST',
        signal: combined,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {})
        },
        body: JSON.stringify({
          model: 'openclaw/' + agentId,
          user: sessionUser(conversationId),
          messages: [{ role: 'user', content: text }]
        })
      });
    } catch (err) {
      if (signal && signal.aborted) throw new GatewayError('Dihentikan.', { stopped: true });
      if (timeout.aborted) {
        throw new GatewayError(`Tidak ada respons dalam ${Math.round(timeoutMs / 60000)} menit — permintaan dihentikan.`, { timedOut: true });
      }
      throw new GatewayError('Gateway OpenClaw tidak bisa dihubungi (' + (err.cause?.code || err.message) + ').');
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      const e = data && data.error;
      const detail = typeof e === 'string' ? e : (e && e.message) || '';
      throw new GatewayError('Gateway error ' + res.status + (detail ? ' — ' + detail : ''));
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new GatewayError('Respons kosong dari gateway.');
    return content;
  }

  return { ask };
}

module.exports = { createGateway, GatewayError, sessionUser, DEFAULT_URL };
