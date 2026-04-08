const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

const { GameEngine, CHESS_COLORS } = require('./engine.js');
const fs = require('fs');
let leaderboard = [];
try {
    if (fs.existsSync('leaderboard.json')) leaderboard = JSON.parse(fs.readFileSync('leaderboard.json', 'utf8'));
} catch(e){}

function updateLeaderboard(name, points) {
    if (!name || points <= 0) return;
    let entry = leaderboard.find(l => l.name === name);
    if (entry) entry.score += points;
    else leaderboard.push({ name, score: points });
    leaderboard.sort((a,b) => b.score - a.score);
    fs.writeFileSync('leaderboard.json', JSON.stringify(leaderboard));
}

app.use(express.static(__dirname));

let waitingQueue = []; 
let queueTimeoutInterval = null;
let secondsLeft = 15;

let customRooms = {}; // { 'A1B2': { players: [], timeout: null } }
let leaverBans = {}; // { username: timestamp }
const VALID_BOT_FLAGS = ['us', 'gb', 'de', 'jp', 'kr', 'it', 'fr', 'es'];

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for(let i=0; i<4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

let rooms = {}; 
let userRooms = {}; 

function generateId() {
    return Math.random().toString(36).substring(2, 9);
}

const TURN_TIME_MS = 20000;

function processQueue(forceStart = false) {
    if (waitingQueue.length === 0) return;
    
    let isFull = waitingQueue.length >= 4;
    
    if (isFull || forceStart) {
        if (queueTimeoutInterval) {
            clearInterval(queueTimeoutInterval);
            queueTimeoutInterval = null;
        }

        let playersInMatch = waitingQueue.splice(0, 4);
        let roomId = generateId();
        let game = new GameEngine();
        game.turnIndex = Math.floor(Math.random() * 4);
        game.teamMode = false;
        let players = {};
        let playerNames = {};
        let playerFlags = {};
        let bots = [];

        let availableColors = [...CHESS_COLORS];
        
        playersInMatch.forEach((p) => {
            let assignedColor = availableColors.shift();
            players[p.socket.id] = assignedColor;
            playerNames[assignedColor] = p.username || "Guest";
            playerFlags[assignedColor] = p.flag || "us";
            userRooms[p.socket.id] = roomId;
            p.socket.join(roomId);
            
            p.socket.emit('match_found', {
                color: assignedColor,
                roomId: roomId
            });
        });

        // Bot default flags
        let botCount = 1;
        const validBotFlags = ['us', 'gb', 'de', 'jp', 'kr'];
        availableColors.forEach(botColor => {
            bots.push(botColor);
            playerNames[botColor] = "Master Bot " + botCount;
            playerFlags[botColor] = validBotFlags[Math.floor(Math.random() * validBotFlags.length)];
            botCount++;
        });

        rooms[roomId] = { game, players, playerNames, playerFlags, bots, turnTimer: null, turnEndTime: 0 };
        
        secondsLeft = 15;
        startTurnTimer(roomId);
        startGameLoop(roomId);
        
        if (waitingQueue.length > 0) processQueue();
    } else {
        if (!queueTimeoutInterval && waitingQueue.length > 0) {
            secondsLeft = 15;
            queueTimeoutInterval = setInterval(() => {
                secondsLeft--;
                broadcastQueueUpdate();
                if (secondsLeft <= 0) {
                    processQueue(true);
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

    if (room.game.gameOver && !room.savedScores) {
        room.savedScores = true;
        for(let c of CHESS_COLORS) {
            if (!room.bots.includes(c) && room.playerNames[c] && !room.playerNames[c].startsWith("Guest")) {
                 let pts = room.game.scores[c] || 0;
                 if (room.game.winner === c) pts += 50;
                 updateLeaderboard(room.playerNames[c], pts);
            }
        }
        // Cleanup room after 5 minutes of inactivity if game is over
        setTimeout(() => {
            if (rooms[roomId] && rooms[roomId].game.gameOver) {
                console.log(`[SERVER] Cleaning up finished room: ${roomId}`);
                if (rooms[roomId].turnTimer) clearTimeout(rooms[roomId].turnTimer);
                delete rooms[roomId];
            }
        }, 300000);
    }

    io.to(roomId).emit('state_update', {
        board: room.game.board,
        turnIndex: room.game.turnIndex,
        scores: room.game.scores,
        activePlayers: room.game.activePlayers,
        gameOver: room.game.gameOver,
        winner: room.game.winner,
        turnEndTime: room.turnEndTime,
        serverTime: Date.now(),
        lastMove: room.game.lastMove,
        promoted: promoted,
        roomId: roomId
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
        turnEndTime: room.turnEndTime,
        teamMode: room.game.teamMode,
        serverTime: Date.now(),
        lastMove: room.game.lastMove,
        roomId: roomId
    });
    triggerBotMove(roomId);
}

function processCustomRoom(code) {
    let roomData = customRooms[code];
    if (!roomData) return;
    
    let pList = roomData.players;
    if (pList.length === 0) {
        delete customRooms[code];
        return;
    }
    
    let roomId = "room_" + Math.random().toString(36).substring(7);
    let game = new GameEngine();
    game.turnIndex = Math.floor(Math.random() * 4);
    game.teamMode = roomData.teamMode || false;
    
    let players = {};
    let playerNames = {};
    let playerFlags = {};
    let bots = [];
    
    let availableColors = [...CHESS_COLORS];
    pList.forEach((p, index) => {
        let color = availableColors[index];
        players[p.socket.id] = color;
        playerNames[color] = p.name || "Guest";
        playerFlags[color] = p.flag || 'us';
        userRooms[p.socket.id] = roomId;
        p.socket.join(roomId);
    });

    let botCount = 1;
    for(let i = pList.length; i < 4; i++) {
        let botColor = availableColors[i];
        bots.push(botColor);
        playerNames[botColor] = "Master Bot " + botCount;
        playerFlags[botColor] = VALID_BOT_FLAGS[Math.floor(Math.random() * VALID_BOT_FLAGS.length)];
        botCount++;
    }

    rooms[roomId] = { game, players, playerNames, playerFlags, bots, turnTimer: null, turnEndTime: 0 };
    
    startTurnTimer(roomId);
    startGameLoop(roomId);
    
    pList.forEach(p => {
        p.socket.emit('match_found', { color: players[p.socket.id], roomId: roomId });
    });
    
    delete customRooms[code];
}

function purgePlayer(socket) {
    console.log(`[SERVER] Purging player: ${socket.id}`);
    waitingQueue = waitingQueue.filter(p => p.socket.id !== socket.id);

    let oldRoomId = userRooms[socket.id];
    if (oldRoomId) {
        if (rooms[oldRoomId]) {
            let room = rooms[oldRoomId];
            let color = room.players[socket.id];
            if (color && !room.game.gameOver) {
                let name = room.playerNames[color];
                
                // LEAVER PENALTY
                if (name && !name.startsWith("Guest")) {
                    updateLeaderboard(name, -100);
                    leaverBans[name] = Date.now() + 180000; // 3 min ban
                    socket.emit('ban_status', { bannedUntil: leaverBans[name] });
                }

                room.bots.push(color);
                delete room.players[socket.id];

                io.to(oldRoomId).emit('chat_msg', { 
                    color: color, 
                    name: 'System', 
                    text: `${room.playerNames[color]} left the room, AI took over!`,
                    roomId: oldRoomId
                });

                if (room.game.getCurrentTurnColor() === color) {
                    triggerBotMove(oldRoomId);
                }
                broadcastRoomState(oldRoomId);

                // If no more human players are left, cleanup room after 30 seconds
                if (Object.keys(room.players).length === 0) {
                    setTimeout(() => {
                        if (rooms[oldRoomId] && Object.keys(rooms[oldRoomId].players).length === 0) {
                            console.log(`[SERVER] Cleaning up empty room: ${oldRoomId}`);
                            if (rooms[oldRoomId].turnTimer) clearTimeout(rooms[oldRoomId].turnTimer);
                            delete rooms[oldRoomId];
                        }
                    }, 30000);
                }
            }
        }
        socket.rooms.forEach(room => {
            if (room !== socket.id) socket.leave(room);
        });
        delete userRooms[socket.id];
    }

    for (let code in customRooms) {
        customRooms[code].players = customRooms[code].players.filter(p => p.socket.id !== socket.id);
        if (customRooms[code].players.length === 0) {
            delete customRooms[code];
        }
    }
}

io.on('connection', (socket) => {
    console.log(`[SERVER] New connection: ${socket.id}`);
    
    socket.on('get_leaderboard', () => {
        socket.emit('leaderboard_res', leaderboard.slice(0, 10));
    });

    socket.on('join_queue', (data) => {
        let name = data.username.trim() || 'Guest';
        if (leaverBans[name] && leaverBans[name] > Date.now()) {
            return socket.emit('room_error', `You are banned for ${Math.ceil((leaverBans[name] - Date.now()) / 1000)} more seconds.`);
        }
        purgePlayer(socket);
        if (name.length > 15) name = name.substring(0, 15);
        waitingQueue.push({ socket, username: name, flag: data.flag || 'us' });
        processQueue();
    });

    socket.on('create_room', (data) => {
        let name = data.name.trim() || 'Guest';
        if (leaverBans[name] && leaverBans[name] > Date.now()) {
            return socket.emit('room_error', `You are banned for ${Math.ceil((leaverBans[name] - Date.now()) / 1000)} more seconds.`);
        }
        purgePlayer(socket);
        let code = generateRoomCode();
        customRooms[code] = { teamMode: data.teamMode || false, players: [{ socket, name: data.name, flag: data.flag }] };
        socket.emit('custom_room_joined', { code, count: 1, names: [data.name] });
    });

    socket.on('join_room', (data) => {
        let name = data.name.trim() || 'Guest';
        if (leaverBans[name] && leaverBans[name] > Date.now()) {
            return socket.emit('room_error', `You are banned for ${Math.ceil((leaverBans[name] - Date.now()) / 1000)} more seconds.`);
        }
        purgePlayer(socket);
        let code = data.code.toUpperCase();
        if (customRooms[code]) {
            if (customRooms[code].players.length < 4) {
               customRooms[code].players.push({ socket, name: data.name, flag: data.flag });
               let names = customRooms[code].players.map(p => p.name);
               customRooms[code].players.forEach(p => {
                   p.socket.emit('custom_room_joined', { code, count: customRooms[code].players.length, names });
               });
               if (customRooms[code].players.length === 4) {
                   processCustomRoom(code);
               }
            } else {
               socket.emit('room_error', 'The room is already full (4/4).');
            }
        } else {
            socket.emit('room_error', 'Room code not found.');
        }
    });
    
    socket.on('force_start_room', (code) => {
        if (customRooms[code]) {
            let isInside = customRooms[code].players.some(p => p.socket.id === socket.id);
            if (isInside) {
                processCustomRoom(code);
            }
        }
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

    socket.on('resign', () => {
        purgePlayer(socket);
    });

    socket.on('chat_msg', (data) => {
        let roomId = userRooms[socket.id];
        let room = rooms[roomId];
        if (!room) return;

        let color = room.players[socket.id];
        if (!color) return;
        
        let name = room.playerNames[color];
        io.to(roomId).emit('chat_msg', {
            color: color,
            name: name,
            text: data.text.substring(0, 80),
            roomId: roomId
        });
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
