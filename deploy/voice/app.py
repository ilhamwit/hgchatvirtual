"""Chat Center voice worker (EPIC-016).

Same engine as Reddie (~/aurix-kit): Silero VAD, Whisper on the GPU for
Indonesian speech-to-text, OmniVoice for the agent's voice. The brain is
different: the Hermes profile of the agent the person is talking to, through
Hermes' OpenAI-compatible API with the Chat Center session id, so the voice
call and the text chat are one conversation.

Mounted over /app/app.py of the Reddie image; the custom_* plugins come from
the image. Dispatched explicitly by name (AGENT_NAME) so it only joins rooms
Chat Center asks it to.
"""
import asyncio
import json
import logging
import os
import random
import re
import time

os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

import aiohttp
from openai import AsyncOpenAI

from livekit.agents import (
    Agent,
    inference,
    AgentServer,
    AgentSession,
    InterruptionOptions,
    JobContext,
    JobProcess,
    TurnHandlingOptions,
    cli,
    stt,
    tts,
    tokenize,
)
from livekit.plugins import silero
from livekit.plugins import openai as lk_openai
from custom_tts.OmniVoicePlugin import OmniVoicePlugin
from custom_tts.PiperTTSPluginLocal import PiperTTSPlugin
from custom_stt.FasterWhisperPlugin import FasterWhisperSTT

logger = logging.getLogger("chat-center.voice")

AGENT_NAME = os.getenv("AGENT_NAME", "hg-voice")
HERMES_URL = os.getenv("HERMES_URL", "http://127.0.0.1:8642").rstrip("/")
HERMES_API_KEY = os.getenv("HERMES_API_KEY", "")
CHAT_CENTER_URL = os.getenv("CHAT_CENTER_URL", "http://127.0.0.1:8643").rstrip("/")
VOICE_KEY = os.getenv("CHAT_CENTER_VOICE_KEY", "")
# Characters a voice must never read aloud: emoji/pictographs, variation
# selectors, zero-width joiners and markdown markers. Applied per streamed piece.
UNSPOKEN = re.compile(
    "[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B00-\u2BFF\uFE0E\uFE0F\u200D\u20E3*#`~|]"
)


def speakable(piece: str) -> str:
    return UNSPOKEN.sub("", piece)


AGENT_IDS = [a.strip() for a in os.getenv("CHAT_AGENTS", "dave,jaden,joel,dylan,nana").split(",") if a.strip()]

VOICE_RULES = (
    "[Mode suara] Kamu sedang mengobrol lewat suara dengan anggota tim HG. Jawab seperti bicara di telepon: "
    "Bahasa Indonesia lisan yang santai dan langsung ke intinya. Biasanya 1–3 kalimat; kalau diminta detail, "
    "boleh lebih panjang tetapi tetap mengalir seperti ucapan, bukan daftar. Tanpa markdown, tanpa "
    "bintang/pagar/daftar bernomor, tanpa emoji, tanpa teks aksi dalam kurung. Angka dan singkatan ditulis "
    "seperti diucapkan. Pakai tool kalau memang dibutuhkan untuk menjawab dengan benar (cek data, cari info). "
    "Ucapan pengguna berasal dari pengenalan suara, jadi bisa ada kata yang salah dengar atau terpotong: "
    "tebak maksud yang paling masuk akal dari konteks, dan tanya balik singkat kalau benar-benar tidak jelas. "
    "Jangan mengirim pesan ke WhatsApp/Telegram/email: jawabanmu langsung diucapkan ke pengguna."
)
REMINDER = "[Mode suara: jawab lisan, tanpa markdown/emoji; ucapan pengguna hasil pengenalan suara]"

# While Hermes is still working (tools, long thinking) the caller hears a
# short line instead of silence. FLUSH makes the TTS speak it at once.
FLUSH = "\u2063"
FILLER_AFTER = float(os.getenv("VOICE_FILLER_AFTER", "1.6"))
FILLER_AGAIN = float(os.getenv("VOICE_FILLER_AGAIN", "12"))
FILLERS = ["Sebentar, saya cek dulu ya.", "Oke, saya lihat dulu sebentar.", "Baik, tunggu sebentar ya."]
FILLERS_AGAIN = ["Masih saya proses, sebentar lagi ya.", "Masih saya cek, tunggu sebentar ya."]


def create_stt():
    return FasterWhisperSTT(model_size=os.getenv("WHISPER_MODEL", "large-v3-turbo"), device="cuda", compute_type="float16", language="id")


def create_tts(voice_profile=None, voice_design=None):
    if os.getenv("TTS_ENGINE", "omnivoice").lower() in ("omnivoice", "omni"):
        return OmniVoicePlugin(
            model_name_or_path=os.getenv("OMNIVOICE_MODEL", "k2-fsa/OmniVoice"),
            voice_profile=voice_profile or os.getenv("VOICE_PROFILE", "male_young"),
            voice_design=voice_design or None,
            voices_dir="voices",
            num_step=int(os.getenv("OMNIVOICE_STEPS", "24")),
            guidance_scale=float(os.getenv("OMNIVOICE_GUIDANCE_SCALE", "2.5")),
            speed=float(os.getenv("TTS_SPEED", "1.0")),
            device="cuda",
            language="Indonesian",
        )
    return PiperTTSPlugin(model_path=os.getenv("PIPER_MODEL"), piper_binary=os.getenv("PIPER_BINARY"), use_cuda=True)


