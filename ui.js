const socket = io();

const audioMove = new Audio('https://upload.wikimedia.org/wikipedia/commons/4/43/Chess_move.ogg');
const audioCapture = new Audio('https://upload.wikimedia.org/wikipedia/commons/e/e0/Chess_capture.ogg');
const audioEnd = new Audio('https://upload.wikimedia.org/wikipedia/commons/d/d4/Chess_checkmate.ogg');

let soundEnabled = true;


const UNICODE = {
    king: '♚\uFE0E', queen: '♛\uFE0E', rook: '♜\uFE0E', bishop: '♝\uFE0E', knight: '♞\uFE0E', pawn: '♟\uFE0E'
};

const TR_COLORS = {
    white: 'Beyaz', blue: 'Mavi', black: 'Siyah', red: 'Kırmızı'
};

let game = null; 
let myColor = null; 
let selectedCell = null;
let validMovesForSelected = [];
let cellsDOM = [];
let playerNamesMap = {};
let playerFlagsMap = {};
let turnEndTime = 0;
let boardRotation = 0;
let panelMap = { white: 'bottom', black: 'top', blue: 'left', red: 'right' };

const ALL_FLAGS = [
    {code: 'tr', name: 'Türkiye'}, {code: 'az', name: 'Azerbaycan'}, {code: 'us', name: 'ABD'},
    {code: 'de', name: 'Almanya'}, {code: 'ar', name: 'Arjantin'}, {code: 'au', name: 'Avustralya'},
    {code: 'at', name: 'Avusturya'}, {code: 'ae', name: 'BAE'}, {code: 'be', name: 'Belçika'}, 
    {code: 'gb', name: 'Birleşik Krallık'}, {code: 'br', name: 'Brezilya'}, {code: 'bg', name: 'Bulgaristan'}, 
    {code: 'dz', name: 'Cezayir'}, {code: 'cn', name: 'Çin'}, {code: 'dk', name: 'Danimarka'}, 
    {code: 'id', name: 'Endonezya'}, {code: 'ma', name: 'Fas'}, {code: 'ps', name: 'Filistin'}, 
    {code: 'fi', name: 'Finlandiya'}, {code: 'fr', name: 'Fransa'}, {code: 'za', name: 'Güney Afrika'}, 
    {code: 'kr', name: 'Güney Kore'}, {code: 'in', name: 'Hindistan'}, {code: 'nl', name: 'Hollanda'}, 
    {code: 'iq', name: 'Irak'}, {code: 'ir', name: 'İran'}, {code: 'es', name: 'İspanya'}, 
    {code: 'se', name: 'İsveç'}, {code: 'ch', name: 'İsviçre'}, {code: 'it', name: 'İtalya'}, 
    {code: 'jp', name: 'Japonya'}, {code: 'ca', name: 'Kanada'}, {code: 'kz', name: 'Kazakistan'}, 
    {code: 'my', name: 'Malezya'}, {code: 'mx', name: 'Meksika'}, {code: 'eg', name: 'Mısır'}, 
    {code: 'no', name: 'Norveç'}, {code: 'pk', name: 'Pakistan'}, {code: 'pl', name: 'Polonya'}, 
    {code: 'ro', name: 'Romanya'}, {code: 'ru', name: 'Rusya'}, {code: 'sg', name: 'Singapur'}, 
    {code: 'sy', name: 'Suriye'}, {code: 'sa', name: 'Suudi Arabistan'}, {code: 'ua', name: 'Ukrayna'}, 
    {code: 'gr', name: 'Yunanistan'}
];

