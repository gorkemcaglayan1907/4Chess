const fs = require('fs');

// Patch CSS
fs.appendFileSync('style.css', "\n.piece.playable { cursor: pointer; }\n.piece.playable:hover { filter: drop-shadow(0px 0px 8px rgba(255, 255, 255, 0.9)) brightness(1.3); z-index: 20; }\n");

// Patch HTML
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('id="lang-toggle-btn"')) {
    html = html.replace(
        '<!-- Sound Toggle Button -->',
        `<!-- Language Toggle -->
    <select id="lang-toggle-btn" style="position:fixed; top:15px; left:15px; z-index:1000; background:var(--board-dark); border:1px solid var(--glass-border); color:white; padding:5px; border-radius:5px; font-weight:bold; cursor:pointer; outline:none;">
        <option value="en">🇬🇧 EN</option>
        <option value="tr">🇹🇷 TR</option>
    </select>
    
    <!-- Sound Toggle Button -->`
    );
    fs.writeFileSync('index.html', html);
}


let ui = fs.readFileSync('ui.js', 'utf8');

let i18nCode = `
const DICT = {
    en: {
        warn_landscape: "Please Rotate Your Device",
        warn_sub: "For the best experience, hold your device horizontally.",
        title_sub: "Join epic multiplayer matchmaking",
        placeholder_name: "Player Name",
        btn_quick: "Log In (Quick Play)",
        btn_create: "Create Room",
        btn_join_prompt: "Join Room",
        btn_leaderboard: "🏆 Leaderboard",
        placeholder_code: "Room Code",
        btn_join: "Connect",
        team_mode_txt: "2v2 Team Mode (Private Rooms Only)",
        lobby_title: "Matchmaking 🔍",
        queue_connecting: "Connecting...",
        bot_info: "Bots will fill empty seats when time runs out.",
        chat_title: "Game Chat",
        chat_placeholder: "Message...",
        btn_send: "Send",
        btn_resign: "🏳️ Resign",
        btn_close: "Close",
        leaderboard_empty: "No champions yet.",
        leaderboard_title: "🏆 Leaderboard",
        
        status_eliminated: "Eliminated",
        status_thinking: "Thinking...",
        status_waiting: "Waiting",
        status_game_over: "Game Over",
        turn: "Turn: ",
        points: "Score: ",
        draw: "Draw!",
        wait_move: "Waiting for move...",
        
        win_wb: "Winner: White/Black Team!",
        win_br: "Winner: Blue/Red Team!",
        win_p: "Winner: ",
        
        colors: { white: 'White', blue: 'Blue', black: 'Black', red: 'Red' },
        
        resign_confirm: "Are you sure you want to resign? Your ally might be left alone!",
        err_code: "Invalid Room Code!",
        room_txt: "Room: ",
        room_wait: "Waiting..."
    },
    tr: {
        warn_landscape: "Lütfen Telefonunuzu Yatay Döndürün",
        warn_sub: "En iyi oyun deneyimi için cihazınız yan konumda olmalıdır.",
        title_sub: "Destansı çok oyunculu oyuna katıl",
        placeholder_name: "Oyuncu Adınız",
        btn_quick: "Giriş Yap (Hızlı Oyna)",
        btn_create: "Oda Kur",
        btn_join_prompt: "Odaya Katıl",
        btn_leaderboard: "🏆 Liderlik Tablosu",
        placeholder_code: "Oda Kodu",
        btn_join: "Bağlan",
        team_mode_txt: "2v2 Takım (Beyaz&Siyah vs Mavi&Kırmızı) Sadece Özel Odalar için",
        lobby_title: "Eşleştirme Bekleniyor 🔍",
        queue_connecting: "Bağlanılıyor...",
        bot_info: "Süre dolduğunda boş koltuklara botlar eklenecek.",
        chat_title: "Oyun Sohbeti",
        chat_placeholder: "Mesajınız...",
        btn_send: "Gönder",
        btn_resign: "🏳️ Pes Et",
        btn_close: "Kapat",
        leaderboard_empty: "Henüz kimse şampiyon olmadı.",
        leaderboard_title: "🏆 Liderler Sıralaması",
        
        status_eliminated: "Elendi",
        status_thinking: "Düşünüyor...",
        status_waiting: "Bekliyor",
        status_game_over: "Oyun Bitti",
        turn: "Sıra: ",
        points: "Puan: ",
        draw: "Berabere!",
        wait_move: "Hamle bekleniyor",
        
        win_wb: "Kazanan: Beyaz/Siyah Takımı!",
        win_br: "Kazanan: Mavi/Kırmızı Takımı!",
        win_p: "Kazanan: ",
        
        colors: { white: 'Beyaz', blue: 'Mavi', black: 'Siyah', red: 'Kırmızı' },
        
        resign_confirm: "Gerçekten pes etmek ve çekilmek istiyor musunuz? Müttefikiniz zor durumda kalabilir!",
        err_code: "Geçersiz Oda Kodu!",
        room_txt: "Oda: ",
        room_wait: "Bekleniyor..."
    }
};

let currentLang = localStorage.getItem('4chess_lang') || 'en';
let TR_COLORS = DICT[currentLang].colors; // update immediately

function executeI18N() {
    let d = DICT[currentLang];
    TR_COLORS = d.colors;
    
    let el = (id) => document.getElementById(id);
    let setEl = (id, txt) => { if(el(id)) el(id).innerText = txt; };
    let setPl = (id, txt) => { if(el(id)) el(id).placeholder = txt; };
    
    if(el('landscape-warning')) {
        let wrn = el('landscape-warning');
        wrn.childNodes[2].nodeValue = " " + d.warn_landscape + " ";
        wrn.querySelector('p').innerText = d.warn_sub;
    }
    
    if(el('login-screen')) {
        el('login-screen').querySelector('p').innerText = d.title_sub;
        setPl('username-input', d.placeholder_name);
        setEl('btn-quick-play', d.btn_quick);
        setEl('btn-create-room', d.btn_create);
        setEl('btn-join-room-prompt', d.btn_join_prompt);
        setEl('btn-leaderboard', d.btn_leaderboard);
        setPl('room-code-input', d.placeholder_code);
        setEl('btn-join-room', d.btn_join);
        let tmLbl = document.querySelector('label[style*="color:#94a3b8"] span');
        if(tmLbl) tmLbl.innerText = d.team_mode_txt;
    }
    
    if(el('lobby-screen')) {
        el('lobby-screen').querySelector('h2').innerText = d.lobby_title;
        if(el('queue-status').innerText.includes('Bağlanılıyor') || el('queue-status').innerText.includes('Connecting')) {
            setEl('queue-status', d.queue_connecting);
        }
        el('lobby-screen').querySelector('p.small-text').innerText = d.bot_info;
    }
    
    if(el('chat-header')) {
        let closeSpan = el('chat-close-btn');
        el('chat-header').innerHTML = d.chat_title;
        el('chat-header').appendChild(closeSpan);
        setPl('chat-input', d.chat_placeholder);
        setEl('btn-send-chat', d.btn_send);
        setEl('chat-toggle-btn', "💬 " + d.chat_title);
    }
    
    setEl('btn-resign', d.btn_resign);
    setEl('btn-close-leaderboard', d.btn_close);
    if(el('leaderboard-modal')) {
        el('leaderboard-modal').querySelector('h2').innerText = d.leaderboard_title;
    }
    
    if(typeof game !== 'undefined' && game) { updateUI(); }
}

window.addEventListener('DOMContentLoaded', () => {
    let ls = document.getElementById('lang-toggle-btn');
    if(ls) {
        ls.value = currentLang;
        ls.addEventListener('change', (e) => {
            currentLang = e.target.value;
            localStorage.setItem('4chess_lang', currentLang);
            executeI18N();
        });
        executeI18N();
    }
});
`;

