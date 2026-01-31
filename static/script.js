let storedId = sessionStorage.getItem("sm_myId");
if (!storedId) {
    storedId = "user_" + Math.floor(Math.random() * 100000);
    sessionStorage.setItem("sm_myId", storedId);
}
const myId = storedId; 

let myNickname = sessionStorage.getItem("sm_nick") || "";

let ws;
let currentRoom = "";
let timerInterval;
let creatorTimerInterval;

let connectedPlayers = new Set(); 
let roomMaxPlayers = 0; 
let currentRoundOptions = []; 
let amICorrect = false;
let iAmCreator = false;

const sounds = {
    bgm: new Audio('/static/sounds/bgm.mp3'),
    join: new Audio('/static/sounds/join.wav'),
    tick: new Audio('/static/sounds/tick.mp3'),
    correct: new Audio('/static/sounds/correct.wav'),
    wrong: new Audio('/static/sounds/wrong.wav'),
    win: new Audio('/static/sounds/win.wav'),
    msg: new Audio('/static/sounds/join.wav') 
};

sounds.bgm.loop = true; 
sounds.bgm.volume = 0.2; 
['join', 'tick', 'correct', 'wrong', 'win', 'msg'].forEach(k => {
    if(sounds[k]) sounds[k].volume = 1.0;
});

let isMuted = false;

function toggleMute() {
    isMuted = !isMuted;
    const btn = document.getElementById("btn-sound-toggle");
    Object.values(sounds).forEach(s => s.muted = isMuted);
    
    if(isMuted) {
        btn.innerText = "🔇";
    } else {
        btn.innerText = "🔊";
        if(!document.getElementById("screen-lobby").classList.contains("hidden")) {
            sounds.bgm.play().catch(()=>{});
        }
    }
}

function playSound(name, duration = 0) {
    if (isMuted) return;
    const sound = sounds[name];
    if (sound) {
        sound.currentTime = 0;
        sound.play().catch(e => console.log("Audio block:", e));
        if (duration > 0) {
            setTimeout(() => {
                sound.pause();
                sound.currentTime = 0;
            }, duration);
        }
    }
}

function stopMusic() {
    sounds.bgm.pause();
    sounds.bgm.currentTime = 0;
}

function stopTick() {
    sounds.tick.pause();
    sounds.tick.currentTime = 0;
}

function startCreatorTimer() {
    const bar = document.getElementById("creator-progress-bar");
    if (!bar) return;

    let timeLeft = 45;
    const totalTime = 45;
    
    bar.style.width = "100%";
    bar.style.backgroundColor = "#00ffcc"; 
    
    if (creatorTimerInterval) clearInterval(creatorTimerInterval);

    creatorTimerInterval = setInterval(() => {
        timeLeft--;
        const pct = (timeLeft / totalTime) * 100;
        bar.style.width = `${pct}%`;

        if (timeLeft < 10) {
            bar.style.backgroundColor = "#ff4d4d"; 
        } else if (timeLeft < 20) {
            bar.style.backgroundColor = "#ffcc00"; 
        }

        if (timeLeft <= 0) {
            clearInterval(creatorTimerInterval);
        }
    }, 1000);
}

function stopCreatorTimer() {
    if (creatorTimerInterval) clearInterval(creatorTimerInterval);
}

async function fetchRandomNickname() {
    try {
        const response = await fetch('/generate-nickname');
        if (!response.ok) throw new Error("Erro API");
        const data = await response.json();
        return data.nickname;
    } catch (e) {
        console.warn("⚠️ Backend off. Usando fallback local.");
        const adjs = ["Cyber", "Neon", "Tech", "Holo", "Meta"];
        const subs = ["Ninja", "Pato", "Dev", "Bot", "Wolf"];
        const n = Math.floor(Math.random() * 999);
        return `${adjs[Math.floor(Math.random()*adjs.length)]}${subs[Math.floor(Math.random()*subs.length)]}${n}`;
    }
}

async function ensureNickname() {
    const nickInput = document.getElementById("nickname-input");
    let val = nickInput.value.trim();

    if (!val) {
        nickInput.placeholder = "Gerando...";
        val = await fetchRandomNickname();
        nickInput.value = val;
    }
    
    myNickname = val;
    sessionStorage.setItem("sm_nick", val);
    return val;
}

