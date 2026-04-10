const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

const { GameEngine, CHESS_COLORS } = require('./engine.js');
const fs = require('fs');

app.use(express.static(__dirname));

let waitingQueue = []; 
let queueTimeoutInterval = null;
let secondsLeft = 5;

let customRooms = {};
const VALID_BOT_FLAGS = ['us', 'gb', 'de', 'jp', 'kr', 'it', 'fr', 'es'];

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for(let i=0; i<4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

let rooms = {}; 
let userRooms = {}; 
let userSessions = {}; 

function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

const TURN_TIME_MS = 30000;

function deleteRoom(roomId) {
    let room = rooms[roomId];
    if (!room) return;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    Object.keys(userRooms).forEach(sid => {
        if (userRooms[sid] === roomId) delete userRooms[sid];
    });
    delete rooms[roomId];
}

function setupMatch(playersInMatch, roomData = {}) {
    const roomId = generateId();
    const game = new GameEngine();
    game.turnIndex = 0; 
    game.teamMode = roomData.teamMode || false;
    let players = {}; 
    let playerNames = {};
    let playerFlags = {};
    let bots = [];
    let availableColors = [...CHESS_COLORS];
    playersInMatch.forEach((p, idx) => {
        let assignedColor = availableColors.shift();
        let sid = p.sessionId;
        players[sid] = assignedColor;
        playerNames[assignedColor] = p.name || "Guest";
        playerFlags[assignedColor] = p.flag || "us";
        userRooms[sid] = roomId;
        p.socket.join(roomId);
    });
    let botCount = 1;
    availableColors.forEach(botColor => {
        bots.push(botColor);
        playerNames[botColor] = "Master Bot " + botCount;
        playerFlags[botColor] = VALID_BOT_FLAGS[Math.floor(Math.random() * VALID_BOT_FLAGS.length)];
        botCount++;
    });
    rooms[roomId] = { 
        game, players, playerNames, playerFlags, bots, 
        turnTimer: null, turnEndTime: 0, 
        lastMoveTime: Date.now(),
        createdAt: Date.now()
    };
    startTurnTimer(roomId);
    const initState = {
        board: game.board, turnIndex: game.turnIndex,
        activePlayers: game.activePlayers, gameOver: game.gameOver, winner: game.winner,
        playerNames: playerNames, playerFlags: playerFlags, turnEndTime: Date.now() + TURN_TIME_MS,
        serverTime: Date.now(), lastMove: game.lastMove, roomId: roomId
    };
    playersInMatch.forEach(p => {
        p.socket.emit('match_found', { color: players[p.sessionId], roomId: roomId });
        p.socket.emit('init_state', initState);
    });
}

function processQueue(forceStart = false) {
    if (waitingQueue.length === 0) return;
    if (waitingQueue.length >= 4 || forceStart) {
        if (queueTimeoutInterval) { clearInterval(queueTimeoutInterval); queueTimeoutInterval = null; }
        let playersInMatch = waitingQueue.splice(0, 4);
        setupMatch(playersInMatch);
    } else {
        if (!queueTimeoutInterval && waitingQueue.length > 0) {
            secondsLeft = 5;
            queueTimeoutInterval = setInterval(() => {
                secondsLeft--;
                broadcastQueueUpdate();
                if (secondsLeft <= 0) processQueue(true);
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
    if (room.bots.includes(room.game.getCurrentTurnColor())) {
         setTimeout(() => forceBotMove(roomId), 1200);
    }
}

function forceBotMove(roomId) {
    let room = rooms[roomId];
    if (!room || room.game.gameOver) return false;
    let currentColor = room.game.getCurrentTurnColor();
    try {
        let bestMove = room.game.getBestMove(currentColor);
        if (bestMove) {
            room.game.movePiece(bestMove.fx, bestMove.fy, bestMove.tx, bestMove.ty);
            room.lastMoveTime = Date.now();
            startTurnTimer(roomId);
            broadcastRoomState(roomId);
            triggerBotMove(roomId);
            return true;
        }
    } catch (e) { console.error(e); }
    return false;
}

function startTurnTimer(roomId) {
    let room = rooms[roomId];
    if (!room || room.game.gameOver) return;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnEndTime = Date.now() + TURN_TIME_MS;
    room.turnTimer = setTimeout(() => forceBotMove(roomId), TURN_TIME_MS);
}

function broadcastRoomState(roomId) {
    let room = rooms[roomId]; if (!room) return;
    io.to(roomId).emit('state_update', {
        board: room.game.board, turnIndex: room.game.turnIndex,
        activePlayers: room.game.activePlayers, gameOver: room.game.gameOver, winner: room.game.winner,
        turnEndTime: room.turnEndTime, serverTime: Date.now(), lastMove: room.game.lastMove, roomId: roomId
    });
}

function purgePlayer(sessionId) {
    waitingQueue = waitingQueue.filter(p => p.sessionId !== sessionId);
    let roomId = userRooms[sessionId];
    if (roomId && rooms[roomId]) {
        let room = rooms[roomId];
        let color = room.players[sessionId];
        if (color && !room.game.gameOver) {
            room.bots.push(color);
            delete room.players[sessionId];
            if (room.game.getCurrentTurnColor() === color) triggerBotMove(roomId);
            broadcastRoomState(roomId);
        }
    }
    delete userRooms[sessionId];
}

io.on('connection', (socket) => {
    const sessionId = socket.handshake.query.sessionId;
    if (!sessionId) return socket.disconnect();
    socket.sessionId = sessionId;
    
    let roomId = userRooms[sessionId];
    if (roomId && rooms[roomId]) {
        let assignedColor = rooms[roomId].players[sessionId];
        if (!rooms[roomId].game.gameOver && assignedColor) {
            socket.join(roomId);
            socket.emit('match_found', { color: assignedColor, roomId });
        }
    }

    socket.on('join_queue', (data) => {
        purgePlayer(socket.sessionId);
        waitingQueue.push({ socket, name: data.username || 'Guest', flag: data.flag || 'us', sessionId: socket.sessionId });
        processQueue();
    });

    socket.on('make_move', (data) => {
        let roomId = userRooms[socket.sessionId];
        let room = rooms[roomId];
        if (!room) return;
        if (room.game.movePiece(data.fx, data.fy, data.tx, data.ty).success) {
            room.lastMoveTime = Date.now();
            startTurnTimer(roomId);
            broadcastRoomState(roomId);
            triggerBotMove(roomId);
        }
    });

    socket.on('chat_msg', (data) => {
        let roomId = userRooms[socket.sessionId];
        let room = rooms[roomId];
        if (!room) return;
        let color = room.players[socket.sessionId];
        io.to(roomId).emit('chat_msg', { color, name: room.playerNames[color], text: data.text });
    });

    socket.on('disconnect', () => {
        waitingQueue = waitingQueue.filter(p => p.sessionId !== socket.sessionId);
    });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