def setup(proc: JobProcess):
    """Load the heavy models once per process."""
    import torch
    proc.userdata["vad"] = silero.VAD.load(min_speech_duration=0.10, min_silence_duration=0.25, activation_threshold=0.50)
    proc.userdata["stt"] = create_stt()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    try:
        OmniVoicePlugin.preload_all_profiles(voices_dir="voices")
    except Exception:
        logger.warning("voice preload failed", exc_info=True)
    logger.info("models ready")


def pending_user_text(items):
    """Everything the person said since the agent last spoke, in order.

    Speech often arrives as several short segments ("kamu bisa" + "carikan
    berita ..."); sending only the last one loses the question. Returns the
    joined text and the assistant message just before it (or None)."""
    said, before = [], None
    for item in reversed(items):
        if getattr(item, "type", "") != "message":
            continue
        if item.role == "assistant":
            before = item
            break
        if item.role == "user":
            t = (item.text_content or "").strip()
            if t:
                said.append(t)
    return " ".join(reversed(said)), before


class HermesAgent(Agent):
    """Sends only the person's newest words to Hermes: Hermes keeps the
    transcript (X-Hermes-Session-Id), exactly like the text chat does."""

    def __init__(self, agent_id: str, session_id: str, greeting: str):
        super().__init__(instructions=VOICE_RULES)
        self.agent_id = agent_id
        self.greeting = greeting
        self.client = AsyncOpenAI(
            base_url=f"{HERMES_URL}/p/{agent_id}/v1", api_key=HERMES_API_KEY or "none",
            default_headers={"X-Hermes-Session-Id": session_id}, timeout=240.0, max_retries=0,
        )
        self.turns = 0

    async def llm_node(self, chat_ctx, tools, model_settings):
        text, before = pending_user_text(chat_ctx.items)
        text = text or self.greeting
        # The rules go with the first turn (Hermes remembers them), then a short reminder.
        prefix = VOICE_RULES if self.turns == 0 else REMINDER
        if before is not None and getattr(before, "interrupted", False):
            heard = (before.text_content or "").strip()
            prefix += f"\n[Jawabanmu sebelumnya dipotong pengguna; yang sempat terdengar hanya: \"{heard[-300:]}\"]"
        self.turns += 1

        pieces = self._hermes(f"{prefix}\n\n{text}").__aiter__()
        fillers = [(FILLER_AFTER, FILLERS), (FILLER_AGAIN, FILLERS_AGAIN)]
        started = time.monotonic()
        got = False
        nxt = asyncio.ensure_future(pieces.__anext__())
        try:
            while True:
                timeout = None
                if fillers:
                    timeout = max(0.0, fillers[0][0] - (time.monotonic() - started))
                done, _ = await asyncio.wait({nxt}, timeout=timeout)
                if not done:
                    # Only before the answer starts, or during a long tool pause
                    # once the answer has gone quiet; never mid-sentence.
                    _, lines = fillers.pop(0)
                    if not got:
                        yield random.choice(lines) + " " + FLUSH
                    continue
                try:
                    piece = nxt.result()
                except StopAsyncIteration:
                    break
                if not got:
                    fillers.clear()          # the answer has started: no more fillers
                got = True
                yield piece
                nxt = asyncio.ensure_future(pieces.__anext__())
            if not got:
                yield "Maaf, saya tidak mendapat jawaban. Coba ulangi."
        except Exception as err:
            logger.warning("hermes failed: %s", err)
            yield "Maaf, saya sedang tidak bisa menjawab. Coba lagi sebentar."
        finally:
            if not nxt.done():
                nxt.cancel()
                try:
                    await nxt
                except BaseException:
                    pass
            await pieces.aclose()

    async def _hermes(self, content: str):
        stream = await self.client.chat.completions.create(
            model=self.agent_id, stream=True, messages=[{"role": "user", "content": content}],
        )
        try:
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                piece = speakable(getattr(delta, "content", None) or "")   # reasoning_content is never spoken
                if piece:
                    yield piece
        finally:
            await stream.close()

    async def tts_node(self, text, model_settings):
        """The default TTS node, plus FLUSH: speak the buffered sentence now
        instead of waiting for the next one (used by the filler line)."""
        activity = self._get_activity_or_raise()
        conn_options = activity.session.conn_options.tts_conn_options
        async with activity.tts.stream(conn_options=conn_options) as stream:

            async def forward():
                async for chunk in text:
                    if FLUSH in chunk:
                        rest = chunk.replace(FLUSH, "")
                        if rest:
                            stream.push_text(rest)
                        stream.flush()
                    else:
                        stream.push_text(chunk)
                stream.end_input()

            task = asyncio.create_task(forward())
            try:
                async for ev in stream:
                    yield ev.frame
            finally:
                task.cancel()
                try:
                    await task
                except BaseException:
                    pass

    async def transcription_node(self, text, model_settings):
        async for delta in text:
            yield delta.replace(FLUSH, "") if isinstance(delta, str) and FLUSH in delta else delta


