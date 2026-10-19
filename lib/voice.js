// Voice mode (EPIC-016): a call with an agent over LiveKit. Chat Center only
// mints the room token and keeps the transcript; audio, speech-to-text and
// the voice itself run in deploy/voice (worker "hg-voice"), whose brain is the
// agent's Hermes profile with this conversation's session id.
//
// Configured by CHAT_VOICE_LIVEKIT_URL (public wss://…), CHAT_VOICE_LIVEKIT_KEY
// / _SECRET (the LiveKit API key pair) and CHAT_VOICE_WORKER_KEY (what the
// worker sends when it writes transcript turns). Without them voice is off
// and the chat works as before.
const crypto = require('crypto');
const conv = require('./conversations');

const TOKEN_TTL_S = 60 * 60;
const AGENT_NAME = process.env.CHAT_VOICE_AGENT_NAME || 'hg-voice';
const DEFAULT_VOICES = { dave: 'male_young', jaden: 'female_assistant', joel: 'male_news', dylan: 'male_teen', nana: 'female_cs' };

const httpError = (status, msg) => Object.assign(new Error(msg), { status });
const b64 = (s) => Buffer.from(s).toString('base64url');

// A LiveKit access token: HS256 JWT with the video grant and the agent dispatch.
function mintToken({ key, secret, identity, name, room, metadata, ttlSec = TOKEN_TTL_S, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const payload = {
    iss: key, sub: identity, name, iat, nbf: iat - 10, exp: iat + ttlSec, jti: crypto.randomUUID(),
    metadata: JSON.stringify(metadata),
    video: { roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true, canUpdateOwnMetadata: false },
    roomConfig: { agents: [{ agentName: AGENT_NAME, metadata: JSON.stringify(metadata) }] }
  };
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + sig;
}

// "dave:male_young,nana:female_cs" -> {dave:'male_young', …}
function parseVoices(raw) {
  const out = { ...DEFAULT_VOICES };
  for (const part of String(raw || '').split(',')) {
    const [id, v] = part.split(':').map((x) => (x || '').trim());
    if (id && v) out[id] = v;
  }
  return out;
}

function createVoice({ db, agents = [], env = process.env, now = () => Date.now() }) {
  const url = env.CHAT_VOICE_LIVEKIT_URL || '';
  const key = env.CHAT_VOICE_LIVEKIT_KEY || '';
  const secret = env.CHAT_VOICE_LIVEKIT_SECRET || '';
  const workerKey = env.CHAT_VOICE_WORKER_KEY || '';
  const httpUrl = env.CHAT_VOICE_LIVEKIT_HTTP || '';
  const voices = parseVoices(env.CHAT_VOICE_PROFILES);
  const enabled = !!(url && key && secret);

  async function status() {
    const out = { enabled, url: enabled ? url : null, livekit: null };
    if (enabled && httpUrl) {
      try { const r = await fetch(httpUrl + '/', { signal: AbortSignal.timeout(2000) }); out.livekit = r.ok ? 'ok' : 'error'; }
      catch (e) { out.livekit = 'unreachable'; }
    }
    return out;
  }

  // Starts a call: a fresh conversation with the agent plus a room token.
  function startSession(user, agentId) {
    if (!enabled) throw httpError(503, 'mode suara belum aktif di server ini');
    if (!agents.includes(agentId)) throw httpError(400, 'agent tidak dikenal');
    const c = conv.create(db, user.id, agentId);
    const when = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now());
    conv.update(db, user.id, c.id, { title: `🎙️ Panggilan suara · ${when}` });
    const room = `cc-${c.id}`;
    const metadata = { agent: agentId, conversationId: c.id, hermesSession: 'hgchat-' + c.id, user: user.displayName || user.username, voiceProfile: voices[agentId] || DEFAULT_VOICES.dave };
    const token = mintToken({ key, secret, identity: `${user.username}-${c.id.slice(0, 8)}`, name: user.displayName || user.username, room, metadata, now: now() });
    return { url, token, room, conversationId: c.id, agent: agentId, voiceProfile: metadata.voiceProfile };
  }

  // The worker's transcript turns. The conversation must be a voice one of ours.
  function addTurn(req, body = {}) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
    if (!workerKey || !m || m[1].length !== workerKey.length || !crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(workerKey))) throw httpError(401, 'kunci worker salah');
    const id = String(body.conversationId || '');
    const role = body.role === 'assistant' ? 'assistant' : body.role === 'user' ? 'user' : null;
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 20000) : '';
    if (!/^[0-9a-f-]{36}$/.test(id) || !role || !text) throw httpError(400, 'conversationId, role (user|assistant) dan text wajib');
    const c = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id);
    if (!c) throw httpError(404, 'sesi tidak ditemukan');
    const message = conv.addMessage(db, id, { role, content: text, createdAt: now() });
    return { ok: true, messageId: message.id };
  }

  return { enabled, status, startSession, addTurn, voices, AGENT_NAME };
}

module.exports = { createVoice, mintToken, parseVoices, DEFAULT_VOICES };
