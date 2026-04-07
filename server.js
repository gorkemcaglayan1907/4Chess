const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

const { GameEngine, CHESS_COLORS } = require('./engine.js');

app.use(express.static(__dirname));

let waitingQueue = []; // { socket, username }
let matchTimer = null;
let rooms = {}; // roomId -> { game, players, playerNames, bots }
let userRooms = {}; // socket.id -> roomId

function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

function processQueue(forceStart = false) {
    if (waitingQueue.length === 0) return;
    
    if (waitingQueue.length >= 4 || forceStart) {
        if (matchTimer) {
            clearTimeout(matchTimer);
            matchTimer = null;
        }

        let playersInMatch = waitingQueue.splice(0, 4);
        let roomId = generateId();
        let game = new GameEngine();
        let players = {};
        let playerNames = {};
        let bots = [];

        let availableColors = [...CHESS_COLORS];
        
        // Gerçek Oyuncular
        playersInMatch.forEach((p) => {
            let assignedColor = availableColors.shift();
            players[p.socket.id] = assignedColor;
            playerNames[assignedColor] = p.username || "Misafir";
            userRooms[p.socket.id] = roomId;
            p.socket.join(roomId);
            
            p.socket.emit('match_found', {
                color: assignedColor,
                roomId: roomId
            });
        });

        // Kalan renkleri yapay zekaya (Bot) ver
        let botCount = 1;
        availableColors.forEach(botColor => {
            bots.push(botColor);
            playerNames[botColor] = "Zorlu Bot " + botCount;
            botCount++;
        });

        rooms[roomId] = { game, players, playerNames, bots };
        console.log(`Oda oluşturuldu [${roomId}]. Oyuncular: ${playersInMatch.length}, Botlar: ${bots.length}`);

        startGameLoop(roomId);
        
        if (waitingQueue.length > 0) processQueue();
    } else {
        if (!matchTimer && waitingQueue.length > 0) {
            matchTimer = setTimeout(() => {
                processQueue(true); // 60s timeout
            }, 60000); 
        }
        broadcastQueueUpdate();
    }
}

function broadcastQueueUpdate() {
    let count = waitingQueue.length;
    waitingQueue.forEach(p => {
        p.socket.emit('queue_update', { count, max: 4 }); 
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
                    broadcastRoomState(roomId, res.promoted);
                    triggerBotMove(roomId);
                } else {
                    console.log(`Bot ${currentColor} hamle bulamadı!`);
                }
            }
        }, 1500); 
    }
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
        playerNames: room.playerNames
    });
    triggerBotMove(roomId);
}

io.on('connection', (socket) => {
    console.log('Kullanıcı bağlandı:', socket.id);
    
    socket.on('join_queue', (data) => {
        let name = data.username.trim() || 'Misafir';
        if (name.length > 15) name = name.substring(0, 15);
        waitingQueue.push({ socket, username: name });
        processQueue();
    });

    socket.on('make_move', (data) => {
        let roomId = userRooms[socket.id];
        let room = rooms[roomId];
        if (!room) return;

        let playerColor = room.players[socket.id];
        if (playerColor !== room.game.getCurrentTurnColor()) return; 
        
        let piece = room.game.getPieceAt(data.fx, data.fy);
        if (!piece || piece.color !== playerColor) return; // Strict ownership enforcement

        let validMoves = room.game.getValidMoves(data.fx, data.fy);
        if (validMoves.some(m => m.x === data.tx && m.y === data.ty)) {
            let result = room.game.movePiece(data.fx, data.fy, data.tx, data.ty);
            broadcastRoomState(roomId, result.promoted);
            triggerBotMove(roomId);
        }
    });

    socket.on('disconnect', () => {
        console.log('Kullanıcı koptu:', socket.id);
        waitingQueue = waitingQueue.filter(p => p.socket.id !== socket.id);
        
        if (waitingQueue.length === 0 && matchTimer) {
             clearTimeout(matchTimer);
             matchTimer = null;
        } else {
             broadcastQueueUpdate();
        }

        let roomId = userRooms[socket.id];
        if (roomId && rooms[roomId]) {
            let room = rooms[roomId];
            let color = room.players[socket.id];
            
            if (color && room.game.activePlayers[color] && !room.game.gameOver) {
                console.log(`Oyuncu koptu. Yapay Zeka bot devralıyor (${color}).`);
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
