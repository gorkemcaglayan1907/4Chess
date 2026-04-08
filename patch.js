const fs = require('fs');

// Patch engine.js
let engine = fs.readFileSync('engine.js', 'utf8');
engine = engine.replace(
    /if \(targetPiece\) \{\s*this\.scores\[piece\.color\] \+\= PIECE_VALUES\[targetPiece\.type\];\s*\}/,
    `if (targetPiece) {
            if (this.activePlayers[targetPiece.color]) {
                this.scores[piece.color] += PIECE_VALUES[targetPiece.type];
            }
        }`
);

engine = engine.replace(
    /this\.removePiecesOfColor\(eliminatedColor\);/g,
    `// this.removePiecesOfColor(eliminatedColor); // Artık donduruyoruz`
);

engine = engine.replace(
    /this\.removePiecesOfColor\(c\);/g,
    `// this.removePiecesOfColor(c); // Artık donduruyoruz`
);

fs.writeFileSync('engine.js', engine);

// Patch server.js
let server = fs.readFileSync('server.js', 'utf8');
if (!server.includes("socket.on('resign'")) {
    server = server.replace(
        /socket\.on\('chat_msg'/,
        `socket.on('resign', () => {
        let roomId = userRooms[socket.id];
        let room = rooms[roomId];
        if (!room || room.game.gameOver) return;

        let color = room.players[socket.id];
        if (color && room.game.activePlayers[color]) {
            room.game.activePlayers[color] = false;
            room.game.checkWinCondition();
            
            if (room.game.getCurrentTurnColor() === color) {
                room.game.nextTurn();
                if (!room.game.gameOver) {
                    let bestMove = room.game.getBestMove(room.game.getCurrentTurnColor());
                    // Let turn timer handle it naturally, or force next turn
                    // Wait, if it's player we shouldn't force bot. Just broadcast
                }
            }
            broadcastRoomState(roomId);
        }
    });

    socket.on('chat_msg'`
    );
    fs.writeFileSync('server.js', server);
}

// Patch style.css
let style = fs.readFileSync('style.css', 'utf8');
if (!style.includes('.cell.last-move')) {
    fs.appendFileSync('style.css', "\n.cell.last-move::after { content: ''; position: absolute; top:0; left:0; right:0; bottom:0; background-color: rgba(234, 179, 8, 0.4); pointer-events: none; }\n");
}
