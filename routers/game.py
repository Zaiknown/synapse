import json
import time
import html
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from dependencies import r, manager
from services.trivia import get_trivia_question

router = APIRouter()

async def monitor_turn_timeout(room_id: str, turn_number: int):
    """
    Espera 45s. Se o turno ainda for o mesmo e o estado for 'creating',
    gera uma pergunta automática.
    """
    # print(f"⏳ [Sala {room_id}] Timer iniciado para turno {turn_number}", flush=True)
    await asyncio.sleep(45)
    
    current_turn = await r.get(f"room:{room_id}:turn_count")
    current_state = await r.get(f"room:{room_id}:state") 

    if int(current_turn or 0) != turn_number or current_state != "creating":
        return

    # print(f"⏰ [Sala {room_id}] TEMPO ESGOTADO! Gerando pergunta automática...", flush=True)

    creator_id = await r.get(f"room:{room_id}:current_creator")
    creator_name = await r.hget(f"room:{room_id}:names", creator_id) or "Sistema"

    trivia = await get_trivia_question("any")

    if trivia and "q" in trivia:
        all_names = await r.hgetall(f"room:{room_id}:names")

        await r.set(f"room:{room_id}:state", "answering") 
        await r.set(f"room:{room_id}:answer_count", 0)
        
        question_payload = {
            "type": "start_answering", 
            "room_id": room_id, 
            "creator_id": creator_id,
            "q": trivia["q"] + " (Automática por Tempo ⏰)", 
            "options": trivia["options"],
            "start_time": time.time(), 
            "creator_name": creator_name,
            "players_list": all_names
        }
        
        await r.set(f"room:{room_id}:answer", trivia["correct_idx"])
        await r.set(f"room:{room_id}:start_time", time.time())

        await r.publish("global_game_channel", json.dumps({
            "type": "chat_broadcast", "room_id": room_id,
            "sender_name": "SISTEMA", "sender_id": "sys",
            "text": "⏳ Tempo esgotado! Pergunta gerada automaticamente."
        }))

        await r.publish("global_game_channel", json.dumps(question_payload))