function getFlagEmoji(countryCode) {
  const codePoints = countryCode.toUpperCase().split('').map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

const boardDiv = document.getElementById('chess-board');
const indicator = document.getElementById('turn-indicator');
const statusText = document.getElementById('game-status-text');
const turnTimerDOM = document.getElementById('turn-timer-visual');

const usernameInput = document.getElementById('username-input');
const flagSelect = document.getElementById('flag-select');

// Flag options populate
ALL_FLAGS.forEach(f => {
    let opt = document.createElement('option');
    opt.value = f.code;
    opt.innerText = `${getFlagEmoji(f.code)} ${f.name}`;
    flagSelect.appendChild(opt);
});

// Daha önce giriş yapmış mı kontrol et
const savedUsername = localStorage.getItem('4chess_username');
const savedFlag = localStorage.getItem('4chess_flag');
if (savedUsername) {
    usernameInput.value = savedUsername;
}
if (savedFlag) {
    flagSelect.value = savedFlag;
}

function getNameAndFlag() {
    let name = usernameInput.value.trim();
    if (name === '') name = 'İsimsiz' + Math.floor(Math.random()*100);
    let flag = flagSelect.value;
    localStorage.setItem('4chess_username', name);
    localStorage.setItem('4chess_flag', flag);
    return { name, flag };
}

document.getElementById('btn-quick-play').addEventListener('click', () => {
    let credentials = getNameAndFlag();
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
    socket.emit('join_queue', { username: credentials.name, flag: credentials.flag });
});

document.getElementById('btn-create-room').addEventListener('click', () => {
    let credentials = getNameAndFlag();
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
    credentials.teamMode = document.getElementById('chk-team-mode').checked;
    socket.emit('create_room', credentials);
});

document.getElementById('btn-join-room-prompt').addEventListener('click', () => {
    document.getElementById('join-room-container').classList.toggle('hidden');
});

document.getElementById('btn-join-room').addEventListener('click', () => {
    let code = document.getElementById('room-code-input').value.trim();
    if(code.length === 4) {
        let credentials = getNameAndFlag();
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('lobby-screen').classList.remove('hidden');
        socket.emit('join_room', { code: code, ...credentials });
    } else {
        alert("Geçersiz Oda Kodu!");
    }
});

socket.on('custom_room_joined', (data) => {
    document.getElementById('queue-status').innerText = `Oda: ${data.code} | Oyuncular: ${data.count} / 4`;
    document.getElementById('timer-status').innerText = 'Bekleniyor...';
});

socket.on('room_error', (msg) => {
    alert(msg);
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
});

socket.on('queue_update', (data) => {
    document.getElementById('queue-status').innerText = `Koltuklar Doluyor: ${data.count} / ${data.max}`;
    let timerDiv = document.getElementById('timer-status');
    if (data.count === 0) {
        timerDiv.innerText = '';
    } else {
        let sc = data.secondsLeft < 10 ? '0'+data.secondsLeft : data.secondsLeft;
        timerDiv.innerText = `00:${sc}`;
    }
});

socket.on('match_found', (data) => {
    myColor = data.color;
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-container').classList.remove('hidden');
    document.title = `4CHESS - ${TR_COLORS[myColor]}`;
    
    if (myColor === 'white' || !myColor) {
        boardRotation = 0;
        panelMap = { white: 'bottom', black: 'top', blue: 'left', red: 'right' };
    } else if (myColor === 'black') {
        boardRotation = 180;
        panelMap = { black: 'bottom', white: 'top', red: 'left', blue: 'right' };
    } else if (myColor === 'blue') {
        boardRotation = 270;
        panelMap = { blue: 'bottom', red: 'top', black: 'left', white: 'right' };
    } else if (myColor === 'red') {
        boardRotation = 90;
        panelMap = { red: 'bottom', blue: 'top', white: 'left', black: 'right' };
    }

    boardDiv.style.transform = `rotate(${boardRotation}deg)`;
    initUI(); 
});

socket.on('init_state', (state) => {
    game = state; 
    playerNamesMap = state.playerNames;
    playerFlagsMap = state.playerFlags || {};
    syncState(state);
});

socket.on('state_update', (state) => {
    syncState(state);
});

function syncState(state) {
    game.board = state.board;
    game.turnIndex = state.turnIndex;
    game.scores = state.scores;
    game.activePlayers = state.activePlayers;
    game.gameOver = state.gameOver;
    game.winner = state.winner;
    playerNamesMap = state.playerNames;
    playerFlagsMap = state.playerFlags || {};
    turnEndTime = state.turnEndTime || 0;
    game.teamMode = state.teamMode || false;
    
    if (state.lastMove !== undefined) {
        game.lastMove = state.lastMove;
    }
    
    selectedCell = null;
    validMovesForSelected = [];
    updateUI();
}

function inBounds(x, y) {
    if (x < 3 && y < 3) return false;
    if (x > 10 && y < 3) return false;
    if (x < 3 && y > 10) return false;
    if (x > 10 && y > 10) return false;
    return x >= 0 && x <= 13 && y >= 0 && y <= 13;
}

function initUI() {
    cellsDOM = [];
    boardDiv.innerHTML = '';
    
    for (let y = 0; y < 14; y++) {
        let rowDOM = [];
        for (let x = 0; x < 14; x++) {
            let cell = document.createElement('div');
            cell.classList.add('cell');
            
            if (!inBounds(x, y)) {
                cell.classList.add('dead');
            } else {
                if ((x + y) % 2 === 0) {
                    cell.classList.add('light');
                } else {
                    cell.classList.add('dark');
                }
                
                cell.addEventListener('mousedown', () => handleCellClick(x, y));
                cell.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    handleCellClick(x, y);
                }, {passive: false});
            }
            
            boardDiv.appendChild(cell);
            rowDOM.push(cell);
        }
        cellsDOM.push(rowDOM);
    }
}

