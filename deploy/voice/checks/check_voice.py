import asyncio, sys, time
import os; sys.path.insert(0, "/app"); sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app
class M:
    def __init__(s, role, text, interrupted=False): s.type="message"; s.role=role; s.text_content=text; s.interrupted=interrupted
items=[M("assistant","Halo"),M("user","kamu bisa"),M("user","carikan berita kebakaran hutan")]
t,b=app.pending_user_text(items); assert t=="kamu bisa carikan berita kebakaran hutan", t; assert b.text_content=="Halo"
assert app.pending_user_text([])==("",None)
class Ctx: pass
async def run(delay_first, chunks):
    a=app.HermesAgent.__new__(app.HermesAgent); a.agent_id="dave"; a.greeting="hi"; a.turns=0
    async def fake(content):
        assert "kamu bisa carikan" in content
        await asyncio.sleep(delay_first)
        for c in chunks: yield c
    a._hermes=fake
    c=Ctx(); c.items=items
    out=[]
    async for p in a.llm_node(c,None,None): out.append(p)
    return out
app.FILLER_AFTER=0.2; app.FILLER_AGAIN=0.6
o=asyncio.run(run(0.05,["Jawaban ","cepat."])); assert o==["Jawaban ","cepat."], o
o=asyncio.run(run(0.4,["Jawaban."])); assert len(o)==2 and o[0].endswith(app.FLUSH) and o[1]=="Jawaban.", o
o=asyncio.run(run(0.8,["Jawaban."])); assert len(o)==3 and o[1] in [x+" "+app.FLUSH for x in app.FILLERS_AGAIN], o
async def boom(content):
    raise RuntimeError("x"); yield
a=app.HermesAgent.__new__(app.HermesAgent); a.agent_id="dave"; a.greeting="hi"; a.turns=0; a._hermes=boom
async def r():
    c=Ctx(); c.items=items; return [p async for p in a.llm_node(c,None,None)]
assert asyncio.run(r())==["Maaf, saya sedang tidak bisa menjawab. Coba lagi sebentar."]
print("voice logic OK")
# greeting: no filler even when slow
a=app.HermesAgent.__new__(app.HermesAgent); a.agent_id="dave"; a.greeting="hi"; a.turns=0
async def slow(content):
    await asyncio.sleep(0.8); yield "Halo Ilham."
a._hermes=slow
async def g():
    c=Ctx(); c.items=[]; return [p async for p in a.llm_node(c,None,None)]
assert asyncio.run(g())==["Halo Ilham."]
print("greeting OK")
