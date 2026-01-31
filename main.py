import socket
import asyncio
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from dependencies import r, manager
from routers import public, game

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(redis_listener())
    yield

async def redis_listener():
    while True:
        try:
            pubsub = r.pubsub()
            await pubsub.subscribe("global_game_channel")
            print("✅ Conectado ao Redis PubSub!")
            async for message in pubsub.listen():
                if message["type"] == "message":
                    data = json.loads(message["data"])
                    room_id = data.get("room_id")
                    if room_id: await manager.broadcast_to_room_local(message["data"], room_id)
        except Exception as e:
            print(f"⚠️ Erro Redis Listener: {e}. Reconectando...")
            await asyncio.sleep(3)

app = FastAPI(lifespan=lifespan)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

app.include_router(public.router)
app.include_router(game.router)

@app.get("/", response_class=HTMLResponse)
async def get(request: Request):
    return templates.TemplateResponse("index.html", {
        "request": request, 
        "container_id": socket.gethostname()
    })