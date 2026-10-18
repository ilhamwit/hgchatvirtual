// The only code that talks to the agents' backend: the Hermes Agent API
// server (EPIC-007, replacing the OpenClaw gateway). The browser never
// reaches Hermes: it calls /api/..., and this module adds the key server-side.
//
// Hermes runs every agent as a profile behind one listener; a profile is
// addressed by the /p/<profile>/ prefix and accepts only its own
// API_SERVER_KEY (~/.hermes/profiles/<profile>/.env).
const DEFAULT_URL = 'http://127.0.0.1:8642';
const TIMEOUT_MS = 240000; // tool-using agents can take minutes — but never forever

class GatewayError extends Error {
  constructor(message, { stopped = false, timedOut = false } = {}) {
    super(message);
    this.stopped = stopped;
    this.timedOut = timedOut;
  }
}

// Each conversation is its own Hermes session. With X-Hermes-Session-Id the
// transcript lives in Hermes, so a turn sends only the new message.
const sessionId = (conversationId) => 'hgchat-' + conversationId;

function createGateway({ url = DEFAULT_URL, key, timeoutMs = TIMEOUT_MS } = {}) {
  async function ask({ agentId, conversationId, text, signal }) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res;
    try {
      res = await fetch(`${url}/p/${encodeURIComponent(agentId)}/v1/chat/completions`, {
        method: 'POST',
        signal: combined,
        headers: {
          'Content-Type': 'application/json',
          'X-Hermes-Session-Id': sessionId(conversationId),
          ...(key ? { Authorization: 'Bearer ' + key } : {})
        },
        body: JSON.stringify({ model: agentId, messages: [{ role: 'user', content: text }] })
      });
    } catch (err) {
      if (signal && signal.aborted) throw new GatewayError('Dihentikan.', { stopped: true });
      if (timeout.aborted) {
        throw new GatewayError(`Tidak ada respons dalam ${Math.round(timeoutMs / 60000)} menit — permintaan dihentikan.`, { timedOut: true });
      }
      throw new GatewayError('Hermes tidak bisa dihubungi (' + (err.cause?.code || err.cause?.message || err.message) + ').');
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      const e = data && data.error;
      const detail = typeof e === 'string' ? e : (e && (e.message || e.code)) || '';
      throw new GatewayError('Hermes error ' + res.status + (detail ? ' — ' + detail : ''));
    }
    const choice = data?.choices?.[0];
    // Hermes reports interrupted and failed turns in finish_reason, not the status.
    if (choice?.finish_reason === 'cancelled') throw new GatewayError('Dibatalkan oleh Hermes.');
    if (choice?.finish_reason === 'error') {
      throw new GatewayError('Hermes gagal menjalankan giliran ini' + (choice.message?.content ? ': ' + choice.message.content : '.'));
    }
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new GatewayError('Respons kosong dari Hermes.');
    return content;
  }

  return { ask };
}

module.exports = { createGateway, GatewayError, sessionId, DEFAULT_URL };