function handleCellClick(x, y) {
    if (game.gameOver || !myColor) return;
    
    let currentTurnColor = CHESS_COLORS[game.turnIndex];
    if (currentTurnColor !== myColor) return;

    let clickedPiece = game.board[y][x].piece; 
    
    if (selectedCell) {
        let move = validMovesForSelected.find(m => m.x === x && m.y === y);
        if (move) {
            socket.emit('make_move', { fx: selectedCell.x, fy: selectedCell.y, tx: x, ty: y });
            selectedCell = null;
            validMovesForSelected = [];
            updateUI();
            return;
        }
    }

    if (typeof GameEngine !== 'undefined') {
        let localSandbox = new GameEngine();
        localSandbox.board = game.board;
        localSandbox.activePlayers = game.activePlayers;
        
        if (clickedPiece && clickedPiece.color === myColor) {
            selectedCell = { x, y };
            validMovesForSelected = localSandbox.getValidMoves(x, y);
            updateUI();
        } else {
            selectedCell = null;
            validMovesForSelected = [];
            updateUI();
        }
    }
}

function updateUI() {
    // Board logic
    for (let y = 0; y < 14; y++) {
        for (let x = 0; x < 14; x++) {
            if (!inBounds(x, y)) continue;
            
            let cellDOM = cellsDOM[y][x];
            cellDOM.className = `cell ${(x+y)%2===0 ? 'light' : 'dark'}`;
        }
    }

    // Pieces logic
    let activePieceIds = new Set();
    for (let y = 0; y < 14; y++) {
        for (let x = 0; x < 14; x++) {
            if (!inBounds(x, y)) continue;
            let p = game.board[y][x].piece;
            if (p) {
                let pid = p.id || `fallback_${x}_${y}`;
                activePieceIds.add(pid);
                let pDiv = document.getElementById('piece-' + pid);
                if (!pDiv) {
                    pDiv = document.createElement('div');
                    pDiv.id = 'piece-' + pid;
                    pDiv.className = `piece ${p.color}`;
                    boardDiv.appendChild(pDiv);
                }
                pDiv.innerText = UNICODE[p.type];
                pDiv.style.setProperty('--rot', `rotate(${-boardRotation}deg)`);
                pDiv.style.left = `calc(var(--cell-size) * ${x})`;
                pDiv.style.top = `calc(var(--cell-size) * ${y})`;
            }
        }
    }
    
    if (game.lastMove) {
        let lm = game.lastMove;
        if (inBounds(lm.fx, lm.fy)) cellsDOM[lm.fy][lm.fx].classList.add('last-move');
        if (inBounds(lm.tx, lm.ty)) cellsDOM[lm.ty][lm.tx].classList.add('last-move');
    }

    let deletedCount = 0;
    let allPiecesDOM = document.querySelectorAll('.piece');
    allPiecesDOM.forEach(el => {
        let pid = el.id.replace('piece-', '');
        if (!activePieceIds.has(pid)) {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
            deletedCount++;
        }
    });

    if (window.lastTurnIndex !== undefined && window.lastTurnIndex !== game.turnIndex) {
        if (soundEnabled) {
            if (deletedCount > 0) {
                audioCapture.currentTime = 0;
                audioCapture.play().catch(e => {});
            } else {
                audioMove.currentTime = 0;
                audioMove.play().catch(e => {});
            }
        }
    }
    window.lastTurnIndex = game.turnIndex;

    if (selectedCell && CHESS_COLORS[game.turnIndex] === myColor) {
        cellsDOM[selectedCell.y][selectedCell.x].classList.add('selected');
        for (let mv of validMovesForSelected) {
            let trgDOM = cellsDOM[mv.y][mv.x];
            trgDOM.classList.add('highlight-move');
            if (mv.capture) trgDOM.classList.add('has-enemy');
        }
    }

    // HUD logic
    let currentTurn = CHESS_COLORS[game.turnIndex];
    let turnOwnerName = playerNamesMap[currentTurn] || TR_COLORS[currentTurn];
    indicator.innerText = `Sıra: ${turnOwnerName}`;
    
    for (let c of CHESS_COLORS) {
        let pos = panelMap[c]; // top, bottom, left, right maps to screen orientation
        let pnl = document.getElementById(`panel-screen-${pos}`);
        
        pnl.dataset.color = c; 
        pnl.classList.remove('active-panel');
        let status = pnl.querySelector('.player-status');
        let nameField = pnl.querySelector('.player-name');
        let scoreField = pnl.querySelector('.player-score');
        
        let cFlag = playerFlagsMap[c];
        let flagImg = cFlag ? `<img src="https://flagcdn.com/w20/${cFlag}.png" style="vertical-align:middle; width:16px; margin-right:4px; border-radius:2px;" />` : '';
        
        nameField.innerHTML = `${flagImg}${playerNamesMap[c] || TR_COLORS[c]}`;
        scoreField.innerText = `Puan: ${(game.scores && game.scores[c]) || 0}`;
        
        if (!game.activePlayers[c]) {
            status.innerText = "Elendi";
            pnl.style.opacity = '0.4';
            if (c === myColor) document.getElementById('btn-resign').classList.add('hidden');
        } else if (currentTurn === c) {
            pnl.classList.add('active-panel');
            status.innerText = "Düşünüyor...";
            statusText.innerText = "Hamle bekleniyor";
            pnl.style.opacity = '1';
            if (c === myColor) document.getElementById('btn-resign').classList.remove('hidden');
        } else {
            status.innerText = "Bekliyor";
            pnl.style.opacity = '0.8';
            if (c === myColor) document.getElementById('btn-resign').classList.remove('hidden');
        }
    }

    if (game.gameOver) {
        let w = game.winner;
        let text = w ? (game.teamMode ? (w==='white' ? 'Kazanan: Beyaz/Siyah Takımı!' : 'Kazanan: Mavi/Kırmızı Takımı!') : `Kazanan: ${playerNamesMap[w]}!`) : "Berabere!";
        document.getElementById('winner-text').innerText = text;
        document.getElementById('game-over-modal').classList.remove('hidden');
        statusText.innerText = "Oyun Bitti";
        
        if (window.lastGameOver !== true) {
            if (soundEnabled) {
                audioEnd.currentTime = 0;
                audioEnd.play().catch(e => {});
            }
            window.lastGameOver = true;
        }
    }
}