if (!ui.includes('const DICT = {')) {
    ui = ui.replace('let soundEnabled = true;', 'let soundEnabled = true;\n' + i18nCode);
    
    // Replace struct
    ui = ui.replace(/const TR_COLORS = \{[\s\S]*?\};/, '// TR_COLORS dynamic map');
    
    ui = ui.replace(/status\.innerText \= "Elendi";/g, 'status.innerText = DICT[currentLang].status_eliminated;');
    ui = ui.replace(/status\.innerText \= "Düşünüyor\.\.\.";/g, 'status.innerText = DICT[currentLang].status_thinking;');
    ui = ui.replace(/status\.innerText \= "Bekliyor";/g, 'status.innerText = DICT[currentLang].status_waiting;');
    ui = ui.replace(/statusText\.innerText \= "Hamle bekleniyor";/g, 'statusText.innerText = DICT[currentLang].wait_move;');
    ui = ui.replace(/statusText\.innerText \= "Oyun Bitti";/g, 'statusText.innerText = DICT[currentLang].status_game_over;');
    ui = ui.replace(/indicator\.innerText \= \`Sıra: \$\{turnOwnerName\}\`;/g, 'indicator.innerText = `${DICT[currentLang].turn}${turnOwnerName}`;');
    ui = ui.replace(/scoreField\.innerText \= \`Puan: \$\{\(game\.scores \&\& game\.scores\[c\]\) \|\| 0\}\`;/g, 'scoreField.innerText = `${DICT[currentLang].points}${(game.scores && game.scores[c]) || 0}`;');
    
    ui = ui.replace(
        /let text \= w \? \(game\.teamMode \? \(w\=\=\='white' \? 'Kazanan: Beyaz\/Siyah Takımı!' : 'Kazanan: Mavi\/Kırmızı Takımı!'\) : \`Kazanan: \$\{playerNamesMap\[w\]\}!\`\) : "Berabere!";/g,
        'let text = w ? (game.teamMode ? (w==="white" ? DICT[currentLang].win_wb : DICT[currentLang].win_br) : `${DICT[currentLang].win_p}${playerNamesMap[w]}!`) : DICT[currentLang].draw;'
    );
    
    ui = ui.replace(/alert\("Geçersiz Oda Kodu!"\);/g, 'alert(DICT[currentLang].err_code);');
    ui = ui.replace(/if \(confirm\("Gerçekten pes etmek.*?"\)\) \{/, 'if (confirm(DICT[currentLang].resign_confirm)) {');
    
    ui = ui.replace(/\`Oda: \$\{data\.code\} \| Oyuncular: \$\{data\.count\} \/ 4\`/g, '`${DICT[currentLang].room_txt}${data.code} | ${data.count} / 4`');
    ui = ui.replace(/"Bekleniyor\.\.\."/g, 'DICT[currentLang].room_wait');
    
    fs.writeFileSync('ui.js', ui);
}
