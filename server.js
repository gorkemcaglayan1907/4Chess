const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

const { GameEngine, CHESS_COLORS } = require('./engine.js');

app.use(express.static(__dirname));

let waitingQueue = []; 
let queueTimeoutInterval = null;
let secondsLeft = 30;

let rooms = {}; 
let userRooms = {}; 

function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

const BOT_FLAGS = ['un', 'eu', 'earth', 'aq'];
const TURN_TIME_MS = 20000;

function processQueue(forceStart = false) {
    if (waitingQueue.length === 0) return;
    
    let isFull = waitingQueue.length >= 4;
    
    if (isFull || forceStart) {
        // Zamanlayıcıyı durdur
        if (queueTimeoutInterval) {
            clearInterval(queueTimeoutInterval);
            queueTimeoutInterval = null;
        }

        let playersInMatch = waitingQueue.splice(0, 4);
        let roomId = generateId();
        let game = new GameEngine();
        let players = {};
        let playerNames = {};
        let playerFlags = {};
        let bots = [];

        let availableColors = [...CHESS_COLORS];
        
        playersInMatch.forEach((p) => {
            let assignedColor = availableColors.shift();
            players[p.socket.id] = assignedColor;
            playerNames[assignedColor] = p.username || "Misafir";
            playerFlags[assignedColor] = p.flag || "tr";
            userRooms[p.socket.id] = roomId;
            p.socket.join(roomId);
            
            p.socket.emit('match_found', {
                color: assignedColor,
                roomId: roomId
            });
        });

        // Botlara otomatik bayrak
        let botCount = 1;
        availableColors.forEach(botColor => {
            bots.push(botColor);
            playerNames[botColor] = "Zorlu Bot " + botCount;
            // Botlara özel bayrak kombinasyonu
            playerFlags[botColor] = BOT_FLAGS[Math.floor(Math.random() * BOT_FLAGS.length)] || 'un';
            botCount++;
        });

        rooms[roomId] = { game, players, playerNames, playerFlags, bots, turnTimer: null, turnEndTime: 0 };
        
        secondsLeft = 30; // Sonraki sıra için reset
        startTurnTimer(roomId);
        startGameLoop(roomId);
        
        if (waitingQueue.length > 0) processQueue();
    } else {
        // Bekleyen sayısı 4 ten azsa Timer'i aktifleştir
        if (!queueTimeoutInterval && waitingQueue.length > 0) {
            secondsLeft = 30;
            queueTimeoutInterval = setInterval(() => {
                secondsLeft--;
                broadcastQueueUpdate();
                if (secondsLeft <= 0) {
                    processQueue(true); // Süre bitince zorla başlat
                }
            }, 1000);
        }
        broadcastQueueUpdate();
    }
}

function broadcastQueueUpdate() {
    let count = waitingQueue.length;
    waitingQueue.forEach(p => {
        p.socket.emit('queue_update', { count, max: 4, secondsLeft }); 
    });
}

function triggerBotMove(roomId) {
    let room = rooms[roomId];
    if (!room || room.game.gameOver) return;

    let currentColor = room.game.getCurrentTurnColor();
    if (room.bots.includes(currentColor) && room.game.activePlayers[currentColor]) {
        setTimeout(() => {
            if (!rooms[roomId]) return;
            let currentNow = room.game.getCurrentTurnColor();
            if (currentNow === currentColor && !room.game.gameOver) {
                let bestMove = room.game.getBestMove(currentColor);
                if (bestMove) {
                    let res = room.game.movePiece(bestMove.fx, bestMove.fy, bestMove.tx, bestMove.ty);
                    startTurnTimer(roomId);
                    broadcastRoomState(roomId, res.promoted);
                    triggerBotMove(roomId);
                }
            }
        }, 1500); 
    }
}

function forceBotMove(roomId) {
    let room = rooms[roomId];
    if (!room || room.game.gameOver) return;
    let currentColor = room.game.getCurrentTurnColor();
    let bestMove = room.game.getBestMove(currentColor);
    if (bestMove) {
        let res = room.game.movePiece(bestMove.fx, bestMove.fy, bestMove.tx, bestMove.ty);
        startTurnTimer(roomId);
        broadcastRoomState(roomId, res.promoted);
        triggerBotMove(roomId);
    }
}

function startTurnTimer(roomId) {
    let room = rooms[roomId];
    if (!room || room.game.gameOver) return;

    if (room.turnTimer) clearTimeout(room.turnTimer);
    
    room.turnEndTime = Date.now() + TURN_TIME_MS;
    room.turnTimer = setTimeout(() => {
        forceBotMove(roomId);
    }, TURN_TIME_MS);
}

function broadcastRoomState(roomId, promoted = false) {
    let room = rooms[roomId];
    if (!room) return;

    io.to(roomId).emit('state_update', {
        board: room.game.board,
        turnIndex: room.game.turnIndex,
        scores: room.game.scores,
        activePlayers: room.game.activePlayers,
        gameOver: room.game.gameOver,
        winner: room.game.winner,
        playerNames: room.playerNames,
        playerFlags: room.playerFlags,
        turnEndTime: room.turnEndTime,
        promoted: promoted
    });
}

function startGameLoop(roomId) {
    let room = rooms[roomId];
    if (!room) return;
    
    io.to(roomId).emit('init_state', {
        board: room.game.board,
        turnIndex: room.game.turnIndex,
        scores: room.game.scores,
        activePlayers: room.game.activePlayers,
        gameOver: room.game.gameOver,
        winner: room.game.winner,
        playerNames: room.playerNames,
        playerFlags: room.playerFlags,
        turnEndTime: room.turnEndTime
    });
    triggerBotMove(roomId);
}

io.on('connection', (socket) => {
    socket.on('join_queue', (data) => {
        let name = data.username.trim() || 'Misafir';
        if (name.length > 15) name = name.substring(0, 15);
        waitingQueue.push({ socket, username: name, flag: data.flag || 'tr' });
        processQueue();
    });

    socket.on('make_move', (data) => {
        let roomId = userRooms[socket.id];
        let room = rooms[roomId];
        if (!room) return;

        let playerColor = room.players[socket.id];
        if (playerColor !== room.game.getCurrentTurnColor()) return; 
        
        let piece = room.game.getPieceAt(data.fx, data.fy);
        if (!piece || piece.color !== playerColor) return; 

        let validMoves = room.game.getValidMoves(data.fx, data.fy);
        if (validMoves.some(m => m.x === data.tx && m.y === data.ty)) {
            let result = room.game.movePiece(data.fx, data.fy, data.tx, data.ty);
            startTurnTimer(roomId);
            broadcastRoomState(roomId, result.promoted);
            triggerBotMove(roomId);
        }
    });

    socket.on('disconnect', () => {
        waitingQueue = waitingQueue.filter(p => p.socket.id !== socket.id);
        
        if (waitingQueue.length === 0 && queueTimeoutInterval) {
             clearInterval(queueTimeoutInterval);
             queueTimeoutInterval = null;
        } else {
             broadcastQueueUpdate();
        }

        let roomId = userRooms[socket.id];
        if (roomId && rooms[roomId]) {
            let room = rooms[roomId];
            let color = room.players[socket.id];
            
            if (color && room.game.activePlayers[color] && !room.game.gameOver) {
                room.bots.push(color);
                delete room.players[socket.id];
                
                if (room.game.getCurrentTurnColor() === color) {
                    triggerBotMove(roomId);
                }
            }
        }
        delete userRooms[socket.id];
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