async def post_turn(http: aiohttp.ClientSession, conversation_id: str, role: str, text: str):
    if not (VOICE_KEY and conversation_id and text):
        return
    try:
        async with http.post(
            f"{CHAT_CENTER_URL}/api/v1/voice/turns",
            headers={"Authorization": f"Bearer {VOICE_KEY}"},
            json={"conversationId": conversation_id, "role": role, "text": text},
            timeout=aiohttp.ClientTimeout(total=10),
        ) as r:
            if r.status >= 300:
                logger.warning("transcript write failed: %s", r.status)
    except Exception as err:
        logger.warning("transcript write failed: %s", err)


server = AgentServer(
    setup_fnc=setup,
    host="127.0.0.1",                       # health server stays local (host network)
    port=int(os.getenv("WORKER_PORT", "8093")),
    num_idle_processes=int(os.getenv("NUM_IDLE_PROCESSES", "1")),   # one warm process: no model load on pickup
    initialize_process_timeout=120.0,
    shutdown_process_timeout=2.0,
    session_end_timeout=2.0,
)


@server.rtc_session(agent_name=AGENT_NAME)   # explicit dispatch only
async def entrypoint(ctx: JobContext):
    participant = await ctx.wait_for_participant()
    meta = {}
    for raw in (ctx.job.metadata, participant.metadata if participant else None):
        if raw:
            try:
                meta.update(json.loads(raw))
            except Exception:
                logger.warning("bad metadata: %r", raw[:80])
    agent_id = meta.get("agent") if meta.get("agent") in AGENT_IDS else AGENT_IDS[0]
    conversation_id = str(meta.get("conversationId") or "")
    session_id = str(meta.get("hermesSession") or (f"hgchat-{conversation_id}" if conversation_id else f"voice-{ctx.room.name}"))
    person = str(meta.get("user") or "anggota tim")
    logger.info("call: room=%s agent=%s conversation=%s user=%s", ctx.room.name, agent_id, conversation_id, person)

    vad = ctx.proc.userdata.get("vad") or silero.VAD.load()
    stt_instance = ctx.proc.userdata.get("stt") or create_stt()
    tts_instance = create_tts(meta.get("voiceProfile"), meta.get("voiceDesign"))

    # AgentSession refuses to generate without an LLM registered, even though
    # HermesAgent.llm_node does the talking; this one points at the same
    # Hermes profile and is never called directly.
    hermes_llm = lk_openai.LLM(model=agent_id, base_url=f"{HERMES_URL}/p/{agent_id}/v1", api_key=HERMES_API_KEY or "none",
                               extra_headers={"X-Hermes-Session-Id": session_id})

    session = AgentSession(
        llm=hermes_llm,
        vad=vad,
        stt=stt.StreamAdapter(stt=stt_instance, vad=vad),
        tts=tts.StreamAdapter(tts=tts_instance, sentence_tokenizer=tokenize.basic.SentenceTokenizer(min_sentence_len=18, stream_context_len=6)),
        turn_handling=TurnHandlingOptions(
            # Local end-of-turn model (the cloud one needs LiveKit Cloud keys).
            turn_detection=inference.TurnDetector(version="v1-mini"),
            # Wait a little after the person stops; longer when the model thinks
            # the sentence is not finished. Whisper needs ~0.4 s after speech ends.
            endpointing={"min_delay": float(os.getenv("VOICE_MIN_DELAY", "0.6")),
                         "max_delay": float(os.getenv("VOICE_MAX_DELAY", "2.5"))},
            # Only real speech interrupts the agent; a cough or "hmm" does not,
            # and a false interruption resumes the answer.
            interruption=InterruptionOptions(mode="vad", min_duration=float(os.getenv("VOICE_INTERRUPT_MIN", "0.6")),
                                             min_words=0, resume_false_interruption=True,
                                             false_interruption_timeout=1.5, discard_audio_if_uninterruptible=True),
            # No speculative requests: each Hermes request may run tools, so it
            # must be sent once, for the finished sentence.
            preemptive_generation={"enabled": False},
        ),
    )

    http = aiohttp.ClientSession()

    @session.on("conversation_item_added")
    def _on_item(ev):
        item = ev.item
        if getattr(item, "type", "") != "message" or item.role not in ("user", "assistant"):
            return
        text = (item.text_content or "").replace(FLUSH, "").strip()
        if text and not text.startswith("[Mode suara"):
            asyncio.create_task(post_turn(http, conversation_id, item.role, text))

    async def _close():
        await http.close()
    ctx.add_shutdown_callback(_close)

    greeting = f"(Panggilan suara baru dimulai.) Sapa {person} dengan hangat dan singkat sebagai dirimu sendiri, lalu tanyakan apa yang bisa dibantu."
    agent = HermesAgent(agent_id, session_id, greeting)
    await session.start(agent=agent, room=ctx.room)
    await session.generate_reply()


if __name__ == "__main__":
    cli.run_app(server)
