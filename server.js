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
const VALID_BOT_FLAGS = ['tr', 'us', 'gb', 'de', 'jp', 'kr', 'it', 'fr', 'es'];

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
        // Zamanlayıcıyı durdur
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
        const validBotFlags = ['tr', 'us', 'gb', 'de', 'jp', 'kr'];
        availableColors.forEach(botColor => {
            bots.push(botColor);
            playerNames[botColor] = "Zorlu Bot " + botCount;
            playerFlags[botColor] = validBotFlags[Math.floor(Math.random() * validBotFlags.length)];
            botCount++;
        });

        rooms[roomId] = { game, players, playerNames, playerFlags, bots, turnTimer: null, turnEndTime: 0 };
        
        secondsLeft = 15; // Sonraki sıra için reset
        startTurnTimer(roomId);
        startGameLoop(roomId);
        
        if (waitingQueue.length > 0) processQueue();
    } else {
        // Bekleyen sayısı 4 ten azsa Timer'i aktifleştir
        if (!queueTimeoutInterval && waitingQueue.length > 0) {
            secondsLeft = 15;
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

    if (room.game.gameOver && !room.savedScores) {
        room.savedScores = true;
        for(let c of CHESS_COLORS) {
            if (!room.bots.includes(c) && room.playerNames[c] && !room.playerNames[c].startsWith("Misafir")) {
                 let pts = room.game.scores[c] || 0;
                 if (room.game.winner === c) pts += 50;
                 updateLeaderboard(room.playerNames[c], pts);
            }
        }
    }

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
        teamMode: room.game.teamMode,
        serverTime: Date.now(),
        lastMove: room.game.lastMove,
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
        turnEndTime: room.turnEndTime,
        teamMode: room.game.teamMode,
        serverTime: Date.now(),
        lastMove: room.game.lastMove
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
        playerNames[color] = p.name || "Misafir";
        playerFlags[color] = p.flag || 'tr';
        userRooms[p.socket.id] = roomId;
        p.socket.join(roomId);
    });

    let botCount = 1;
    for(let i = pList.length; i < 4; i++) {
        let botColor = availableColors[i];
        bots.push(botColor);
        playerNames[botColor] = "Zorlu Bot " + botCount;
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

io.on('connection', (socket) => {
    
    socket.on('get_leaderboard', () => {
        socket.emit('leaderboard_res', leaderboard.slice(0, 10));
    });
    socket.on('join_queue', (data) => {
        let name = data.username.trim() || 'Misafir';
        if (name.length > 15) name = name.substring(0, 15);
        waitingQueue.push({ socket, username: name, flag: data.flag || 'tr' });
        processQueue();
    });

    socket.on('create_room', (data) => {
        if (waitingQueue.some(p => p.socket.id === socket.id)) return;
        
        let code = generateRoomCode();
        customRooms[code] = { teamMode: data.teamMode || false, players: [{ socket, name: data.name, flag: data.flag }] };
        socket.emit('custom_room_joined', { code, count: 1, names: [data.name] });
    });

    socket.on('join_room', (data) => {
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
               socket.emit('room_error', 'Oda zaten 4 kişi (Dolu).');
            }
        } else {
            socket.emit('room_error', 'Böyle bir oda kodu bulunamadı.');
        }
    });
    
    socket.on('force_start_room', (code) => {
        if (customRooms[code]) {
            // Sadece odada olan biri başlatabilir
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
        let roomId = userRooms[socket.id];
        let room = rooms[roomId];
        if (!room || room.game.gameOver) return;

        let color = room.players[socket.id];
        if (color && room.game.activePlayers[color] && !room.bots.includes(color)) {
            // Oyuncu pes ettiğinde taşları dondurmak yerine kontrolü Bota devrediyoruz
            room.bots.push(color);
            
            io.to(roomId).emit('chat_msg', { 
                color: color, 
                name: 'Sistem', 
                text: `${room.playerNames[color]} pes etti, yerine Yapay Zeka geçti!` 
            });

            broadcastRoomState(roomId);

            // Eğer sıra pes eden oyuncudaysa Botu hemen tetikle
            if (room.game.getCurrentTurnColor() === color) {
                triggerBotMove(roomId);
            }
        }
    });

    socket.on('chat_msg', (data) => {
        let roomId = userRooms[socket.id];
        let room = rooms[roomId];
        if (!room) return;

        let color = room.players[socket.id];
        if (!color) return;
        
        let name = room.playerNames[color];
        // Sadece odadakilere gönder
        io.to(roomId).emit('chat_msg', {
            color: color,
            name: name,
            text: data.text.substring(0, 80) // Maks 80 karakter
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
