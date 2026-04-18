const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 5e6 // 5MB
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

// Persistent Leaderboard Logic
let leaderboard = []; 
const LEADERBOARD_PATH = path.join(__dirname, 'leaderboard.json');

try {
    if (fs.existsSync(LEADERBOARD_PATH)) {
        leaderboard = JSON.parse(fs.readFileSync(LEADERBOARD_PATH, 'utf8'));
    }
} catch (e) { console.error("[LEADERBOARD] Load error:", e); }

function updateLeaderboard(name, points, avatar) {
    if (!name || name === '...' || name.includes('Bot')) return;
    console.log(`[LEADERBOARD] Update for ${name}: points=${points}, avatarReceived=${!!avatar}`);
    let entry = leaderboard.find(l => l.name === name);
    if (entry) {
        entry.score += points;
        entry.gamesPlayed = (entry.gamesPlayed || 0) + 1;
        if (avatar) {
            console.log(`[LEADERBOARD] Updating avatar for ${name} (len: ${avatar.length})`);
            entry.avatar = avatar; 
        }
    } else {
        console.log(`[LEADERBOARD] Creating NEW entry for ${name} with avatar=${!!avatar}`);
        leaderboard.push({ name, score: points, gamesPlayed: 1, avatar });
    }
    leaderboard.sort((a, b) => b.score - a.score);
    // Keep top 100 in file to avoid bloat
    if (leaderboard.length > 100) leaderboard = leaderboard.slice(0, 100);
    try {
        fs.writeFileSync(LEADERBOARD_PATH, JSON.stringify(leaderboard));
    } catch (e) {
        console.error("[LEADERBOARD] Save error:", e);
    }
}


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
    game.turnIndex = Math.floor(Math.random() * 4); 
    game.teamMode = roomData.teamMode || false;

    let players = {}; 
    let playerNames = {};
    let playerAvatars = {};
    let playerFlags = {};
    let bots = [];
    
    // Shuffle available colors properly (Fisher-Yates)
    let availableColors = [...CHESS_COLORS];
    for (let i = availableColors.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableColors[i], availableColors[j]] = [availableColors[j], availableColors[i]];
    }

    playersInMatch.forEach((p, idx) => {
        let assignedColor = availableColors.shift();
        let sid = p.sessionId;
        
        // Force leave ANY old rooms
        let oldRoomId = userRooms[sid];
        if (oldRoomId) p.socket.leave(oldRoomId);

        players[sid] = assignedColor;
        playerNames[assignedColor] = p.name || "Guest";
        playerAvatars[assignedColor] = p.avatar || null;
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
        game, players, playerNames, playerAvatars, playerFlags, bots, 
        isQuickPlay: !!roomData.isQuickPlay,
        turnTimer: null, turnEndTime: 0, 
        lastMoveTime: Date.now(),
        createdAt: Date.now(),
        timeoutCounts: { white: 0, black: 0, blue: 0, red: 0 },
        isCalculating: false,
        updatedPlayers: [] // Use array for easier JSON tracking, though we treat it as a set
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
            setupMatch(playersInMatch, { isQuickPlay: true });
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
    if (!room || room.game.gameOver || room.isCalculating) return false;
    room.isCalculating = true;
    let currentColor = room.game.getCurrentTurnColor();

    // Check if this is a player timeout (current color belongs to a human)
    let humanSessionId = Object.keys(room.players).find(sid => room.players[sid] === currentColor);
    if (humanSessionId) {
        room.timeoutCounts[currentColor]++;
        if (room.timeoutCounts[currentColor] >= 2) {
            console.log(`[KICK] Kicking ${room.playerNames[currentColor]} (${currentColor}) in ${roomId} for inactivity.`);
            room.bots.push(currentColor);
            if (room.isQuickPlay && !room.updatedPlayers.includes(humanSessionId)) {
                room.updatedPlayers.push(humanSessionId);
                updateLeaderboard(room.playerNames[currentColor], -50, room.playerAvatars[currentColor]);
            }
            delete room.players[humanSessionId];
            io.to(roomId).emit('chat_msg', { name: 'System', text: `${room.playerNames[currentColor]} kicked (-50 pts). Bot takes over.`, color: 'red' });
            
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

    const startTime = Date.now();
    try {
        let bestMove = room.game.getBestMove(currentColor);
        const calcTime = Date.now() - startTime;
        if (calcTime > 1000) console.log(`[PERF] Slow move calculation: ${calcTime}ms in ${roomId} for ${currentColor}`);

        if (bestMove) {
            let result = room.game.movePiece(bestMove.fx, bestMove.fy, bestMove.tx, bestMove.ty);
            room.lastMoveTime = Date.now();
            startTurnTimer(roomId);
            broadcastRoomState(roomId, result);
            triggerBotMove(roomId);
            return true;
        } else {
            // Fail-Safe: No best move found (engine hang or bug), pass turn
            console.log(`[FAILSAFE] No valid moves found for ${currentColor} in ${roomId}, passing turn.`);
            room.game.nextTurn();
            startTurnTimer(roomId);
            broadcastRoomState(roomId);
            triggerBotMove(roomId);
            return false;
        }
    } catch (e) { 
        console.error(`[CRITICAL ERR] ${roomId} during bot move:`, e);
        // Emergency recovery: Pass turn
        try {
            room.game.nextTurn();
            startTurnTimer(roomId);
            broadcastRoomState(roomId);
            triggerBotMove(roomId);
        } catch (innerE) { console.error(`[DOUBLE FAIL] ${roomId}:`, innerE); }
        return false;
    } finally {
        if (room) room.isCalculating = false;
    }
}

// Garbage Collection for Stale/Finished Rooms
setInterval(() => {
    const now = Date.now();
    Object.keys(rooms).forEach(rid => {
        const room = rooms[rid];
        const humanCount = Object.keys(room.players || {}).length;
        
        // Safety: check if any actual sockets are still joined to this room
        const roomSockets = io.sockets.adapter.rooms.get(rid);
        const connectedCount = roomSockets ? roomSockets.size : 0;
        
        // Rules for deletion:
        // 1. If game is NOT over and has connected human sockets, NEVER delete.
        // 2. If game IS over, wait 5 minutes before deleting unless it's completely empty.
        // 3. If room is completely empty (no connected sockets), delete after 60 seconds of inactivity.
        
        let deleteThreshold = 300000; // 5 minutes default for most cases
        
        if (room.game.gameOver) {
            // Game is over. If people are still connected, give them time (5 mins).
            // If NO ONE is connected, delete after 60s.
            deleteThreshold = (connectedCount === 0) ? 60000 : 300000;
        } else {
            // Game is NOT over.
            if (connectedCount > 0) return; // Active game with people watching/playing. Don't touch.
            
            // If no one is connected but there are "players" (humanCount > 0), they might have DC'd.
            // Give them 2 minutes to return before deleting the room due to "ghost" inactivity.
            deleteThreshold = (humanCount === 0) ? 60000 : 120000;
        }

        if (now - (room.lastMoveTime || room.createdAt) > deleteThreshold) {
            deleteRoom(rid);
        }
    });
}, 30000); // Check every 30 seconds

function startTurnTimer(roomId) {
    let room = rooms[roomId];
    if (!room || room.game.gameOver) return;
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnEndTime = Date.now() + TURN_TIME_MS;
    room.turnTimer = setTimeout(() => forceBotMove(roomId), TURN_TIME_MS);
}

function broadcastRoomState(roomId, moveResult = {}) {
    let room = rooms[roomId]; if (!room) return;

    // Update leaderboard when game ends
    if (room.game.gameOver && !room.savedScores) {
        room.savedScores = true;
        Object.keys(room.players).forEach(sid => {
            const color = room.players[sid];
            const name = room.playerNames[color];
            if (room.isQuickPlay && !room.updatedPlayers.includes(sid)) {
                room.updatedPlayers.push(sid);
                let pts = room.game.scores[color] || 0;
                if (room.game.winner === color) pts += 50; 
                updateLeaderboard(name, pts, room.playerAvatars[color]);
            }
        });
    }

    io.to(roomId).emit('state_update', {
        board: room.game.board, turnIndex: room.game.turnIndex,
        activePlayers: room.game.activePlayers, scores: room.game.scores, 
        playerAvatars: room.playerAvatars,
        gameOver: room.game.gameOver, winner: room.game.winner,
        turnEndTime: room.turnEndTime, serverTime: Date.now(), lastMove: room.game.lastMove, roomId: roomId,
        isQuickPlay: !!room.isQuickPlay,
        capture: moveResult.capture, check: moveResult.check, promoted: moveResult.promoted
    });
}

function getInitState(roomId) {
    let room = rooms[roomId]; if (!room) return null;
    return {
        board: room.game.board, turnIndex: room.game.turnIndex,
        activePlayers: room.game.activePlayers, scores: room.game.scores,
        gameOver: room.game.gameOver, winner: room.game.winner,
        playerNames: room.playerNames, playerAvatars: room.playerAvatars, playerFlags: room.playerFlags, turnEndTime: room.turnEndTime,
        serverTime: Date.now(), lastMove: room.game.lastMove, roomId: roomId,
        isQuickPlay: !!room.isQuickPlay
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
            if (room.isQuickPlay && !room.updatedPlayers.includes(sessionId)) {
                room.updatedPlayers.push(sessionId);
                updateLeaderboard(room.playerNames[color], -50, room.playerAvatars[color]); 
            }
            delete room.players[sessionId];
            io.to(roomId).emit('chat_msg', { name: 'System', text: `${room.playerNames[color]} left (-50 pts). Bot takes over.`, color: 'red' });
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
            if (assignedColor) {
                socket.join(roomId);
                socket.emit('match_found', { color: assignedColor, roomId });
                socket.emit('init_state', getInitState(roomId));
                console.log(`[RE-BIND] ${sessionId} -> ${roomId} (${assignedColor}) ${rooms[roomId].game.gameOver ? '(Game Over)' : ''}`);
            } else {
                delete userRooms[sessionId];
            }
        }
    }

    socket.on('join_queue', (data) => {
        purgePlayer(socket.sessionId);
        const name = data.username || data.name || 'Guest';
        const flag = data.flag || 'us';
        const avatar = data.avatar || null;
        console.log(`[JOIN_QUEUE] User: ${name}, Avatar length: ${avatar ? avatar.length : 0}`);
        userSessions[socket.sessionId] = { socketId: socket.id, name, flag, avatar };
        waitingQueue.push({ socket, name, flag, avatar, sessionId: socket.sessionId });
        processQueue();
    });

    socket.on('create_room', (data) => {
        purgePlayer(socket.sessionId);
        let code = generateRoomCode();
        const name = data.name || 'Guest';
        const flag = data.flag || 'us';
        const avatar = data.avatar || null;
        userSessions[socket.sessionId] = { socketId: socket.id, name, flag, avatar };
        customRooms[code] = { teamMode: data.teamMode || false, players: [{ socket, name, flag, avatar, sessionId: socket.sessionId, isHost: true }] };
        socket.emit('custom_room_joined', { code, count: 1, names: [name], isHost: true });
    });

    socket.on('join_room', (data) => {
        let code = data.code ? data.code.toUpperCase() : null;
        if (customRooms[code] && customRooms[code].players.length < 4) {
            purgePlayer(socket.sessionId);
            const name = data.name || 'Guest';
            const flag = data.flag || 'us';
            const avatar = data.avatar || null;
            userSessions[socket.sessionId] = { socketId: socket.id, name, flag, avatar };
            customRooms[code].players.push({ socket, name, flag, avatar, sessionId: socket.sessionId });
            let names = customRooms[code].players.map(p => p.name);
            customRooms[code].players.forEach(p => p.socket.emit('custom_room_joined', { code, count: customRooms[code].players.length, names, isHost: !!p.isHost }));
            if (customRooms[code].players.length === 4) processCustomRoom(code);
        } else { socket.emit('room_error', 'Room not found or might be full. Please check the code.'); }
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

    socket.on('get_leaderboard', (data) => {
        const myName = (data?.name || userSessions[socket.sessionId]?.name || "Guest").trim();
        const entry = leaderboard.find(l => l.name.trim().toLowerCase() === myName.toLowerCase());
        socket.emit('leaderboard_res', {
            top10: leaderboard.slice(0, 10),
            userStats: entry || { name: myName, score: 0, gamesPlayed: 0 }
        });
    });


    socket.on('make_move', (data) => {
        let roomId = userRooms[socket.sessionId];
        let room = rooms[roomId];
        if (!room) return socket.emit('move_error', 'Room not found.');
        let playerColor = room.players[socket.sessionId];
        if (playerColor !== room.game.getCurrentTurnColor()) return socket.emit('move_error', 'It is not your turn.');
        if (room.game.movePiece(data.fx, data.fy, data.tx, data.ty).success) {
            room.timeoutCounts[playerColor] = 0; // Reset timeouts on successful move
            room.lastMoveTime = Date.now();
            startTurnTimer(roomId);
            broadcastRoomState(roomId);
            triggerBotMove(roomId);
        } else { socket.emit('move_error', 'Invalid move.'); }
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
        if (roomId && rooms[roomId]) {
            let room = rooms[roomId];
            let color = room.players[socket.sessionId];
            if (color && !room.game.gameOver) {
                if (!matchBannedPlayers[roomId]) matchBannedPlayers[roomId] = new Set();
                matchBannedPlayers[roomId].add(socket.sessionId);
                
                if (room.isQuickPlay && !room.updatedPlayers.includes(socket.sessionId)) {
                    room.updatedPlayers.push(socket.sessionId);
                    updateLeaderboard(room.playerNames[color], -50);
                }
                io.to(roomId).emit('chat_msg', { name: 'System', text: `${room.playerNames[color]} resigned (-50 pts).`, color: 'red' });
                broadcastRoomState(roomId);
            }
        }
        purgePlayer(socket.sessionId);
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
