"""Drive HermesAgent.tts_node with the real livekit StreamAdapter and a dummy
non-streaming TTS (same shape as OmniVoice); report what gets synthesized."""
import asyncio, sys, types
import os; sys.path.insert(0, "/app"); sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app
from livekit.agents import tts, tokenize, APIConnectOptions

SPOKEN = []
class DummyTTS(tts.TTS):
    def __init__(self):
        super().__init__(capabilities=tts.TTSCapabilities(streaming=False), sample_rate=24000, num_channels=1)
    def synthesize(self, text, *, conn_options=APIConnectOptions()):
        return DummyStream(tts=self, input_text=text, conn_options=conn_options)
class DummyStream(tts.ChunkedStream):
    async def _run(self, output_emitter):
        output_emitter.initialize(request_id="1", sample_rate=24000, num_channels=1, mime_type="audio/pcm")
        SPOKEN.append(self.input_text.strip())
        await asyncio.sleep(0.05)
        output_emitter.push(b"\x00\x00" * 2400 * max(1, len(self.input_text) // 10))
        output_emitter.flush()

async def chunks(parts):
    for delay, p in parts:
        await asyncio.sleep(delay)
        yield p

async def run(parts):
    SPOKEN.clear()
    adapter = tts.StreamAdapter(tts=DummyTTS(), sentence_tokenizer=tokenize.basic.SentenceTokenizer(min_sentence_len=18, stream_context_len=6))
    a = app.HermesAgent.__new__(app.HermesAgent)
    act = types.SimpleNamespace(tts=adapter, session=types.SimpleNamespace(conn_options=types.SimpleNamespace(tts_conn_options=APIConnectOptions())))
    a._get_activity_or_raise = lambda: act
    frames, first_audio = 0, None
    loop = asyncio.get_event_loop(); t0 = loop.time()
    async for f in a.tts_node(chunks(parts), None):
        frames += 1
        if first_audio is None: first_audio = round(loop.time() - t0, 2)
    return list(SPOKEN), first_audio

answer = "Jadwalnya sudah saya susun lengkap, Ilham, tapi belum masuk ke kalender. Kalau mau saya buatkan di Google Calendar, tinggal bilang. Nanti saya pandu sambungkan dulu."
words = [(0.0, w + " ") for w in answer.split(" ")]
parts = [(0.0, "Baik, tunggu sebentar ya. " + app.FLUSH), (1.0, "")] + words
spoken, first = asyncio.run(run(parts))
print("first audio after", first, "s")
for s in spoken: print("  spoke:", s)
joined = " ".join(spoken)
ok = all(x in joined for x in ["tunggu sebentar", "Jadwalnya", "Google Calendar", "sambungkan dulu"]) and first is not None and first < 0.8
print("RESULT", "OK" if ok else "BROKEN")
spoken, _ = asyncio.run(run(words))
assert " ".join(spoken).count("Jadwalnya") == 1 and "sambungkan dulu" in " ".join(spoken), spoken
spoken, first = asyncio.run(run([(0, "Sebentar, saya cek dulu ya. " + app.FLUSH), (0.3, "Masih saya cek, tunggu sebentar ya. " + app.FLUSH), (0.3, "")] + words))
assert spoken[0].startswith("Sebentar") and spoken[1].startswith("Masih") and "sambungkan dulu" in spoken[-1] and first < 0.2, spoken
print("variants OK")
