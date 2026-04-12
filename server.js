const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

const { GameEngine, CHESS_COLORS } = require('./engine.js');
const fs = require('fs');
const path = require('path');

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
let userSessions = {}; // sessionId -> { socketId, name, flag }
let matchBannedPlayers = {}; // roomId -> Set(sessionIds)

function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

const TURN_TIME_MS = 30000;

function deleteRoom(roomId) {
    let room = rooms[roomId];
    if (!room) return;
    console.log(`[CLEANUP] Deleting room ${roomId}`);
    if (room.turnTimer) clearTimeout(room.turnTimer);
    // Clear all reverse lookups
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
    
    // Shuffle available colors to randomize who gets which color
    let availableColors = [...CHESS_COLORS].sort(() => Math.random() - 0.5);

    playersInMatch.forEach((p, idx) => {
        let assignedColor = availableColors.shift();
        let sid = p.sessionId;
        
        // Force leave ANY old rooms
        let oldRoomId = userRooms[sid];
        if (oldRoomId) p.socket.leave(oldRoomId);

        players[sid] = assignedColor;
        playerNames[assignedColor] = p.name || "Guest";
        playerFlags[assignedColor] = p.flag || "us";
        userRooms[sid] = roomId;
        p.socket.join(roomId);
        console.log(`[SETUP] Player ${sid} -> ${assignedColor} in ${roomId}`);
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
        createdAt: Date.now(),
        timeoutCounts: { white: 0, black: 0, blue: 0, red: 0 }
    };

    startTurnTimer(roomId);
    const initState = getInitState(roomId);
    playersInMatch.forEach(p => {
        p.socket.emit('match_found', { color: players[p.sessionId], roomId: roomId });
        p.socket.emit('init_state', initState);
    });
    
    // Check if the very first turn belongs to a bot so it starts immediately
    triggerBotMove(roomId);
}

function processQueue(forceStart = false) {
    if (waitingQueue.length === 0) return;
    if (waitingQueue.length >= 4 || forceStart) {
        if (queueTimeoutInterval) { clearInterval(queueTimeoutInterval); queueTimeoutInterval = null; }
        secondsLeft = 5; // Reset global timer
        let playersInMatch = waitingQueue.splice(0, 4);
        try {
            setupMatch(playersInMatch);
        } catch (e) {
            console.error("[MATCH ERROR] Failed to start match:", e);
        }
        if (waitingQueue.length > 0) processQueue();
    } else {
        if (!queueTimeoutInterval && waitingQueue.length > 0) {
            secondsLeft = 5;
            queueTimeoutInterval = setInterval(() => {
                secondsLeft--;
                if (secondsLeft < 0) secondsLeft = 0; // Prevent negative
                broadcastQueueUpdate();
                if (secondsLeft <= 0) {
                    if (queueTimeoutInterval) { clearInterval(queueTimeoutInterval); queueTimeoutInterval = null; }
                    processQueue(true);
                }
            }, 1000);
        }
        broadcastQueueUpdate();
    }
}

function broadcastQueueUpdate() {
    // CRITICAL: Filter out any sockets that might have disconnected but weren't purged yet
    waitingQueue = waitingQueue.filter(p => p.socket && p.socket.connected);
    
    if (waitingQueue.length === 0 && queueTimeoutInterval) {
        clearInterval(queueTimeoutInterval);
        queueTimeoutInterval = null;
    }
    let count = waitingQueue.length;
    let names = waitingQueue.map(p => p.name);
    waitingQueue.forEach(p => {
        p.socket.emit('queue_update', { count, max: 4, secondsLeft, names }); 
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

    // Check if this is a player timeout (current color belongs to a human)
    let humanSessionId = Object.keys(room.players).find(sid => room.players[sid] === currentColor);
    if (humanSessionId) {
        room.timeoutCounts[currentColor]++;
        if (room.timeoutCounts[currentColor] >= 2) {
            console.log(`[KICK] Kicking ${room.playerNames[currentColor]} (${currentColor}) in ${roomId} for inactivity.`);
            room.bots.push(currentColor);
            delete room.players[humanSessionId];
            io.to(roomId).emit('chat_msg', { name: 'System', text: `${room.playerNames[currentColor]} kicked for inactivity. Bot takes over.`, color: 'red' });
            
            // Force all sockets for this session to leave the room
            io.in(roomId).fetchSockets().then(sockets => {
                sockets.forEach(s => { 
                    if(s.sessionId === humanSessionId) {
                        s.emit('force_lobby');
                        s.leave(roomId);
                    }
                });
            });
        }
    }

    try {
        let bestMove = room.game.getBestMove(currentColor);
        if (bestMove) {
            let result = room.game.movePiece(bestMove.fx, bestMove.fy, bestMove.tx, bestMove.ty);
            room.lastMoveTime = Date.now();
            startTurnTimer(roomId);
            broadcastRoomState(roomId, result);
            triggerBotMove(roomId);
            return true;
        }
    } catch (e) { console.error(`[BOT ERR] ${roomId}:`, e); }
    return false;
}

// Garbage Collection for Stale/Finished Rooms
setInterval(() => {
    const now = Date.now();
    Object.keys(rooms).forEach(rid => {
        const room = rooms[rid];
        // If game is over, delete after 30 seconds
        if (room.game.gameOver && now - (room.lastMoveTime || now) > 30000) {
            deleteRoom(rid);
        }
        // If match is 2 hours old, delete 
        else if (now - room.createdAt > 7200000) {
            deleteRoom(rid);
        }
    });
}, 60000);

function startTurnTimer(roomId) {
    let room = rooms[roomId];
    if (!room || room.game.gameOver) return;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnEndTime = Date.now() + TURN_TIME_MS;
    room.turnTimer = setTimeout(() => forceBotMove(roomId), TURN_TIME_MS);
}

function broadcastRoomState(roomId, moveResult = {}) {
    let room = rooms[roomId]; if (!room) return;
    io.to(roomId).emit('state_update', {
        board: room.game.board, turnIndex: room.game.turnIndex,
        activePlayers: room.game.activePlayers, gameOver: room.game.gameOver, winner: room.game.winner,
        turnEndTime: room.turnEndTime, serverTime: Date.now(), lastMove: room.game.lastMove, roomId: roomId
    });
}

function getInitState(roomId) {
    let room = rooms[roomId]; if (!room) return null;
    return {
        board: room.game.board, turnIndex: room.game.turnIndex,
        activePlayers: room.game.activePlayers, gameOver: room.game.gameOver, winner: room.game.winner,
        playerNames: room.playerNames, playerFlags: room.playerFlags, turnEndTime: room.turnEndTime,
        serverTime: Date.now(), lastMove: room.game.lastMove, roomId: roomId
    };
}

function processCustomRoom(code) {
    let rd = customRooms[code]; if (!rd) return;
    setupMatch(rd.players, rd); delete customRooms[code];
}

function purgePlayer(sessionId) {
    waitingQueue = waitingQueue.filter(p => p.sessionId !== sessionId);
    Object.keys(customRooms).forEach(code => {
        customRooms[code].players = customRooms[code].players.filter(p => p.sessionId !== sessionId);
        if (customRooms[code].players.length === 0) delete customRooms[code];
        else {
            // Notify remaining players about the departure
            let names = customRooms[code].players.map(p => p.name);
            customRooms[code].players.forEach(p => p.socket.emit('custom_room_joined', { code, count: customRooms[code].players.length, names, isHost: !!p.isHost }));
        }
    });
    let roomId = userRooms[sessionId];
    if (roomId && rooms[roomId]) {
        let room = rooms[roomId];
        let color = room.players[sessionId];
        if (color && !room.game.gameOver) {
            room.bots.push(color);
            delete room.players[sessionId];
            io.to(roomId).emit('chat_msg', { name: 'System', text: `${room.playerNames[color]} left. Bot takes over.`, color: 'red' });
            if (room.game.getCurrentTurnColor() === color) triggerBotMove(roomId);
            broadcastRoomState(roomId);
        }
        // CRITICAL: Force all sockets for this session to leave the room
        io.in(roomId).fetchSockets().then(sockets => {
            sockets.forEach(s => { if(s.sessionId === sessionId) s.leave(roomId); });
        });
    }
    if (waitingQueue.length === 0 && queueTimeoutInterval) {
        clearInterval(queueTimeoutInterval);
        queueTimeoutInterval = null;
    }
    delete userRooms[sessionId];
    
    // BROADCAST UPDATE IMMEDIATELY AFTER PURGE
    if (waitingQueue.length > 0) {
        broadcastQueueUpdate();
    }
}

io.on('connection', (socket) => {
    const sessionId = socket.handshake.query.sessionId;
    if (!sessionId) return socket.disconnect();
    socket.sessionId = sessionId;
    console.log(`[CONNECT] Session: ${sessionId}`);
    
    let roomId = userRooms[sessionId];
    if (roomId && rooms[roomId]) {
        // Check if player is banned (resigned) from this specific room
        if (matchBannedPlayers[roomId] && matchBannedPlayers[roomId].has(sessionId)) {
            socket.emit('force_lobby');
            delete userRooms[sessionId];
        } else {
            let assignedColor = rooms[roomId].players[sessionId];
            if (!rooms[roomId].game.gameOver && assignedColor) {
                socket.join(roomId);
                socket.emit('match_found', { color: assignedColor, roomId });
                socket.emit('init_state', getInitState(roomId));
                console.log(`[RE-BIND] ${sessionId} -> ${roomId} (${assignedColor})`);
            } else {
                delete userRooms[sessionId];
            }
        }
    }

    socket.on('join_queue', (data) => {
        purgePlayer(socket.sessionId);
        waitingQueue.push({ socket, name: data.username || data.name || 'Guest', flag: data.flag || 'us', sessionId: socket.sessionId });
        processQueue();
    });

    socket.on('create_room', (data) => {
        purgePlayer(socket.sessionId);
        let code = generateRoomCode();
        customRooms[code] = { teamMode: data.teamMode || false, players: [{ socket, name: data.name, flag: data.flag, sessionId: socket.sessionId, isHost: true }] };
        socket.emit('custom_room_joined', { code, count: 1, names: [data.name], isHost: true });
    });

    socket.on('join_room', (data) => {
        let code = data.code ? data.code.toUpperCase() : null;
        if (customRooms[code] && customRooms[code].players.length < 4) {
            purgePlayer(socket.sessionId);
            customRooms[code].players.push({ socket, name: data.name, flag: data.flag, sessionId: socket.sessionId });
            let names = customRooms[code].players.map(p => p.name);
            customRooms[code].players.forEach(p => p.socket.emit('custom_room_joined', { code, count: customRooms[code].players.length, names, isHost: !!p.isHost }));
            if (customRooms[code].players.length === 4) processCustomRoom(code);
        } else { socket.emit('room_error', 'Oda bulunamadı veya dolmuş olabilir. Lütfen kodu kontrol edin.'); }
    });
    
    socket.on('leave_lobby', () => {
        console.log(`[LEAVE LOBBY] ${socket.sessionId}`);
        purgePlayer(socket.sessionId);
    });

    socket.on('start_game_now', () => {
        // Find the room where this socket is the host
        let code = Object.keys(customRooms).find(c => customRooms[c].players.some(p => p.sessionId === socket.sessionId && p.isHost));
        if (code) {
            console.log(`[MANUAL START] Host started room ${code}`);
            processCustomRoom(code);
        }
    });

    socket.on('make_move', (data) => {
        let roomId = userRooms[socket.sessionId];
        let room = rooms[roomId];
        if (!room) return socket.emit('move_error', 'Oda bulunamadı.');
        let playerColor = room.players[socket.sessionId];
        if (playerColor !== room.game.getCurrentTurnColor()) return socket.emit('move_error', 'Sıra sizde değil.');
        if (room.game.movePiece(data.fx, data.fy, data.tx, data.ty).success) {
            room.timeoutCounts[playerColor] = 0; // Reset timeouts on successful move
            room.lastMoveTime = Date.now();
            startTurnTimer(roomId);
            broadcastRoomState(roomId);
            triggerBotMove(roomId);
        } else { socket.emit('move_error', 'Geçersiz hamle.'); }
    });

    socket.on('chat_msg', (data) => {
        let roomId = userRooms[socket.sessionId];
        let room = rooms[roomId];
        if (!room) return;
        let color = room.players[socket.sessionId];
        io.to(roomId).emit('chat_msg', { color, name: room.playerNames[color], text: data.text });
    });

    socket.on('resign', () => {
        let roomId = userRooms[socket.sessionId];
        if (roomId) {
            if (!matchBannedPlayers[roomId]) matchBannedPlayers[roomId] = new Set();
            matchBannedPlayers[roomId].add(socket.sessionId);
            io.to(roomId).emit('chat_msg', { name: 'System', text: `A player resigned and left the match.`, color: 'red' });
        }
        purgePlayer(socket.sessionId);
        // Explicitly tell all client tabs for THIS session to go to lobby
        socket.emit('force_lobby'); 
    });

    socket.on('disconnect', () => {
        waitingQueue = waitingQueue.filter(p => p.sessionId !== socket.sessionId);
        if (waitingQueue.length === 0 && queueTimeoutInterval) {
            clearInterval(queueTimeoutInterval);
            queueTimeoutInterval = null;
        }
        broadcastQueueUpdate();
    });
});

// SPA catch-all: serve index.html for any unmatched route
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('4Chess - Server running');
    }
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