function renderTimer() {
    if (game && !game.gameOver && turnEndTime > 0) {
        let leftMs = turnEndTime - Date.now();
        if (leftMs < 0) leftMs = 0;
        let secs = Math.ceil(leftMs / 1000);
        
        if (secs <= 5) {
            turnTimerDOM.style.color = '#ef4444'; // Red
            turnTimerDOM.style.transform = `scale(${1 + (leftMs % 1000 < 500 ? 0.1 : 0)})`; 
        } else {
            turnTimerDOM.style.color = '#f59e0b'; // Orange
            turnTimerDOM.style.transform = 'scale(1)';
        }
        
        turnTimerDOM.innerText = `⏳ ${secs} saniye`;
    } else if (turnTimerDOM) {
        turnTimerDOM.innerText = '';
    }
    requestAnimationFrame(renderTimer);
}
requestAnimationFrame(renderTimer);

document.getElementById('btn-resign').addEventListener('click', () => {
    if (confirm("Gerçekten pes etmek ve çekilmek istiyor musunuz? Müttefikiniz zor durumda kalabilir!")) {
        socket.emit('resign');
    }
});

// CHAT SYSTEM LOGIC
const chatWidget = document.getElementById('chat-widget');
const chatInput = document.getElementById('chat-input');
const btnSendChat = document.getElementById('btn-send-chat');
const chatMessages = document.getElementById('chat-messages');