window.onload = function() {
    const nickInput = document.getElementById("nickname-input");
    const savedRoom = sessionStorage.getItem("sm_room");
    
    if (savedRoom) {
        if(nickInput && myNickname) nickInput.value = myNickname;
        console.log("🔄 Reconectando...", savedRoom);
        joinRoom(savedRoom, null, null, "join", 0, "");
    } else {
        if(nickInput) nickInput.value = ""; 
        fetchPublicRooms();
        setInterval(fetchPublicRooms, 5000);
    }

    setupDraggableChat();
};

function updateOnlineCounter() {
    const countEl = document.getElementById("online-count");
    if (countEl) {
        if (roomMaxPlayers > 0) {
            countEl.innerText = `${connectedPlayers.size}/${roomMaxPlayers}`;
        } else {
            countEl.innerText = connectedPlayers.size;
        }
    }
}

function setChatState(enabled) {
    const input = document.getElementById("chat-input");
    const btn = document.querySelector(".chat-input-area button");
    
    if (enabled) {
        input.disabled = false;
        if(btn) btn.disabled = false;
        input.placeholder = "Mensagem...";
        input.style.opacity = "1";
        input.style.cursor = "text";
    } else {
        input.disabled = true;
        if(btn) btn.disabled = true;
        input.placeholder = "🤫 Shhh! Chat bloqueado...";
        input.style.opacity = "0.5";
        input.style.cursor = "not-allowed";
    }
}

function generateRoomCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let res = "";
    for (let i=0; i<4; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
    return res;
}

async function fetchPublicRooms() {
    if (document.getElementById("screen-home").classList.contains("hidden")) return;

    try {
        const response = await fetch('/public-rooms');
        const rooms = await response.json();
        
        const list = document.getElementById("public-rooms-list");
        const container = document.getElementById("public-rooms-container");
        
        list.innerHTML = "";

        if (rooms.length === 0) {
            list.innerHTML = '<p style="opacity: 0.5; font-size: 0.8rem;">Nenhuma sala pública no momento.</p>';
            container.classList.remove("hidden");
            return;
        }

        rooms.forEach(room => {
            const div = document.createElement("div");
            div.className = "room-item";

            div.onclick = async () => {
                await ensureNickname();
                playSound('bgm');
                joinRoom(room.id, null, null, "join", 0, ""); 
            };
            
            div.innerHTML = `
                <div class="room-info">
                    <span class="room-code" style="font-size:1rem; color:white;">${room.name}</span>
                    <span class="room-owner">👑 ${room.owner}</span>
                </div>
                <div class="room-count">
                    👤 ${room.count}/${room.max}
                </div>
            `;
            list.appendChild(div);
        });
        container.classList.remove("hidden");
    } catch (e) {
        console.error("Erro ao buscar salas:", e);
    }
}

async function createRoom() {
    await ensureNickname();

    const code = generateRoomCode();
    let cycles = parseInt(document.getElementById("input-cycles").value);
    let maxPlayers = parseInt(document.getElementById("input-max-players").value);
    const isPrivate = document.getElementById("input-private").checked ? 1 : 0;
    const roomName = document.getElementById("input-room-name").value;

    if(!roomName) return showVisualFeedback("wrong", "Nome da Sala", "Dê um nome para sua sala!");
    if (!cycles || cycles < 1) cycles = 1;
    if (!maxPlayers || maxPlayers < 2) maxPlayers = 2; 
    if (cycles > 20) return showVisualFeedback("wrong", "Calma lá!", "Máximo de 20 ciclos.");
    if (maxPlayers > 50) return showVisualFeedback("wrong", "Muita gente!", "O limite é 50 jogadores.");

    playSound('bgm'); 
    joinRoom(code, cycles, maxPlayers, "create", isPrivate, roomName);
}

