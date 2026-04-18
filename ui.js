// Defensive Initialization
window.addEventListener('DOMContentLoaded', () => {
    console.log("4CHESS: UI Initialization started...");
    
    let socket;
    try {
        socket = io();
    } catch (e) {
        console.error("4CHESS: Socket.io failed to initialize!", e);
        return;
    }

    let currentRoomId = null;
    const ICONS = {
        king: 'fa-chess-king', queen: 'fa-chess-queen', rook: 'fa-chess-rook', bishop: 'fa-chess-bishop', knight: 'fa-chess-knight', pawn: 'fa-chess-pawn'
    };
    const CHESS_COLORS = ['white', 'blue', 'black', 'red'];
    const COLOR_NAMES = { white: 'Green', blue: 'Blue', black: 'Black', red: 'Red' };

    let gameData = null; 
    let myColor = null; 
    let selectedCell = null;
    let validMovesForSelected = [];
    let cellsDOM = [];
    let playerNamesMap = {};
    let playerScoresMap = {};
    let playerActiveMap = {};
    let turnEndTime = 0;
    let bannedUntil = 0;
    let boardRotation = 0;
    let panelMap = { white: 'bottom', black: 'top', blue: 'left', red: 'right' };

    const boardDiv = document.getElementById('chess-board');
    const indicator = document.getElementById('turn-indicator');
    const statusText = document.getElementById('game-status-text');
    const turnTimerDOM = document.getElementById('turn-timer-visual');
    const usernameInput = document.getElementById('username-input');
    const chatInput = document.getElementById('chat-input');
    const btnSendChat = document.getElementById('btn-send-chat');
    const chatMessages = document.getElementById('chat-messages');
    const chatToggle = document.getElementById('chat-toggle-btn');
    const chatWidget = document.getElementById('chat-widget');
    const chatClose = document.getElementById('chat-close-btn');

    if (!usernameInput) return;

    // Persistence
    try {
        const savedUsername = localStorage.getItem('4chess_username');
        if (savedUsername) {
            usernameInput.value = savedUsername;
        } else {
            usernameInput.value = 'Player_' + Math.random().toString(36).substring(7).toUpperCase();
        }
    } catch (e) {
        usernameInput.value = 'Player_' + Math.floor(Math.random()*9999);
    }

    function saveName() {
        let name = usernameInput.value.trim() || 'Guest';
        if (name !== 'Guest' && name.length < 6) {
            alert("Nickname must be at least 6 characters long.");
            return null;
        }
        try { localStorage.setItem('4chess_username', name); } catch(e) {}
        return name;
    }

    function showScreen(id) {
        const screens = ['login-screen', 'lobby-screen', 'game-container'];
        screens.forEach(s => {
            let el = document.getElementById(s);
            if(el) el.classList.add('hidden');
        });
        let target = document.getElementById(id);
        if(target) target.classList.remove('hidden');
    }

    if (btnQuick) {
        btnQuick.addEventListener('click', () => {
            if (window.audio) window.audio.unlock();
            let name = saveName();
            if (!name) return;
            socket.emit('join_queue', { username: name, flag: 'us' });
            showScreen('lobby-screen');
        });
    }

    const btnCreate = document.getElementById('btn-create-room');
    if (btnCreate) {
        btnCreate.addEventListener('click', () => {
            if (window.audio) window.audio.unlock();
            let name = saveName();
            if (!name) return;
            socket.emit('create_room', { name, flag: 'us' });
            showScreen('lobby-screen');
        });
    }

    const btnJoinPrompt = document.getElementById('btn-join-room-prompt');
    if (btnJoinPrompt) {
        btnJoinPrompt.addEventListener('click', () => {
            if (window.audio) window.audio.unlock();
            document.getElementById('join-room-container').classList.toggle('hidden');
        });
    }

    // Other buttons...
    const btnCancel = document.getElementById('btn-cancel-queue');
    if(btnCancel) btnCancel.addEventListener('click', () => location.reload());
    const btnBackLobby = document.getElementById('btn-back-to-lobby');
    if(btnBackLobby) btnBackLobby.addEventListener('click', () => location.reload());
    const btnBackLobbyGameOver = document.getElementById('btn-back-to-lobby-gameover');
    if(btnBackLobbyGameOver) btnBackLobbyGameOver.addEventListener('click', () => location.reload());
    const btnLeaderboard = document.getElementById('btn-leaderboard');
    if(btnLeaderboard) btnLeaderboard.addEventListener('click', () => socket.emit('get_leaderboard'));
    window.handleResign = () => {
        console.log("4CHESS: handleResign triggered!");
        // Simplified for reliability across browser environments
        console.log("4CHESS: Resign emitting...");
        socket.emit('resign');
        setTimeout(() => {
            location.reload();
        }, 500);
    };
    const btnResign = document.getElementById('btn-resign');
    if(btnResign) {
        btnResign.onclick = window.handleResign;
        console.log("4CHESS: Resign listener attached via onclick.");
    }

    function sendChat() {
        if (!chatInput || !socket) return;
        let text = chatInput.value.trim();
        if (text) {
            console.log("Sending chat:", text);
            socket.emit('chat_msg', { text });
            chatInput.value = '';
        }
    }

    if(btnSendChat) btnSendChat.addEventListener('click', sendChat);
    if(chatInput) chatInput.addEventListener('keypress', (e) => {
        if(e.key === 'Enter') sendChat();
    });

    if(chatToggle) chatToggle.addEventListener('click', () => {
        if(chatWidget) {
            chatWidget.classList.toggle('chat-open');
            if(chatWidget.classList.contains('chat-open')) {
                chatToggle.classList.remove('has-unread');
            }
        }
    });
    if(chatClose) chatClose.addEventListener('click', () => {
        if(chatWidget) chatWidget.classList.remove('chat-open');
    });

    // Socket Events
    socket.on('queue_update', (data) => {
        let qs = document.getElementById('queue-status');
        if(qs) qs.innerText = `Matchmaking: ${data.count}/4 Players`;
        let ts = document.getElementById('timer-status');
        if(ts) ts.innerText = (data.secondsLeft !== undefined ? data.secondsLeft : 5) + 's';
    });

    socket.on('ban_status', (data) => {
        bannedUntil = data.until;
        console.log("Ban status received:", data);
    });

    socket.on('match_found', (data) => {
        myColor = data.color;
        currentRoomId = data.roomId;
        playerNamesMap = data.playerNames || {};
        
        if (myColor === 'black') boardRotation = 180;
        else if (myColor === 'blue') boardRotation = 270;
        else if (myColor === 'red') boardRotation = 90;
        else boardRotation = 0;

        if (boardRotation === 0) panelMap = { white: 'bottom', black: 'top', blue: 'left', red: 'right' };
        else if (boardRotation === 180) panelMap = { black: 'bottom', white: 'top', red: 'left', blue: 'right' };
        else if (boardRotation === 270) panelMap = { blue: 'bottom', red: 'top', black: 'left', white: 'right' };
        else if (boardRotation === 90) panelMap = { red: 'bottom', blue: 'top', white: 'left', black: 'right' };

        if(boardDiv) boardDiv.style.transform = `rotate(${boardRotation}deg)`;
        const ct = document.getElementById('chat-toggle-btn');
        if(ct) ct.classList.remove('hidden');
        initUI();
        showScreen('game-container');
    });

    socket.on('init_state', (state) => { if (state.roomId && state.roomId !== currentRoomId) return; syncState(state); });
    socket.on('state_update', (state) => { if (state.roomId && state.roomId !== currentRoomId) return; syncState(state); });

    function syncState(state) {
        if (!gameData) gameData = {};
        
        let moveChanged = false;
        if (state.lastMove && (!gameData.lastMove || 
            state.lastMove.fx !== gameData.lastMove.fx || 
            state.lastMove.fy !== gameData.lastMove.fy ||
            state.lastMove.tx !== gameData.lastMove.tx ||
            state.lastMove.ty !== gameData.lastMove.ty)) {
            moveChanged = true;
        }

        if (state.board) gameData.board = state.board;
        if (state.turnIndex !== undefined) gameData.turnIndex = state.turnIndex;
        if (state.scores) playerScoresMap = state.scores;
        if (state.activePlayers) playerActiveMap = state.activePlayers;
        if (state.playerNames) playerNamesMap = state.playerNames;
        if (state.playerAvatars) gameData.playerAvatars = state.playerAvatars;
        if (state.gameOver !== undefined) gameData.gameOver = state.gameOver;
        if (state.winner !== undefined) gameData.winner = state.winner;
        if (state.lastMove !== undefined) gameData.lastMove = state.lastMove;
        if (state.turnEndTime !== undefined) turnEndTime = state.turnEndTime;
        if (statusText && !gameData.gameOver) statusText.innerText = '';

        if (moveChanged && window.audio) {
            if (state.gameOver) window.audio.playGameOver();
            else if (state.check) window.audio.playCheck();
            else if (state.capture) window.audio.playCapture();
            else window.audio.playMove();
        }

        updateUI();
    }

    function inBounds(x, y) {
        if (x < 3 && y < 3 || x > 10 && y < 3 || x < 3 && y > 10 || x > 10 && y > 10) return false;
        return x >= 0 && x <= 13 && y >= 0 && y <= 13;
    }

    function initUI() {
        cellsDOM = [];
        if(!boardDiv) return;
        boardDiv.innerHTML = '';
        for (let y = 0; y < 14; y++) {
            let rowDOM = [];
            for (let x = 0; x < 14; x++) {
                let cell = document.createElement('div');
                cell.classList.add('cell');
                if (!inBounds(x, y)) {
                    cell.classList.add('dead');
                } else {
                    cell.classList.add((x + y) % 2 === 0 ? 'light' : 'dark');
                    // DIRECT CELL CLICK LISTENER (Robust against rotation)
                    cell.addEventListener('mousedown', () => {
                        if (!gameData || gameData.gameOver || !myColor) return;
                        handleCellClick(x, y);
                    });
                }
                boardDiv.appendChild(cell);
                rowDOM.push(cell);
            }
            cellsDOM.push(rowDOM);
        }
    }

    function handleCellClick(x, y) {
        if (window.audio) window.audio.unlock();
        console.log("Clicked:", x, y, "Turn Index:", gameData.turnIndex, "My Color:", myColor);
        
        let turnColor = CHESS_COLORS[gameData.turnIndex];
        if (turnColor !== myColor) {
            console.log("NOT YOUR TURN");
            return;
        }

        if (selectedCell) {
            let move = validMovesForSelected.find(m => m.x === x && m.y === y);
            if (move) {
                socket.emit('make_move', { fx: selectedCell.x, fy: selectedCell.y, tx: x, ty: y });
                selectedCell = null; validMovesForSelected = []; updateUI();
                return;
            }
        }

        let piece = gameData.board[y][x].piece;
        if (piece && piece.color === myColor) {
            selectedCell = { x, y };
            if (typeof GameEngine !== 'undefined') {
                let engine = new GameEngine();
                engine.board = gameData.board; engine.activePlayers = playerActiveMap;
                validMovesForSelected = engine.getValidMoves(x, y);
                console.log("Valid moves count:", validMovesForSelected.length);
            }
        } else {
            selectedCell = null; validMovesForSelected = [];
        }
        updateUI();
    }

    function updateUI() {
        if (!gameData || !gameData.board) return;
        
        // Clear highlights
        document.querySelectorAll('.cell').forEach(c => c.classList.remove('selected', 'highlight-move', 'has-enemy', 'last-move'));
        
        // Update pieces
        let activePieceIds = new Set();
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 14; x++) {
                if (!inBounds(x, y)) continue;
                let p = gameData.board[y][x].piece;
                if (p) {
                    let pid = p.id || `p_${x}_${y}`;
                    activePieceIds.add(pid);
                    let pDiv = document.getElementById('piece-' + pid);
                    if (!pDiv) {
                        pDiv = document.createElement('div');
                        pDiv.id = 'piece-' + pid;
                        pDiv.className = `piece ${p.color}`;
                        pDiv.style.pointerEvents = 'none'; // CRITICAL: So clicks fall through to BoardDiv
                        boardDiv.appendChild(pDiv);
                    }
                    pDiv.innerHTML = `<i class="fa-solid ${ICONS[p.type]}"></i>`;
                    // Correct piece rotation logic
                    let pieceRot = 0;
                    if (boardRotation === 90) pieceRot = 270;
                    else if (boardRotation === 180) pieceRot = 180;
                    else if (boardRotation === 270) pieceRot = 90;
                    
                    pDiv.style.setProperty('--rot', `rotate(${pieceRot}deg)`);
                    pDiv.style.left = `calc(var(--cell-size) * ${x})`;
                    pDiv.style.top = `calc(var(--cell-size) * ${y})`;
                    pDiv.classList.toggle('playable', myColor && p.color === myColor && CHESS_COLORS[gameData.turnIndex] === myColor && !gameData.gameOver);
                    
                    // ELIMINATED PIECE LOGIC
                    let isEliminated = playerActiveMap[p.color] === false;
                    pDiv.classList.toggle('eliminated-piece', isEliminated);
                }
            }
        }
        document.querySelectorAll('.piece').forEach(el => {
            if (!activePieceIds.has(el.id.replace('piece-', ''))) el.remove();
        });

        // Apply visual states to cells
        if (selectedCell) cellsDOM[selectedCell.y][selectedCell.x].classList.add('selected');
        validMovesForSelected.forEach(m => {
            cellsDOM[m.y][m.x].classList.add('highlight-move');
            if (m.capture) cellsDOM[m.y][m.x].classList.add('has-enemy');
        });
        
        if (gameData.lastMove) {
            let lm = gameData.lastMove;
            if (inBounds(lm.fx, lm.fy)) cellsDOM[lm.fy][lm.fx].classList.add('last-move');
            if (inBounds(lm.tx, lm.ty)) cellsDOM[lm.ty][lm.tx].classList.add('last-move');
        }

        // New HUD Render (Vertical List in Top-Left)
        const playerList = document.getElementById('player-list-container');
        if (playerList) {
            playerList.innerHTML = '';
            CHESS_COLORS.forEach(c => {
                let isTurn = gameData && turnColor === c && !gameData.gameOver;
                const pColors = { white: '#22c55e', blue: '#3b82f6', black: '#94a3b8', red: '#ef4444' };
                const currentColor = pColors[c] || '#fbbf24';
                const playerAvatar = gameData.playerAvatars ? gameData.playerAvatars[c] : null;
                
                const item = document.createElement('div');
                item.className = 'player-item';
                if (isTurn) item.classList.add('active-turn');
                if (playerActiveMap[c] === false) item.classList.add('eliminated');
                item.style.color = currentColor;

                item.innerHTML = `
                    ${playerAvatar ? `<img src="${playerAvatar}" style="width:14px; height:14px; border-radius:50%; margin-right:8px;">` : `<div class="player-dot" style="background-color: ${currentColor}"></div>`}
                    <div class="player-info-meta">
                        <span class="player-name-text">${playerNamesMap[c] || '...'}</span>
                        <span class="player-score-text">${playerScoresMap[c] || 0}P</span>
                    </div>
                `;
                playerList.appendChild(item);
            });
        }

        // Your Turn Alert
        const alertBox = document.getElementById('your-turn-alert');
        if (alertBox) {
            const isMyTurn = myColor && turnColor === myColor && !gameData.gameOver;
            if (isMyTurn) {
                const myColors = { white: '#22c55e', blue: '#3b82f6', black: '#000', red: '#ef4444' };
                alertBox.style.backgroundColor = myColors[myColor] || '#10b981';
                alertBox.style.display = 'block';
            } else {
                alertBox.style.display = 'none';
            }
        }

        if (gameData.gameOver) {
            // Re-show simplified overlay if needed or handled in style
            if(btnResign) btnResign.classList.add('hidden');
            const ct = document.getElementById('chat-toggle-btn');
            if(ct) ct.classList.add('hidden');

            const goMod = document.getElementById('game-over-modal');
            if (goMod && goMod.classList.contains('hidden')) {
                goMod.classList.remove('hidden');
                
                const scoresArr = Object.entries(playerScoresMap).sort((a,b)=>b[1]-a[1]);
                let winColor = scoresArr.length > 0 ? scoresArr[0][0] : 'white';
                if (gameData.winner && gameData.winner !== 'draw') winColor = gameData.winner;
                
                const pColors = { white: '#22c55e', blue: '#3b82f6', black: '#94a3b8', red: '#ef4444' };
                const hexColor = pColors[winColor] || '#facc15';

                const winFrame = document.getElementById('winner-frame-container');
                if (winFrame) winFrame.style.borderColor = hexColor;

                const rankBox = document.getElementById('game-over-rankings');
                if (rankBox) {
                    rankBox.innerHTML = '';
                    scoresArr.forEach(([c, s], idx) => {
                        let rankHtml = document.createElement('div');
                        rankHtml.className = 'rank-item';
                        rankHtml.innerHTML = `<span>${idx+1}. <span style="color:${pColors[c]||'#fff'}">${playerNamesMap[c] || c}</span></span> <span><span style="color:#facc15">${s}</span>P</span>`;
                        rankBox.appendChild(rankHtml);
                    });
                }

                const winTxt = document.getElementById('game-over-winner');
                if (winTxt) {
                    if (gameData.winner === 'draw') {
                        winTxt.innerText = "DRAW";
                        winTxt.style.color = '#fff';
                    } else {
                        winTxt.innerText = `WINNER: ${playerNamesMap[winColor] || winColor}`;
                        winTxt.style.color = hexColor;
                    }
                }

                const fwTimer = setInterval(() => {
                    const fwContainer = document.getElementById('fireworks-container');
                    if (!fwContainer || goMod.classList.contains('hidden')) return clearInterval(fwTimer);
                    for (let i = 0; i < 20; i++) {
                        let f = document.createElement('div');
                        f.className = 'firework';
                        f.style.background = hexColor;
                        f.style.left = (Math.random() * 100) + 'vw';
                        f.style.top = (Math.random() * 50 + 50) + 'vh';
                        f.style.setProperty('--ty', `-${Math.random() * 300 + 100}px`);
                        fwContainer.appendChild(f);
                        setTimeout(() => f.remove(), 1000);
                    }
                }, 400);
            }
        } else if (myColor && btnResign) {
            btnResign.classList.remove('hidden');
        }
    }

    function loop() {
        if (turnEndTime > 0 && (!gameData || !gameData.gameOver)) {
            let left = Math.ceil((turnEndTime - Date.now()) / 1000);
            if(turnTimerDOM) turnTimerDOM.innerText = `⏳ ${left > 0 ? left : 0}s`;
        }
        if (bannedUntil > 0) {
            let bl = Math.ceil((bannedUntil - Date.now()) / 1000);
            if (bl > 0) {
                if (btnQuick) { btnQuick.innerText = `Banned (${bl}s)`; btnQuick.disabled = true; btnQuick.style.opacity = '0.5'; }
                if (btnCreate) { btnCreate.innerText = `Banned (${bl}s)`; btnCreate.disabled = true; btnCreate.style.opacity = '0.5'; }
                const btnJoin = document.getElementById('btn-join-room-prompt');
                if (btnJoin) { btnJoin.innerText = `Banned`; btnJoin.disabled = true; btnJoin.style.opacity = '0.5'; }
            } else {
                if (btnQuick) { btnQuick.innerText = `Quick Play`; btnQuick.disabled = false; btnQuick.style.opacity = '1'; }
                if (btnCreate) { btnCreate.innerText = `Create Room`; btnCreate.disabled = false; btnCreate.style.opacity = '1'; }
                const btnJoin = document.getElementById('btn-join-room-prompt');
                if (btnJoin) { btnJoin.innerText = `Join Room`; btnJoin.disabled = false; btnJoin.style.opacity = '1'; }
                bannedUntil = 0;
            }
        }
        requestAnimationFrame(loop);
    }
    loop();

    socket.on('chat_msg', (data) => {
        if (data.roomId && data.roomId !== currentRoomId) return;
        let div = document.createElement('div');
        div.className = 'chat-entry';
        div.innerHTML = `<strong class="chat-${data.color}">${data.name}:</strong> <span>${data.text}</span>`;
        if(chatMessages) { 
            chatMessages.appendChild(div); 
            chatMessages.scrollTop = chatMessages.scrollHeight; 
        }

        // UNREAD NOTIFICATION LOGIC
        if (chatWidget && !chatWidget.classList.contains('chat-open')) {
            if (chatToggle) chatToggle.classList.add('has-unread');
        }
    });

    socket.on('leaderboard_res', (list) => {
        let div = document.getElementById('leaderboard-list');
        if(!div) return;
        div.innerHTML = list.length === 0 ? 'No champions yet.' : '';
        list.forEach((item, index) => {
            let row = document.createElement('div');
            row.style.padding = "10px"; row.style.borderBottom = "1px solid #1e293b";
            row.innerHTML = `<strong>${index+1}.</strong> ${item.name} - <span style="color:#eab308">${item.score}P</span>`;
            div.appendChild(row);
        });
        let mod = document.getElementById('leaderboard-modal');
        if(mod) mod.classList.remove('hidden');
    });

    // Global Unlock for Mobile
    document.addEventListener('touchstart', () => {
        if (window.audio) window.audio.unlock();
    }, { once: true });

    console.log("4CHESS: UI Initialization complete.");
});
