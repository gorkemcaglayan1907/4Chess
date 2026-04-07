const socket = io();

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
let boardRotation = 0;
let panelMap = { white: 'bottom', black: 'top', blue: 'left', red: 'right' };

const boardDiv = document.getElementById('chess-board');
const indicator = document.getElementById('turn-indicator');
const statusText = document.getElementById('game-status-text');

const usernameInput = document.getElementById('username-input');
const flagSelect = document.getElementById('flag-select');

// Daha önce giriş yapmış mı kontrol et
const savedUsername = localStorage.getItem('4chess_username');
const savedFlag = localStorage.getItem('4chess_flag');
if (savedUsername) {
    usernameInput.value = savedUsername;
}
if (savedFlag) {
    flagSelect.value = savedFlag;
}

document.getElementById('btn-login').addEventListener('click', () => {
    let name = usernameInput.value;
    let flag = flagSelect.value;
    if (name.trim() === '') name = 'İsimsiz' + Math.floor(Math.random()*100);
    
    // İsmi kalıcı olarak cihaz hafızasına ('Hesap' gibi) kaydet
    localStorage.setItem('4chess_username', name.trim());
    localStorage.setItem('4chess_flag', flag);
    
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('lobby-screen').classList.remove('hidden');
    
    socket.emit('join_queue', { username: name, flag: flag });
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
            cellDOM.innerHTML = '';
            
            let p = game.board[y][x].piece;
            if (p) {
                let pDiv = document.createElement('div');
                pDiv.className = `piece ${p.color}`;
                pDiv.innerText = UNICODE[p.type];
                
                let flagCode = playerFlagsMap[p.color];
                if (flagCode) {
                    pDiv.style.backgroundImage = `url('https://flagcdn.com/w40/${flagCode}.png')`;
                    pDiv.classList.add('flagged');
                }
                
                pDiv.style.setProperty('--rot', `rotate(${-boardRotation}deg)`);
                cellDOM.appendChild(pDiv);
            }
        }
    }

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
        } else if (currentTurn === c) {
            pnl.classList.add('active-panel');
            status.innerText = "Düşünüyor...";
            statusText.innerText = "Hamle bekleniyor";
            pnl.style.opacity = '1';
        } else {
            status.innerText = "Bekliyor";
            pnl.style.opacity = '0.8';
        }
    }

    if (game.gameOver) {
        let w = game.winner;
        let text = w ? `Kazanan: ${playerNamesMap[w]}!` : "Berabere!";
        document.getElementById('winner-text').innerText = text;
        document.getElementById('game-over-modal').classList.remove('hidden');
        statusText.innerText = "Oyun Bitti";
    }
}
