const fs = require('fs');

// Patch engine.js
let engine = fs.readFileSync('engine.js', 'utf8');

if (!engine.includes('isAlly(')) {
    engine = engine.replace(
        'this.lastMove = null;',
        'this.lastMove = null;\n        this.teamMode = false;\n'
    );
    
    // Add isAlly method
    engine = engine.replace(
        'getCurrentTurnColor() {',
        `isAlly(c1, c2) {
        if (!this.teamMode) return c1 === c2;
        if ((c1==='white'&&c2==='black') || (c1==='black'&&c2==='white')) return true;
        if ((c1==='blue'&&c2==='red') || (c1==='red'&&c2==='blue')) return true;
        return c1 === c2;
    }
    
    getCurrentTurnColor() {`
    );

    // Replace color inequality checks for capturing
    engine = engine.replace(/target\.color \!\=\= color/g, '!this.isAlly(target.color, color)');
    engine = engine.replace(/t\.color \!\=\= color/g, '!this.isAlly(t.color, color)');
    engine = engine.replace(/op\.color \!\=\= color/g, '!this.isAlly(op.color, color)');
    // In isCheck
    engine = engine.replace(/c \!\=\= color/g, '!this.isAlly(c, color)');

    // In checkWinCondition
    let checkWinOld = `        let activeCount = 0;
        let lastActive = null;
        for (let c of CHESS_COLORS) {
            if (this.activePlayers[c]) {
                activeCount++;
                lastActive = c;
            }
        }
        if (activeCount === 1) {
            this.gameOver = true;
            this.winner = lastActive;
        } else if (activeCount === 0) {
            this.gameOver = true; // Draw / everyone lost
        }`;

    let checkWinNew = `        if (this.teamMode) {
            let team1 = this.activePlayers['white'] || this.activePlayers['black'];
            let team2 = this.activePlayers['blue'] || this.activePlayers['red'];
            if (team1 && !team2) {
                this.gameOver = true;
                this.winner = 'white'; // Represents Team 1
            } else if (!team1 && team2) {
                this.gameOver = true;
                this.winner = 'blue'; // Represents Team 2
            } else if (!team1 && !team2) {
                this.gameOver = true;
            }
        } else {
            let activeCount = 0;
            let lastActive = null;
            for (let c of CHESS_COLORS) {
                if (this.activePlayers[c]) {
                    activeCount++;
                    lastActive = c;
                }
            }
            if (activeCount === 1) {
                this.gameOver = true;
                this.winner = lastActive;
            } else if (activeCount === 0) {
                this.gameOver = true; // Draw / everyone lost
            }
        }`;
    engine = engine.replace(checkWinOld, checkWinNew);

    fs.writeFileSync('engine.js', engine);
}

// Patch UI
let ui = fs.readFileSync('ui.js', 'utf8');
ui = ui.replace(
    /socket\.emit\('create_room', credentials\);/,
    "credentials.teamMode = document.getElementById('chk-team-mode').checked;\n    socket.emit('create_room', credentials);"
);
fs.writeFileSync('ui.js', ui);

// Patch server
let server = fs.readFileSync('server.js', 'utf8');
server = server.replace(
    /customRooms\[code\] = \{ players: \[\{ socket, name: data\.name, flag: data\.flag \}\] \};/,
    `customRooms[code] = { teamMode: data.teamMode || false, players: [{ socket, name: data.name, flag: data.flag }] };`
);
server = server.replace(
    /let game = new GameEngine\(\);/,
    `let game = new GameEngine();\n    game.teamMode = roomData.teamMode;`
);
fs.writeFileSync('server.js', server);

// Patch HTML
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace(
    /<div id="menu-actions"/,
    `<label style="color:#94a3b8; display:flex; align-items:center; gap:8px; margin-bottom:15px; background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px; cursor: pointer; text-align:left;"><input type="checkbox" id="chk-team-mode" style="width:20px; height:20px;"> <span>2v2 Takım (Beyaz&Siyah vs Mavi&Kırmızı) Sadece Özel Odalar için</span></label>\n            <div id="menu-actions"`
);
// Update winner text in ui.js
ui = fs.readFileSync('ui.js', 'utf8');
ui = ui.replace(
    /let text = w \? \`Kazanan: \$\{playerNamesMap\[w\]\}\!\` : "Berabere!";/,
    `let text = w ? (game.teamMode ? (w==='white' ? 'Kazanan: Beyaz/Siyah Takımı!' : 'Kazanan: Mavi/Kırmızı Takımı!') : \`Kazanan: \$\{playerNamesMap\[w\]\}!\`) : "Berabere!";`
);
fs.writeFileSync('ui.js', ui);

