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
    const UNICODE = {
        king: '♚\uFE0E', queen: '♛\uFE0E', rook: '♜\uFE0E', bishop: '♝\uFE0E', knight: '♞\uFE0E', pawn: '♟\uFE0E'
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

    // Main Click Handler (Unified)
    if (boardDiv) {
        boardDiv.addEventListener('mousedown', (e) => {
            if (!gameData || gameData.gameOver || !myColor) return;
            
            const rect = boardDiv.getBoundingClientRect();
            const cellSize = rect.width / 14;
            let rawX = Math.floor((e.clientX - rect.left) / cellSize);
            let rawY = Math.floor((e.clientY - rect.top) / cellSize);
            
            if (rawX < 0 || rawX > 13 || rawY < 0 || rawY > 13) return;
            handleCellClick(rawX, rawY);
        });
    }

    const btnQuick = document.getElementById('btn-quick-play');
    if (btnQuick) {
        btnQuick.addEventListener('click', () => {
            let name = saveName();
            socket.emit('join_queue', { username: name, flag: 'us' });
            showScreen('lobby-screen');
        });
    }

    // Other buttons...
    const btnCancel = document.getElementById('btn-cancel-queue');
    if(btnCancel) btnCancel.addEventListener('click', () => location.reload());
    const btnBackLobby = document.getElementById('btn-back-to-lobby');
    if(btnBackLobby) btnBackLobby.addEventListener('click', () => location.reload());
    const btnLeaderboard = document.getElementById('btn-leaderboard');
    if(btnLeaderboard) btnLeaderboard.addEventListener('click', () => socket.emit('get_leaderboard'));
    window.handleResign = () => {
        console.log("4CHESS: handleResign triggered!");
        if (confirm("Are you sure you want to resign and leave?")) {
            console.log("4CHESS: Resign confirmed, emitting...");
            socket.emit('resign');
            alert("Resigned! Returning to lobby.");
            location.reload();
        }
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
        if(chatWidget) chatWidget.classList.toggle('chat-open');
    });
    if(chatClose) chatClose.addEventListener('click', () => {
        if(chatWidget) chatWidget.classList.remove('chat-open');
    });

    // Socket Events
    socket.on('queue_update', (data) => {
        let qs = document.getElementById('queue-status');
        if(qs) qs.innerText = `Matchmaking: ${data.count}/4 Players`;
        let ts = document.getElementById('timer-status');
        if(ts) ts.innerText = (data.secondsLeft !== undefined ? data.secondsLeft : 15) + 's';
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
        initUI();
        showScreen('game-container');
    });

    socket.on('init_state', (state) => { if (state.roomId && state.roomId !== currentRoomId) return; syncState(state); });
    socket.on('state_update', (state) => { if (state.roomId && state.roomId !== currentRoomId) return; syncState(state); });

    function syncState(state) {
        if (!gameData) gameData = {};
        if (state.board) gameData.board = state.board;
        if (state.turnIndex !== undefined) gameData.turnIndex = state.turnIndex;
        if (state.scores) playerScoresMap = state.scores;
        if (state.activePlayers) playerActiveMap = state.activePlayers;
        if (state.playerNames) playerNamesMap = state.playerNames;
        if (state.gameOver !== undefined) gameData.gameOver = state.gameOver;
        if (state.winner !== undefined) gameData.winner = state.winner;
        if (state.lastMove !== undefined) gameData.lastMove = state.lastMove;
        if (state.turnEndTime !== undefined) turnEndTime = state.turnEndTime;
        if (statusText && !gameData.gameOver) statusText.innerText = '';
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
                }
                boardDiv.appendChild(cell);
                rowDOM.push(cell);
            }
            cellsDOM.push(rowDOM);
        }
    }

    function handleCellClick(x, y) {
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
                    pDiv.innerText = UNICODE[p.type];
                    pDiv.style.setProperty('--rot', `rotate(${-boardRotation}deg)`);
                    pDiv.style.left = `calc(var(--cell-size) * ${x})`;
                    pDiv.style.top = `calc(var(--cell-size) * ${y})`;
                    pDiv.classList.toggle('playable', myColor && p.color === myColor && CHESS_COLORS[gameData.turnIndex] === myColor && !gameData.gameOver);
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

        // Panel updates...
        let turnColor = CHESS_COLORS[gameData.turnIndex];
        let turnName = playerNamesMap[turnColor] || COLOR_NAMES[turnColor];
        const turnNameDOM = document.getElementById('turn-player-name');
        if (turnNameDOM) {
            turnNameDOM.innerText = turnName;
            const webColors = { white: '#22c55e', blue: '#60a5fa', black: '#94a3b8', red: '#f87171' };
            turnNameDOM.style.color = webColors[turnColor] || 'white';
        }
        CHESS_COLORS.forEach(c => {
            let pos = panelMap[c];
            let pnl = document.getElementById(`panel-screen-${pos}`);
            if(!pnl) return;
            pnl.dataset.color = c;
            pnl.classList.toggle('active-panel', turnColor === c && !gameData.gameOver);
            pnl.style.opacity = playerActiveMap[c] === false ? '0.4' : '1';
            pnl.querySelector('.player-name').innerText = playerNamesMap[c] || COLOR_NAMES[c];
            pnl.querySelector('.player-score').innerText = `Score: ${playerScoresMap[c] || 0}`;
            pnl.querySelector('.player-status').innerText = playerActiveMap[c] === false ? 'ELIMINATED' : (turnColor === c ? 'Thinking...' : 'Waiting');
        });

        if (gameData.gameOver) {
            let w = gameData.winner;
            let wt = document.getElementById('winner-text');
            if(wt) wt.innerText = w ? `Winner: ${playerNamesMap[w]}!` : "Draw!";
            let gom = document.getElementById('game-over-modal');
            if(gom) gom.classList.remove('hidden');
            if(btnResign) btnResign.classList.add('hidden');
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
            if (bl > 0 && btnQuick) { btnQuick.innerText = `Banned (${bl}s)`; btnQuick.disabled = true; btnQuick.style.opacity = '0.5'; }
            else if(btnQuick) { btnQuick.innerText = `Quick Play`; btnQuick.disabled = false; btnQuick.style.opacity = '1'; bannedUntil = 0; }
        }
        requestAnimationFrame(loop);
    }
    loop();

    socket.on('chat_msg', (data) => {
        if (data.roomId && data.roomId !== currentRoomId) return;
        let div = document.createElement('div');
        div.className = 'chat-entry';
        div.innerHTML = `<strong class="chat-${data.color}">${data.name}:</strong> <span>${data.text}</span>`;
        if(chatMessages) { chatMessages.appendChild(div); chatMessages.scrollTop = chatMessages.scrollHeight; }
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

    console.log("4CHESS: UI Initialization complete.");
});
