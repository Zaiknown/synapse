import os
import redis.asyncio as redis
from fastapi import WebSocket

redis_host = os.getenv("REDIS_HOST", "localhost")
r = redis.Redis(host=redis_host, port=6379, decode_responses=True)

class RoomConnectionManager:
    def __init__(self):
        self.rooms: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        if room_id not in self.rooms:
            self.rooms[room_id] = []
        self.rooms[room_id].append(websocket)

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.rooms:
            if websocket in self.rooms[room_id]:
                self.rooms[room_id].remove(websocket)
            if not self.rooms[room_id]:
                del self.rooms[room_id]

    async def broadcast_to_room_local(self, message: str, room_id: str):
        if room_id in self.rooms:
            for connection in self.rooms[room_id]:
                try:
                    await connection.send_text(message)
                except:
                    pass

manager = RoomConnectionManager()