async function enterRoom() {
    await ensureNickname();

    const codeInput = document.getElementById("room-code-input").value.toUpperCase();
    
    if (codeInput.length < 4) {
        return showVisualFeedback("wrong", "Código Inválido", "O código deve ter 4 caracteres.");
    }

    const btn = document.querySelector("#screen-home .btn-action");
    const originalText = btn.innerText;
    btn.innerText = "🔍";
    btn.disabled = true;

    try {
        const response = await fetch(`/check-room/${codeInput}`);
        const data = await response.json();
        
        btn.innerText = originalText;
        btn.disabled = false;

        if (!data.exists) return showVisualFeedback("wrong", "Sala Inexistente", "Verifique o código.");
        if (data.is_full) return showVisualFeedback("wrong", "Sala Lotada", "Não há mais vagas.");

        playSound('bgm'); 
        joinRoom(codeInput, null, null, "join", 0, "");

    } catch (error) {
        btn.innerText = originalText;
        btn.disabled = false;
        console.error(error);
        showVisualFeedback("wrong", "Erro", "Falha ao verificar sala.");
    }
}

function exitToHome() {
    if (ws) ws.close();
    sessionStorage.removeItem("sm_room");
    connectedPlayers.clear(); 
    roomMaxPlayers = 0; 
    stopMusic();
    stopTick();
    document.getElementById("game-chat").classList.add("hidden");
    location.reload();
}

function joinRoom(roomId, cycles, maxPlayers, action = "join", isPrivate = 0, roomName = "") {
    const nickInput = document.getElementById("nickname-input");

    myNickname = nickInput.value;
    sessionStorage.setItem("sm_nick", myNickname);

    currentRoom = roomId;
    sessionStorage.setItem("sm_room", roomId);
    
    document.getElementById("btn-exit-room").classList.remove("hidden");
    document.getElementById("game-header").classList.remove("hidden");
    document.getElementById("display-room-name").innerText = "Conectando...";
    document.getElementById("badge-code-container").classList.add("hidden");
    document.getElementById("screen-home").classList.add("hidden");
    document.getElementById("screen-lobby").classList.remove("hidden");
    document.getElementById("game-chat").classList.remove("hidden");

    setChatState(true);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    let url = `${protocol}//${window.location.host}/ws/${roomId}/${myId}?name=${encodeURIComponent(myNickname)}&action=${action}`;
    
    if (cycles && maxPlayers) {
        url += `&cycles=${cycles}&max=${maxPlayers}&private=${isPrivate}&room_name=${encodeURIComponent(roomName)}`;
    }

    if (ws) ws.close();
    ws = new WebSocket(url);

    ws.onclose = (event) => {
        if (event.code === 4002) {
            showVisualFeedback("wrong", "Sala Inexistente", "Verifique o código.");
            setTimeout(() => { sessionStorage.removeItem("sm_room"); location.reload(); }, 3000);
        } else if (event.code === 4000) {
            showVisualFeedback("wrong", "Sala Lotada!", "Sem vagas.");
            setTimeout(() => { sessionStorage.removeItem("sm_room"); location.reload(); }, 3000); 
        } else if (event.code === 4001) {
            showVisualFeedback("wrong", "Erro de Conexão", "Falha no servidor.");
            setTimeout(() => { sessionStorage.removeItem("sm_room"); location.reload(); }, 3000);
        }
    };

    setupWebSocket();
}