// Mobile Toggle Listeners
document.getElementById('chat-toggle-btn').addEventListener('click', () => {
    chatWidget.classList.add('chat-open');
});
document.getElementById('chat-close-btn').addEventListener('click', () => {
    chatWidget.classList.remove('chat-open');
});

// Sound Toggle Listener
const muteBtn = document.getElementById('mute-toggle-btn');
if (muteBtn) {
    muteBtn.addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        muteBtn.innerText = soundEnabled ? '🔊' : '🔇';
    });
}

function sendChatMessage() {
    let text = chatInput.value.trim();
    if (text.length > 0) {
        socket.emit('chat_msg', { text });
        chatInput.value = '';
    }
}

btnSendChat.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

socket.on('chat_msg', (data) => {
    let entry = document.createElement('div');
    entry.className = 'chat-entry';
    let nameElem = document.createElement('strong');
    nameElem.className = `chat-${data.color}`;
    nameElem.innerText = data.name + ':';
    
    let textElem = document.createElement('span');
    textElem.innerText = ' ' + data.text;
    
    entry.appendChild(nameElem);
    entry.appendChild(textElem);
    chatMessages.appendChild(entry);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
});


document.getElementById('btn-leaderboard').addEventListener('click', () => {
    socket.emit('get_leaderboard');
});

socket.on('leaderboard_res', (list) => {
    let div = document.getElementById('leaderboard-list');
    div.innerHTML = '';
    if (list.length === 0) {
        div.innerHTML = '<div style="text-align:center; color:#94a3b8;">Henüz kimse şampiyon olmadı.</div>';
    } else {
        list.forEach((item, index) => {
            let row = document.createElement('div');
            row.style.padding = "8px";
            row.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
            row.style.display = "flex";
            row.style.justifyContent = "space-between";
            
            let pos = index === 0 ? "🥇" : (index === 1 ? "🥈" : (index === 2 ? "🥉" : (index+1)+"." ));
            row.innerHTML = '<span><strong style="color:#eab308; margin-right:5px;">'+pos+'</strong> ' + item.name + '</span><span style="font-weight:bold; color:var(--board-light);">'+item.score+'</span>';
            div.appendChild(row);
        });
    }
    document.getElementById('leaderboard-modal').classList.remove('hidden');
});

document.getElementById('btn-close-leaderboard').addEventListener('click', () => {
    document.getElementById('leaderboard-modal').classList.add('hidden');
});
