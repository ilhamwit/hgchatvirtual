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
import re

os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

import aiohttp
from openai import AsyncOpenAI

from livekit.agents import (
    Agent,
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
    "[Mode suara] Kamu sedang mengobrol lewat suara dengan anggota tim HG. Jawab seperti bicara: "
    "Bahasa Indonesia lisan yang santai, ringkas, 1–3 kalimat, langsung ke intinya. Tanpa markdown, tanpa "
    "bintang/pagar/daftar bernomor, tanpa emoji, tanpa teks aksi dalam kurung. Angka dan singkatan ditulis "
    "seperti diucapkan. Boleh memakai tool bila benar-benar perlu, tetapi utamakan jawaban cepat. "
    "Jangan mengirim pesan ke WhatsApp/Telegram/email: jawabanmu langsung diucapkan ke pengguna."
)


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


class HermesAgent(Agent):
    """Sends only the newest message to Hermes: Hermes keeps the transcript
    (X-Hermes-Session-Id), exactly like the text chat does."""

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
        # The person's newest words; before they have said anything, the greeting.
        last = None
        for item in reversed(chat_ctx.items):
            if getattr(item, "type", "") == "message" and item.role == "user":
                last = item
                break
        text = ((last.text_content if last is not None else "") or "").strip() or self.greeting
        # The rules go with the first turn (Hermes remembers them), then a short reminder.
        prefix = VOICE_RULES if self.turns == 0 else "[Mode suara: jawab lisan, singkat, tanpa markdown]"
        self.turns += 1
        try:
            stream = await self.client.chat.completions.create(
                model=self.agent_id, stream=True,
                messages=[{"role": "user", "content": f"{prefix}\n\n{text}"}],
            )
            got = False
            async for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                piece = speakable(getattr(delta, "content", None) or "")   # reasoning_content is never spoken
                if piece:
                    got = True
                    yield piece
            if not got:
                yield "Maaf, saya tidak mendapat jawaban. Coba ulangi."
        except Exception as err:
            logger.warning("hermes failed: %s", err)
            yield "Maaf, saya sedang tidak bisa menjawab. Coba lagi sebentar."


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
    num_idle_processes=int(os.getenv("NUM_IDLE_PROCESSES", "0")),
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
            endpointing_delay=0.15,
            interruption=InterruptionOptions(mode="vad", min_duration=0.12, min_words=0, discard_audio_if_uninterruptible=True),
            preemptive_tts=True,
        ),
    )

    http = aiohttp.ClientSession()

    @session.on("conversation_item_added")
    def _on_item(ev):
        item = ev.item
        if getattr(item, "type", "") != "message" or item.role not in ("user", "assistant"):
            return
        text = (item.text_content or "").strip()
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