function setupWebSocket() {
    ws.onmessage = function(event) {
        const msg = JSON.parse(event.data);
        console.log("Evento:", msg);

        if (msg.type === "room_closed") {
            showVisualFeedback("wrong", "FIM DE JOGO", msg.reason || "A sala foi fechada.");
            stopMusic();
            setChatState(false); 
            setTimeout(() => { exitToHome(); }, 3000);
        }

        else if (msg.type === "welcome_pack") {
            setChatState(true);
            const list = document.getElementById("lobby-players-list");
            if(list) list.innerHTML = "";
            
            if (msg.config && msg.config.max) {
                roomMaxPlayers = parseInt(msg.config.max);
            }

            connectedPlayers.clear();
            if(msg.players) {
                Object.entries(msg.players).forEach(([pid, pname]) => {
                    connectedPlayers.add(pid);
                    addPlayerUI(pid, pname);
                });
            }
            updateOnlineCounter();

            const roomNameDisplay = msg.config.name || `Sala ${currentRoom}`;
            document.getElementById("display-room-name").innerText = `SALA: ${roomNameDisplay}`;
            
            const codeBadge = document.getElementById("badge-code-container");
            const codeText = document.getElementById("display-real-code");
            
            if (msg.is_owner) {
                codeText.innerText = currentRoom;
                codeBadge.classList.remove("hidden");
            } else {
                codeBadge.classList.add("hidden");
            }

            if(msg.config) {
                 const statusTxt = document.getElementById("lobby-status-text");
                 if(statusTxt) statusTxt.innerText = `Ciclos: ${msg.config.cycles} | Max: ${msg.config.max}`;
            }
            updateOwnerUI(msg.is_owner);
            if(sounds.bgm.paused && !isMuted) sounds.bgm.play().catch(()=>{});
        }

        else if (msg.type === "player_joined") {
            if (msg.id !== myId) {
                addPlayerUI(msg.id, msg.name);
                playSound('join'); 
            }
            connectedPlayers.add(msg.id);
            updateOnlineCounter();
            addSystemMessage(`${msg.name} entrou na sala.`);
        }

        else if (msg.type === "player_left") {
            removePlayerUI(msg.id);
            connectedPlayers.delete(msg.id);
            updateOnlineCounter();
            addSystemMessage("Um jogador saiu da sala.");
        }

        else if (msg.type === "chat_broadcast") {
            addChatMessage(msg.sender_name, msg.text, msg.sender_id === myId);
        }

        else if (msg.type === "debug_error") {
            console.group("🔥 ERRO CRÍTICO NO BACKEND");
            console.error("Motivo:", msg.message);
            console.warn("Dica: Verifique a conexão.");
            console.groupEnd();
        }

        else if (msg.type === "question_filled") {
            const data = msg.data;
            if (msg.remaining !== undefined) {
                const counterEl = document.getElementById("reroll-counter-val");
                if(counterEl) counterEl.innerText = msg.remaining;
            }
            document.getElementById("input-question").value = data.q;
            document.getElementById("input-opt-0").value = data.options[0];
            document.getElementById("input-opt-1").value = data.options[1];
            document.getElementById("input-opt-2").value = data.options[2];
            document.getElementById("input-opt-3").value = data.options[3];
            document.getElementById("input-correct").value = data.correct_idx;
            
            const btn = document.querySelector("#screen-creator button"); 
            if(btn) { btn.innerText = "🎲 GERAR PERGUNTA ALEATÓRIA"; btn.disabled = false; }
            showVisualFeedback("correct", "Gerado!", "Sucesso.");
        }

        else if (msg.type === "owner_changed") {
            showVisualFeedback("correct", "Novo Mestre!", `${msg.new_owner_name} assumiu.`);
            addSystemMessage(`${msg.new_owner_name} agora é o Dono da Sala.`);
            resetToLobby();
            updateOwnerUI(msg.new_owner_id === myId);
        }

        else if (msg.type === "new_turn") {
            stopMusic(); 
            resetScreens();
            setChatState(true);

            const counterEl = document.getElementById("reroll-counter-val");
            if(counterEl) counterEl.innerText = "5";

            if (msg.creator_id === myId) {
                iAmCreator = true;
                document.getElementById("screen-creator").classList.remove("hidden");
                startCreatorTimer();
            } else {
                iAmCreator = false;
                document.getElementById("screen-waiting").classList.remove("hidden");
                const waitMsg = document.getElementById("waiting-msg");
                if(waitMsg) waitMsg.innerText = `${msg.creator_name} está criando...`;
            }
        }

        else if (msg.type === "start_answering") {
            stopMusic(); 
            resetScreens();
            setChatState(false);
            currentRoundOptions = msg.options; 

            if (msg.creator_id === myId) {
                document.getElementById("screen-dashboard").classList.remove("hidden");
                const grid = document.getElementById("dashboard-grid");
                grid.innerHTML = "";
                Object.entries(msg.players_list).forEach(([pid, pname]) => {
                    if (pid !== myId) createDashboardCard(pid, pname, grid);
                });
                startDashboardTimer(30);
            } else {
                document.getElementById("screen-answering").classList.remove("hidden");
                document.getElementById("display-question").innerText = msg.q;
                const area = document.getElementById("options-area");
                area.innerHTML = "";
                msg.options.forEach((opt, index) => {
                    const btn = document.createElement("button");
                    btn.innerText = opt;
                    btn.onclick = () => sendAnswer(index);
                    area.appendChild(btn);
                });
                startTimer(30);
            }
        }

        else if (msg.type === "player_answered_update") {
            const card = document.getElementById(`status-card-${msg.player_id}`);
            if (card) {
                card.classList.remove("answering");
                if (msg.result === "correct") {
                    card.classList.add("done-correct");
                    card.querySelector(`#time-${msg.player_id}`).innerText = `✅ ${msg.time_taken}s`;
                    playSound('join'); 
                } else {
                    card.classList.add("done-wrong");
                    card.querySelector(`#time-${msg.player_id}`).innerText = `❌ ${msg.time_taken}s`;
                }
            }
        }

        else if (msg.type === "feedback") {
            const title = msg.title || (msg.result === "correct" ? "NA MOSCA!" : "NÃO FOI DESSA VEZ...");
            const subtitle = msg.subtitle || (msg.result === "correct" ? `+${msg.points} Pontos` : "Mais sorte na próxima!");

            if (msg.result === "correct") {
                console.log("✅ ACERTEI! amICorrect = true");
                amICorrect = true;
                document.getElementById("my-score").innerText = msg.total;
                playSound('correct', 1500); 
                showVisualFeedback("correct", title, subtitle);
            } else {
                console.log("❌ ERREI! amICorrect = false");
                amICorrect = false;
                playSound('wrong'); 
                showVisualFeedback("wrong", title, subtitle);
            }
        }

        else if (msg.type === "round_over") {
            clearInterval(timerInterval);
            stopTick(); 
            setChatState(true);
            
            if (msg.correct_idx !== undefined) {
                const correctText = currentRoundOptions[msg.correct_idx];
                const buttons = document.querySelectorAll("#options-area button");
                if (buttons.length > 0 && buttons[msg.correct_idx]) {
                    buttons[msg.correct_idx].classList.add("reveal-correct");
                }

                if (correctText && amICorrect === false && !iAmCreator) {
                    showVisualFeedback("wrong", "A resposta certa era...", correctText);
                    const overlay = document.getElementById("feedback-overlay");
                    const icon = document.getElementById("feedback-icon");
                    overlay.className = "feedback-overlay"; 
                    overlay.classList.add(`res-${msg.correct_idx}`); 
                    icon.innerText = "💡"; 
                    document.getElementById("feedback-title").innerText = "A resposta certa é...";
                }
            }

            setTimeout(() => {
                if (!document.getElementById("btn-start-game").classList.contains("hidden")) {
                    requestStartGame();
                }
            }, 5000);
        }

        else if (msg.type === "game_over") {
            resetScreens();
            setChatState(true);
            document.getElementById("screen-podium").classList.remove("hidden");
            const ranking = msg.ranking;
            fillPodium(ranking);
            document.getElementById("my-score").innerText = "0";
            stopMusic();
            playSound('win');
        }

        else if (msg.type === "reset_to_lobby") {
            resetScreens();

            document.getElementById("my-score").innerText = "0";

            document.getElementById("screen-lobby").classList.remove("hidden");
            if(sounds.bgm.paused && !isMuted) sounds.bgm.play().catch(()=>{});
        }
    };
}

