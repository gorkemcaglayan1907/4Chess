const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');
server = server.replace(/turnEndTime: room\.turnEndTime,/g, 'turnEndTime: room.turnEndTime,\n        teamMode: room.game.teamMode,');
fs.writeFileSync('server.js', server);

let ui = fs.readFileSync('ui.js', 'utf8');
ui = ui.replace('turnEndTime = state.turnEndTime || 0;', 'turnEndTime = state.turnEndTime || 0;\n    game.teamMode = state.teamMode || false;');
fs.writeFileSync('ui.js', ui);
