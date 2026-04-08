const fs = require('fs');

// Patch server.js
let server = fs.readFileSync('server.js', 'utf8');

const leaderboardCode = `let leaderboard = [];
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

`;

if (!server.includes('let leaderboard = []')) {
    server = server.replace("const { GameEngine, CHESS_COLORS } = require('./engine.js');", "const { GameEngine, CHESS_COLORS } = require('./engine.js');\nconst fs = require('fs');\n" + leaderboardCode);
}

// In broadcastRoomState
let broadcastMatch = `function broadcastRoomState(roomId, promoted = false) {
    let room = rooms[roomId];
    if (!room) return;`;

let broadcastNew = `function broadcastRoomState(roomId, promoted = false) {
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
    }`;

if (!server.includes('room.savedScores = true')) {
    server = server.replace(broadcastMatch, broadcastNew);
}

// Add leaderboard getter endpoint
let getLeaderboardCode = `
    socket.on('get_leaderboard', () => {
        socket.emit('leaderboard_res', leaderboard.slice(0, 10));
    });
`;

if (!server.includes("socket.on('get_leaderboard'")) {
    server = server.replace("socket.on('join_queue',", getLeaderboardCode + "    socket.on('join_queue',");
}

fs.writeFileSync('server.js', server);

// Patch index.html
let html = fs.readFileSync('index.html', 'utf8');
let modalStr = `
    <!-- Leaderboard Modal -->
    <div id="leaderboard-modal" class="hidden">
        <div class="modal-content" style="max-width: 400px; width: 100%;">
            <h2 style="color: #eab308; margin-bottom: 20px;">🏆 Liderler Sıralaması</h2>
            <div id="leaderboard-list" style="max-height: 300px; overflow-y: auto; text-align: left; padding: 10px; background: rgba(0,0,0,0.3); border-radius: 8px;">
                Yükleniyor...
            </div>
            <button id="btn-close-leaderboard" style="width: 100%; margin-top: 15px; background: var(--board-dark);">Kapat</button>
        </div>
    </div>
    <script src="`;
if (!html.includes('leaderboard-modal')) {
    html = html.replace('    <script src="', modalStr);
    fs.writeFileSync('index.html', html);
}

// Patch ui.js
let ui = fs.readFileSync('ui.js', 'utf8');
let uiAdd = `
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
`;

if (!ui.includes('btn-close-leaderboard')) {
    ui = ui + "\n" + uiAdd;
    fs.writeFileSync('ui.js', ui);
}