function toggleChat() {
    const chat = document.getElementById("game-chat");
    const icon = document.getElementById("chat-toggle-icon");
    chat.classList.toggle("minimized");
    icon.innerText = chat.classList.contains("minimized") ? "▲" : "▼";
}

function handleChatKey(event) {
    if (event.key === "Enter") sendChatMessage();
}

function sendChatMessage() {
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;
    
    ws.send(JSON.stringify({ type: "chat_message", text: text }));
    input.value = "";
    input.focus();
}

function addChatMessage(sender, text, isMe) {
    const box = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "chat-msg" + (isMe ? " mine" : "");
    div.innerHTML = `<strong>${sender}:</strong> ${text}`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight; 
    if (!isMe) playSound('msg');
}

function addSystemMessage(text) {
    const box = document.getElementById("chat-messages");
    const div = document.createElement("div");
    div.className = "chat-msg system";
    div.innerText = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function updateOwnerUI(isOwner) {
    const startBtn = document.getElementById("btn-start-game");
    const playAgainBtn = document.getElementById("btn-play-again");
    const statusTxt = document.getElementById("lobby-status-text");

    if (isOwner) {
        if(startBtn) startBtn.classList.remove("hidden");
        if(statusTxt) statusTxt.innerText = "👑 Você é o Dono da Sala!";
    } else {
        if(startBtn) startBtn.classList.add("hidden");
        if(statusTxt) statusTxt.innerText = "Aguardando o Dono...";
    }

    if(playAgainBtn) {
        playAgainBtn.classList.remove("hidden");
    }
}

function addPlayerUI(id, name) {
    const list = document.getElementById("lobby-players-list");
    if(!list || document.getElementById(`player-tag-${id}`)) return;
    const div = document.createElement("div");
    div.id = `player-tag-${id}`;
    div.className = "player-tag";
    div.innerText = `👤 ${name}`;
    list.appendChild(div);
}

function removePlayerUI(id) {
    const el = document.getElementById(`player-tag-${id}`);
    if(el) el.remove();
}

function createDashboardCard(pid, pname, grid) {
    const card = document.createElement("div");
    card.id = `status-card-${pid}`;
    card.className = "player-status-card answering";
    card.innerHTML = `<span class="player-name-dash">${pname}</span><span class="player-time-dash" id="time-${pid}">...</span>`;
    grid.appendChild(card);
}

function fillPodium(ranking) {
    const set = (pos, data) => {
        const nameEl = document.getElementById(`podium-${pos}-name`);
        const scoreEl = document.getElementById(`podium-${pos}-score`);
        const bar = document.querySelector(`.podium-place.${pos === 1 ? 'first' : pos === 2 ? 'second' : 'third'} .bar`);
        if (data) {
            nameEl.innerText = data.name;
            scoreEl.innerText = `${data.score} PTS`;
            bar.style.opacity = "1";
        } else {
            nameEl.innerText = "-"; scoreEl.innerText = "";
            bar.style.opacity = "0.3";
        }
    };
    set(1, ranking[0]); set(2, ranking[1]); set(3, ranking[2]);
}

function askForTrivia() {
    const btn = document.querySelector("#screen-creator button");
    const categorySelect = document.getElementById("input-category");
    const selectedCategory = categorySelect ? categorySelect.value : "any";

    if(btn) { btn.innerText = "⏳ Traduzindo..."; btn.disabled = true; }
    
    ws.send(JSON.stringify({ 
        type: "generate_question", 
        category: selectedCategory 
    }));
    
    setTimeout(() => { if(btn) { btn.innerText = "🎲 GERAR PERGUNTA ALEATÓRIA"; btn.disabled = false; } }, 5000);
}

function playAgain() {
    const btn = document.getElementById("btn-play-again");
    if (btn) {
        btn.innerText = "Pedindo...";
        setTimeout(() => { btn.innerText = "Jogar Novamente 🔄"; }, 2000);
    }

    ws.send(JSON.stringify({ type: "request_play_again" }));
}

function resetToLobby() {
    resetScreens();
    document.getElementById("screen-lobby").classList.remove("hidden");
    document.querySelectorAll('.bar').forEach(b => b.style.opacity = '0');
    if(sounds.bgm.paused && !isMuted) sounds.bgm.play().catch(()=>{});
}

function requestStartGame() { ws.send(JSON.stringify({ type: "request_start" })); }

function submitQuestion() {
    const q = document.getElementById("input-question").value;
    const opts = [
        document.getElementById("input-opt-0").value, document.getElementById("input-opt-1").value,
        document.getElementById("input-opt-2").value, document.getElementById("input-opt-3").value
    ];
    const correct = document.getElementById("input-correct").value;
    
    if(!q || opts.some(o => !o)) {
        return showVisualFeedback("wrong", "Campos Vazios", "Preencha a pergunta e todas as opções!");
    }
    
    ws.send(JSON.stringify({ type: "submit_question", q: q, options: opts, correct_idx: correct }));
}

function sendAnswer(index) {
    ws.send(JSON.stringify({ type: "submit_answer", answer_idx: index }));
    document.getElementById("options-area").innerHTML = "<h3 style='color:#ccc; margin-top:20px'>Enviado... 🤞</h3>";
    clearInterval(timerInterval); 
    stopTick(); 
}

function resetScreens() {
    amICorrect = false; 
    stopCreatorTimer(); 

    document.getElementById("screen-home").classList.add("hidden");
    document.getElementById("screen-lobby").classList.add("hidden");
    document.getElementById("screen-creator").classList.add("hidden");
    document.getElementById("screen-waiting").classList.add("hidden");
    document.getElementById("screen-answering").classList.add("hidden");
    document.getElementById("screen-dashboard").classList.add("hidden");
    document.getElementById("screen-podium").classList.add("hidden");
    
    clearInterval(timerInterval);
    stopTick();
}

function startTimer(seconds) {
    let t = seconds;
    const el = document.getElementById("game-timer");
    if(el) el.innerText = t;
    
    clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        t--;
        if(el) el.innerText = t;
        if (t > 0) playSound('tick');
        if (t <= 0) {
            clearInterval(timerInterval);
            if(!document.getElementById("screen-answering").classList.contains("hidden")){
                 document.getElementById("options-area").innerHTML = "<h3>Tempo Esgotado! ⌛</h3>";
                 playSound('wrong'); 
            }
        }
    }, 1000);
}

