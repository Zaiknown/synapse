import random
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from dependencies import r
from faker import Faker

router = APIRouter()

fake = Faker(['en_US'])

@router.get("/generate-nickname")
async def generate_nickname():
    """
    Gera um nickname dinâmico estilo Gamer/Cyberpunk.
    Exemplos: NeonHunter99, BlueStriker12, CyberAgent77
    """
    try:
        part1 = fake.color_name().capitalize()
        
        job = fake.job().split(' ')[-1].capitalize()

        if len(job) > 8:
            part2 = "Player"
        else:
            part2 = job

        num = fake.random_int(1, 999)

        nickname = f"{part1}{part2}{num}"
        
        return JSONResponse({"nickname": nickname})
    except Exception as e:
        print(f"Erro gerando nick: {e}")
        return JSONResponse({"nickname": f"Player{random.randint(1000, 9999)}"})

@router.get("/check-room/{room_id}")
async def check_room(room_id: str):
    exists = await r.exists(f"room:{room_id}:owner")
    is_full = False
    
    if exists:
        stored_max = await r.hget(f"room:{room_id}:config", "max")
        current_players = await r.scard(f"room:{room_id}:players")
        if stored_max and current_players >= int(stored_max):
            is_full = True
            
    return JSONResponse({"exists": bool(exists), "is_full": is_full})

@router.get("/public-rooms")
async def list_public_rooms():
    public_rooms = []
    async for key in r.scan_iter("room:*:config"):
        key_str = key if isinstance(key, str) else key.decode('utf-8')
        room_id = key_str.split(":")[1]
        
        config = await r.hgetall(key)
        
        if config.get("private") != "1":
            count = await r.scard(f"room:{room_id}:players")
            max_p = int(config.get("max", 4))
            
            if count < max_p:
                owner_id = await r.get(f"room:{room_id}:owner")
                owner_name = await r.hget(f"room:{room_id}:names", owner_id) or "Desconhecido"
                room_name = config.get("name", f"Sala {room_id}")

                public_rooms.append({
                    "id": room_id,
                    "name": room_name,
                    "owner": owner_name,
                    "count": count,
                    "max": max_p
                })
    
    return JSONResponse(public_rooms)