@router.websocket("/ws/{room_id}/{client_id}")
async def websocket_endpoint(
    websocket: WebSocket, 
    room_id: str, 
    client_id: str, 
    name: str = "Anônimo", 
    cycles: int = 1, 
    max_players: int = 4, 
    action: str = "join",
    private: int = 0,
    room_name: str = ""
):
    room_exists = await r.exists(f"room:{room_id}:owner")
    
    if action == "join" and not room_exists:
        await websocket.accept() 
        await websocket.close(code=4002, reason="Sala Inexistente")
        return

    is_reconnect = await r.sismember(f"room:{room_id}:players", client_id)
    
    if not is_reconnect:
        stored_max = await r.hget(f"room:{room_id}:config", "max")
        current_players_count = await r.scard(f"room:{room_id}:players")
        if stored_max and current_players_count >= int(stored_max):
            await websocket.accept()
            await websocket.close(code=4000, reason="Sala Cheia")
            return
    
    await manager.connect(websocket, room_id)
    
    count = await r.scard(f"room:{room_id}:players")
    if count == 0:
        await r.set(f"room:{room_id}:owner", client_id)
        await r.set(f"room:{room_id}:turn_count", 0)
        await r.delete(f"room:{room_id}:player_list")
        
        final_room_name = room_name if room_name else f"Sala {room_id}"

        await r.hset(f"room:{room_id}:config", mapping={
            "cycles": cycles, "max": max_players, "private": private, "name": final_room_name
        })
        await r.expire(f"room:{room_id}:owner", 3600)
    
    await r.sadd(f"room:{room_id}:players", client_id)
    await r.hset(f"room:{room_id}:names", client_id, name)
    await r.lrem(f"room:{room_id}:player_list", 0, client_id)
    await r.rpush(f"room:{room_id}:player_list", client_id)
    
    owner_id = await r.get(f"room:{room_id}:owner")
    all_names_map = await r.hgetall(f"room:{room_id}:names")
    room_config = await r.hgetall(f"room:{room_id}:config")
    
    await websocket.send_text(json.dumps({
        "type": "welcome_pack",
        "is_owner": (client_id == owner_id),
        "owner_id": owner_id,
        "players": all_names_map,
        "config": room_config
    }))
    
    await r.publish("global_game_channel", json.dumps({
        "type": "player_joined", "room_id": room_id, "id": client_id, "name": name
    }))

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            msg["room_id"] = room_id
            if msg["type"] == "request_start":
                current_owner = await r.get(f"room:{room_id}:owner")
                
                if current_owner == client_id:
                    player_count = await r.scard(f"room:{room_id}:players")
                    if player_count < 2:
                        await websocket.send_text(json.dumps({
                            "type": "feedback", "result": "wrong",
                            "title": "Sozinho? 😢", "subtitle": "Precisa de pelo menos 2 jogadores!"
                        }))
                        continue
                    
                    players_ordered = await r.lrange(f"room:{room_id}:player_list", 0, -1)
                    
                    if players_ordered:
                        config = await r.hgetall(f"room:{room_id}:config")
                        total_cycles = int(config.get("cycles", 1))
                        num_players = len(players_ordered)
                        max_turns = num_players * total_cycles
                        
                        current_turn = await r.incr(f"room:{room_id}:turn_count")
                        
                        await r.set(f"room:{room_id}:reroll_count", 0)

                        if current_turn > max_turns:
                            ranking = []
                            for pid in players_ordered:
                                score = await r.get(f"room:{room_id}:score:{pid}")
                                score = int(score) if score else 0
                                wins = await r.get(f"room:{room_id}:wins:{pid}")
                                wins = int(wins) if wins else 0
                                p_name = await r.hget(f"room:{room_id}:names", pid) or "Anônimo"
                                ranking.append({"name": p_name, "score": score, "wins": wins})
                            
                            ranking.sort(key=lambda x: (x["score"], x["wins"]), reverse=True)
                            
                            await r.publish("global_game_channel", json.dumps({
                                "type": "game_over", "room_id": room_id, "ranking": ranking[:3]
                            }))

                            await r.set(f"room:{room_id}:turn_count", 0)
                            
                            await r.set(f"room:{room_id}:state", "waiting")

                            keys_score = [f"room:{room_id}:score:{pid}" for pid in players_ordered]
                            keys_wins = [f"room:{room_id}:wins:{pid}" for pid in players_ordered]
                            keys_to_delete = keys_score + keys_wins
                            if keys_to_delete: 
                                await r.delete(*keys_to_delete)
                            
                        else:
                            idx = (current_turn - 1) % num_players
                            next_creator = players_ordered[idx]
                            creator_name = await r.hget(f"room:{room_id}:names", next_creator) or "Alguém"
                            
                            await r.set(f"room:{room_id}:current_creator", next_creator)
                            await r.set(f"room:{room_id}:reroll_count", 0)
                            await r.set(f"room:{room_id}:state", "creating")
                            asyncio.create_task(monitor_turn_timeout(room_id, int(current_turn)))

                            await r.publish("global_game_channel", json.dumps({
                                "type": "new_turn",
                                "room_id": room_id,
                                "creator_id": next_creator,
                                "creator_name": creator_name
                            }))
            
            elif msg["type"] == "generate_question":
                current_rerolls = await r.get(f"room:{room_id}:reroll_count")
                current_rerolls = int(current_rerolls) if current_rerolls else 0

                if current_rerolls >= 5:
                    await websocket.send_text(json.dumps({
                        "type": "feedback", "result": "wrong",
                        "title": "Acabou! ✋", "subtitle": "Você usou suas 5 tentativas."
                    }))
                    continue

                new_count = await r.incr(f"room:{room_id}:reroll_count")
                remaining = 5 - new_count
                
                category_selected = msg.get("category", "any")
                trivia = await get_trivia_question(category_selected)
                
                if trivia and "error" in trivia:
                    await websocket.send_text(json.dumps({"type": "debug_error", "message": trivia["error"]}))
                    await websocket.send_text(json.dumps({"type": "feedback", "result": "wrong", "points": 0}))
                
                elif trivia and "q" in trivia:
                    await websocket.send_text(json.dumps({"type": "question_filled", "data": trivia, "remaining": remaining}))
                
                else:
                    await websocket.send_text(json.dumps({"type": "feedback", "result": "wrong", "points": 0}))

            elif msg["type"] == "submit_question":
                await r.set(f"room:{room_id}:state", "answering")
                
                all_names = await r.hgetall(f"room:{room_id}:names")
                await r.set(f"room:{room_id}:answer_count", 0)
                question_payload = {
                    "type": "start_answering", "room_id": room_id, "creator_id": client_id,
                    "q": msg["q"], "options": msg["options"],
                    "start_time": time.time(), "creator_name": name,
                    "players_list": all_names
                }
                await r.set(f"room:{room_id}:answer", msg["correct_idx"])
                await r.set(f"room:{room_id}:start_time", time.time())
                await r.publish("global_game_channel", json.dumps(question_payload))

            elif msg["type"] == "submit_answer":
                correct_idx = await r.get(f"room:{room_id}:answer")
                is_correct = (str(msg["answer_idx"]) == str(correct_idx))
                start_t = await r.get(f"room:{room_id}:start_time")
                elapsed = time.time() - float(start_t) if start_t else 30
                points = 0
                if is_correct:
                    points = int((30 - elapsed) * 10)
                    if points < 10: points = 10
                    await r.incrby(f"room:{room_id}:score:{client_id}", points)
                    await r.incr(f"room:{room_id}:wins:{client_id}")
                
                new_total = await r.get(f"room:{room_id}:score:{client_id}") or 0
                await websocket.send_text(json.dumps({
                    "type": "feedback", "result": "correct" if is_correct else "wrong", 
                    "points": points, "total": new_total,
                    "title": "NA MOSCA!" if is_correct else "NÃO FOI DESSA VEZ...",
                    "subtitle": f"+{points} Pontos" if is_correct else "Mais sorte na próxima!"
                }))
                
                await r.publish("global_game_channel", json.dumps({
                    "type": "player_answered_update", "room_id": room_id, "player_id": client_id,
                    "result": "correct" if is_correct else "wrong", "time_taken": round(elapsed, 1)
                }))

                ans_count = await r.incr(f"room:{room_id}:answer_count")
                total_players = await r.scard(f"room:{room_id}:players")
                
                if ans_count >= (total_players - 1):
                    correct_idx = await r.get(f"room:{room_id}:answer")
                    await r.publish("global_game_channel", json.dumps({
                        "type": "round_over", 
                        "room_id": room_id,
                        "correct_idx": int(correct_idx) if correct_idx else 0
                    }))

            elif msg["type"] == "chat_message":
                text = html.escape(msg.get("text", ""))
                if text:
                    await r.publish("global_game_channel", json.dumps({
                        "type": "chat_broadcast", "room_id": room_id,
                        "sender_name": name, "sender_id": client_id, "text": text
                    }))
        
            elif msg["type"] == "request_play_again":
                current_owner = await r.get(f"room:{room_id}:owner")

                if client_id != current_owner:
                    await r.publish("global_game_channel", json.dumps({
                        "type": "chat_broadcast",
                        "room_id": room_id,
                        "sender_name": "SISTEMA",
                        "sender_id": "sys",
                        "text": f"🔄 {name} pediu para jogar de novo!"
                    }))

                else:
                    keys_to_reset = []
                    keys_to_reset.extend(await r.keys(f"room:{room_id}:score:*"))
                    keys_to_reset.extend(await r.keys(f"room:{room_id}:wins:*"))
                    keys_to_reset.append(f"room:{room_id}:turn_count")
                    keys_to_reset.append(f"room:{room_id}:reroll_count")
                    keys_to_reset.append(f"room:{room_id}:answer_count")
                    keys_to_reset.append(f"room:{room_id}:state")
                    
                    if keys_to_reset:
                        await r.delete(*keys_to_reset)

                    await r.set(f"room:{room_id}:current_creator", current_owner)

                    await r.publish("global_game_channel", json.dumps({
                        "type": "reset_to_lobby",
                        "room_id": room_id
                    }))

                    await r.publish("global_game_channel", json.dumps({
                        "type": "chat_broadcast",
                        "room_id": room_id,
                        "sender_name": "SISTEMA",
                        "sender_id": "sys",
                        "text": "👑 O Dono reiniciou a sala! Preparando nova partida..."
                    }))

    except WebSocketDisconnect:
        manager.disconnect(websocket, room_id)
        owner_id = await r.get(f"room:{room_id}:owner")
        
        if client_id == owner_id:
            await r.publish("global_game_channel", json.dumps({
                "type": "room_closed", "room_id": room_id,
                "reason": "O Dono da sala encerrou o jogo."
            }))
            keys = await r.keys(f"room:{room_id}:*")
            if keys: await r.delete(*keys)
        
        else:
            await r.srem(f"room:{room_id}:players", client_id)
            await r.lrem(f"room:{room_id}:player_list", 0, client_id)
            await r.hdel(f"room:{room_id}:names", client_id)

            remaining = await r.scard(f"room:{room_id}:players")
            turn_count = await r.get(f"room:{room_id}:turn_count")
            current_state = await r.get(f"room:{room_id}:state")

            if int(turn_count or 0) > 0 and current_state != "waiting" and remaining < 2:
                await r.publish("global_game_channel", json.dumps({
                    "type": "room_closed", "room_id": room_id,
                    "reason": "Jogadores insuficientes! A sala foi fechada."
                }))
                keys = await r.keys(f"room:{room_id}:*")
                if keys: await r.delete(*keys)
                return 

            await r.publish("global_game_channel", json.dumps({
                "type": "player_left", "room_id": room_id, "id": client_id
            }))

            if current_state in ["creating", "answering"]:
                current_creator = await r.get(f"room:{room_id}:current_creator")
                
                if current_creator == client_id:
                    players_ordered = await r.lrange(f"room:{room_id}:player_list", 0, -1)
                    
                    if players_ordered:
                        current_turn = await r.get(f"room:{room_id}:turn_count")
                        current_turn = int(current_turn) if current_turn else 1
                        
                        num_players = len(players_ordered)
                        if num_players > 0:
                            idx = (current_turn - 1) % num_players
                            next_creator = players_ordered[idx]
                        else:
                            return 
                        
                        creator_name = await r.hget(f"room:{room_id}:names", next_creator) or "Alguém"
                        
                        await r.set(f"room:{room_id}:current_creator", next_creator)
                        await r.set(f"room:{room_id}:reroll_count", 0)

                        await r.publish("global_game_channel", json.dumps({
                            "type": "chat_broadcast", "room_id": room_id,
                            "sender_name": "SISTEMA", "sender_id": "sys",
                            "text": "O Criador saiu! A fila andou..."
                        }))

                        await r.set(f"room:{room_id}:state", "creating")
                        asyncio.create_task(monitor_turn_timeout(room_id, int(current_turn)))

                        await r.publish("global_game_channel", json.dumps({
                            "type": "new_turn",
                            "room_id": room_id,
                            "creator_id": next_creator,
                            "creator_name": creator_name
                        }))