function startDashboardTimer(seconds) {
    let t = seconds;
    const el = document.getElementById("dashboard-timer");
    if(el) el.innerText = t;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        t--;
        if(el) el.innerText = t;
        if (t <= 0) clearInterval(timerInterval);
    }, 1000);
}

function showVisualFeedback(type, title, subtitle) {
    const overlay = document.getElementById("feedback-overlay");
    const icon = document.getElementById("feedback-icon");
    const h2 = document.getElementById("feedback-title");
    const p = document.getElementById("feedback-subtitle");

    overlay.className = "feedback-overlay"; 
    
    if (type === "correct") {
        overlay.classList.add("correct");
        icon.innerText = "✅";
        h2.innerText = title || "Sucesso!";
    } else {
        overlay.classList.add("wrong");
        icon.innerText = "❌";
        h2.innerText = title || "Atenção!";
    }

    if(title) h2.innerText = title;
    p.innerText = subtitle || "";

    overlay.classList.remove("hidden");

    setTimeout(() => {
        overlay.classList.add("hidden");
    }, 2500);
}

function setupDraggableChat() {
    const chat = document.getElementById("game-chat");
    const header = document.querySelector(".chat-header");

    if (!chat || !header) return;

    let isDragging = false;
    let hasMoved = false;
    let startX, startY, initialLeft, initialTop;

    function dragStart(e) {
        if (e.target.id === 'chat-toggle-icon') return;

        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

        isDragging = true;
        hasMoved = false;
        startX = clientX;
        startY = clientY;

        const rect = chat.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        chat.style.bottom = "auto";
        chat.style.right = "auto";
        chat.style.left = initialLeft + "px";
        chat.style.top = initialTop + "px";
    }

    function dragMove(e) {
        if (!isDragging) return;
        if(e.type.includes('touch')) e.preventDefault(); 

        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

        const deltaX = clientX - startX;
        const deltaY = clientY - startY;

        if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
            hasMoved = true;
        }

        if (hasMoved) {
            let newLeft = initialLeft + deltaX;
            let newTop = initialTop + deltaY;

            const maxLeft = window.innerWidth - chat.offsetWidth;
            const maxTop = window.innerHeight - chat.offsetHeight;

            newLeft = Math.max(0, Math.min(newLeft, maxLeft));
            newTop = Math.max(0, Math.min(newTop, maxTop));

            chat.style.left = newLeft + "px";
            chat.style.top = newTop + "px";
        }
    }

    function dragEnd() {
        isDragging = false;
    }

    header.addEventListener("mousedown", dragStart);
    document.addEventListener("mousemove", dragMove);
    document.addEventListener("mouseup", dragEnd);

    header.addEventListener("touchstart", dragStart, { passive: false });
    document.addEventListener("touchmove", dragMove, { passive: false });
    document.addEventListener("touchend", dragEnd);

    header.addEventListener('click', (e) => {
        if (e.target.id === 'chat-toggle-icon') {
            toggleChat();
            return;
        }
        if (!hasMoved) {
            toggleChat();
        }
    });
}