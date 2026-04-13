const CHESS_COLORS = ['white', 'blue', 'black', 'red'];
const PIECES = {
    PAWN: 'pawn', ROOK: 'rook', KNIGHT: 'knight', BISHOP: 'bishop', QUEEN: 'queen', KING: 'king'
};
const PIECE_VALUES = {
    pawn: 1, knight: 3, bishop: 5, rook: 5, queen: 10, king: 100
};

class GameEngine {
    constructor() {
        this.board = this.createEmptyBoard();
        this.turnIndex = Math.floor(Math.random() * 4); // Start randomly (0=white, 1=blue, 2=black, 3=red)
        this.activePlayers = { white: true, blue: true, black: true, red: true };
        this.scores = { white: 0, blue: 0, black: 0, red: 0 };
        this.setupPieces();
        this.gameOver = false;
        this.winner = null;
        this.lastMove = null;
        this.teamMode = false;
        this.eliminationOrder = []; // Track who is eliminated 4th, 3rd, 2nd, etc.
    }

    getCurrentTurnColor() {
        return CHESS_COLORS[this.turnIndex];
    }

    createEmptyBoard() {
        let b = [];
        for (let y = 0; y < 14; y++) {
            let row = [];
            for (let x = 0; x < 14; x++) {
                if (this.isDeadSpace(x, y)) {
                    row.push(null);
                } else {
                    row.push({ piece: null });
                }
            }
            b.push(row);
        }
        return b;
    }

    isDeadSpace(x, y) {
        // Top-left 3x3
        if (x < 3 && y < 3) return true;
        // Top-right 3x3
        if (x > 10 && y < 3) return true;
        // Bottom-left 3x3
        if (x < 3 && y > 10) return true;
        // Bottom-right 3x3
        if (x > 10 && y > 10) return true;
        
        return false;
    }

    inBounds(x, y) {
        return x >= 0 && x <= 13 && y >= 0 && y <= 13 && !this.isDeadSpace(x, y);
    }

    setupPieces() {
        const backRank = [PIECES.ROOK, PIECES.KNIGHT, PIECES.BISHOP, PIECES.QUEEN, PIECES.KING, PIECES.BISHOP, PIECES.KNIGHT, PIECES.ROOK];
        
        let idCounter = 1;
        const generateId = (color, type) => `${color}_${type}_${idCounter++}`;

        // White (y = 13, y = 12)
        for (let i = 0; i < 8; i++) {
            let x = i + 3;
            this.board[13][x].piece = { type: backRank[i], color: 'white', id: generateId('white', backRank[i]) };
            this.board[12][x].piece = { type: PIECES.PAWN, color: 'white', id: generateId('white', PIECES.PAWN) };
        }
        // Black (y = 0, y = 1)
        for (let i = 0; i < 8; i++) {
            let x = i + 3;
            this.board[0][x].piece = { type: backRank[i], color: 'black', id: generateId('black', backRank[i]) };
            this.board[1][x].piece = { type: PIECES.PAWN, color: 'black', id: generateId('black', PIECES.PAWN) };
        }
        // Blue (x = 0, x = 1)
        for (let i = 0; i < 8; i++) {
            let y = i + 3;
            this.board[y][0].piece = { type: backRank[i], color: 'blue', id: generateId('blue', backRank[i]) };
            this.board[y][1].piece = { type: PIECES.PAWN, color: 'blue', id: generateId('blue', PIECES.PAWN) };
        }
        // Red (x = 13, x = 12)
        for (let i = 0; i < 8; i++) {
            let y = i + 3;
            this.board[y][13].piece = { type: backRank[i], color: 'red', id: generateId('red', backRank[i]) };
            this.board[y][12].piece = { type: PIECES.PAWN, color: 'red', id: generateId('red', PIECES.PAWN) };
        }
    }

    isAlly(c1, c2) {
        if (!this.teamMode) return c1 === c2;
        if ((c1==='white'&&c2==='black') || (c1==='black'&&c2==='white')) return true;
        if ((c1==='blue'&&c2==='red') || (c1==='red'&&c2==='blue')) return true;
        return c1 === c2;
    }
    
    getCurrentTurnColor() {
        return CHESS_COLORS[this.turnIndex];
    }

    nextTurn() {
        if (this.gameOver) return;
        
        let attempts = 0;
        do {
            this.turnIndex = (this.turnIndex + 1) % 4;
            attempts++;
            if (attempts > 5) break; 
        } while (!this.activePlayers[this.getCurrentTurnColor()]);
        
        // Re-evaluate win condition
        this.checkWinCondition();
    }

    removePiecesOfColor(color) {
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 14; x++) {
                if (this.inBounds(x, y) && this.board[y][x].piece && this.board[y][x].piece.color === color) {
                    this.board[y][x].piece = null;
                }
            }
        }
    }

    checkWinCondition() {
        if (this.teamMode) {
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
                // Add the winner as the last remaining (1st place)
                if (!this.eliminationOrder.includes(lastActive)) {
                    this.eliminationOrder.push(lastActive);
                }
                this.applyRankingBonuses();
            } else if (activeCount === 0) {
                this.gameOver = true; // Draw / everyone lost
                this.applyRankingBonuses();
            }
        }
    }

    applyRankingBonuses() {
        // Elimination Order contains players from 4th to 1st place
        // Index 0 = 4th place (-20)
        // Index 1 = 3rd place (0)
        // Index 2 = 2nd place (+20)
        // Index 3 = 1st place (+50)
        const bonuses = [-20, 0, 20, 50];
        this.eliminationOrder.forEach((color, index) => {
            if (bonuses[index] !== undefined) {
                this.scores[color] += bonuses[index];
            }
        });
    }

    hasOnlyKing(color) {
        let count = 0;
        let hasKing = false;
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 14; x++) {
                if (this.inBounds(x, y)) {
                    let p = this.board[y][x].piece;
                    if (p && p.color === color) {
                        count++;
                        if (p.type === PIECES.KING) hasKing = true;
                        if (count > 1) return false;
                    }
                }
            }
        }
        return count === 1 && hasKing;
    }

    getPieceAt(x, y, customBoard = null) {
        const b = customBoard || this.board;
        if (!this.inBounds(x, y)) return null;
        return b[y][x].piece;
    }

    getRawMoves(x, y, customBoard = null) {
        const b = customBoard || this.board;
        const pState = b[y][x].piece;
        if (!pState) return [];
        
        const type = pState.type;
        const color = pState.color;
        let moves = [];
        
        const addMoveIfValid = (nx, ny, canCapture = true, mustCapture = false) => {
            if (!this.inBounds(nx, ny)) return false;
            let target = b[ny][nx].piece;
            if (target) {
                if (canCapture && !this.isAlly(target.color, color)) {
                    moves.push({ x: nx, y: ny, capture: true });
                }
                return false; // Block sliding
            } else {
                if (!mustCapture) {
                    moves.push({ x: nx, y: ny, capture: false });
                }
                return true; // Can continue sliding
            }
        };

        const slide = (dx, dy) => {
            let nx = x + dx, ny = y + dy;
            while (addMoveIfValid(nx, ny)) {
                nx += dx; ny += dy;
            }
        };

        switch (type) {
            case PIECES.PAWN:
                let forward, startRow, captureOps;
                if (color === 'white') { forward = { dx: 0, dy: -1 }; startRow = 12; captureOps = [{dx: -1, dy: -1}, {dx: 1, dy: -1}]; }
                if (color === 'black') { forward = { dx: 0, dy: 1 }; startRow = 1; captureOps = [{dx: -1, dy: 1}, {dx: 1, dy: 1}]; }
                if (color === 'blue') { forward = { dx: 1, dy: 0 }; startRow = 1; captureOps = [{dx: 1, dy: -1}, {dx: 1, dy: 1}]; }
                if (color === 'red') { forward = { dx: -1, dy: 0 }; startRow = 12; captureOps = [{dx: -1, dy: -1}, {dx: -1, dy: 1}]; }
                
                // Normal move
                if (addMoveIfValid(x + forward.dx, y + forward.dy, false, false)) {
                    // Double move from start
                    let isStartPos = (color === 'white' && y === startRow) || 
                                     (color === 'black' && y === startRow) ||
                                     (color === 'blue' && x === startRow) || 
                                     (color === 'red' && x === startRow);
                    if (isStartPos) {
                        addMoveIfValid(x + forward.dx*2, y + forward.dy*2, false, false);
                    }
                }
                // Captures
                for (let cap of captureOps) {
                    if (this.inBounds(x + cap.dx, y + cap.dy)) {
                        let t = b[y+cap.dy][x+cap.dx].piece;
                        if (t && !this.isAlly(t.color, color)) {
                            addMoveIfValid(x + cap.dx, y + cap.dy, true, true);
                        }
                    }
                }
                break;
            case PIECES.KNIGHT:
                const knMoves = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
                knMoves.forEach(m => addMoveIfValid(x + m[0], y + m[1]));
                break;
            case PIECES.KING:
                const kMoves = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
                kMoves.forEach(m => addMoveIfValid(x + m[0], y + m[1]));
                
                // CASTLING (ROK) LOGIC
                if (!pState.moved) {
                    const checkCastle = (rookX, rookY, emptyCoords, targetX, targetY) => {
                        const rookPiece = b[rookY][rookX].piece;
                        if (rookPiece && rookPiece.type === PIECES.ROOK && !rookPiece.moved) {
                            if (emptyCoords.every(c => !b[c.y][c.x].piece)) {
                                moves.push({ x: targetX, y: targetY, castling: true, rookX, rookY });
                            }
                        }
                    };

                    if (color === 'white') {
                        checkCastle(10, 13, [{x:8, y:13}, {x:9, y:13}], 9, 13); // O-O
                        checkCastle(3, 13, [{x:4, y:13}, {x:5, y:13}, {x:6, y:13}], 5, 13); // O-O-O
                    } else if (color === 'black') {
                        checkCastle(10, 0, [{x:8, y:0}, {x:9, y:0}], 9, 0); // O-O
                        checkCastle(3, 0, [{x:4, y:0}, {x:5, y:0}, {x:6, y:0}], 5, 0); // O-O-O
                    } else if (color === 'blue') {
                        checkCastle(0, 10, [{x:0, y:8}, {x:0, y:9}], 0, 9); // O-O
                        checkCastle(0, 3, [{x:0, y:4}, {x:0, y:5}, {x:0, y:6}], 0, 5); // O-O-O
                    } else if (color === 'red') {
                        checkCastle(13, 10, [{x:13, y:8}, {x:13, y:9}], 13, 9); // O-O
                        checkCastle(13, 3, [{x:13, y:4}, {x:13, y:5}, {x:13, y:6}], 13, 5); // O-O-O
                    }
                }
                break;
            case PIECES.ROOK:
                slide(1, 0); slide(-1, 0); slide(0, 1); slide(0, -1);
                break;
            case PIECES.BISHOP:
                slide(1, 1); slide(-1, -1); slide(1, -1); slide(-1, 1);
                break;
            case PIECES.QUEEN:
                slide(1, 0); slide(-1, 0); slide(0, 1); slide(0, -1);
                slide(1, 1); slide(-1, -1); slide(1, -1); slide(-1, 1);
                break;
        }
        return moves;
    }

    cloneBoard(b) {
        return b.map(row => row.map(cell => {
            if (!cell) return null; // dead space
            return { piece: cell.piece ? { ...cell.piece } : null };
        }));
    }

    getValidMoves(x, y) {
        const rawMoves = this.getRawMoves(x, y);
        const color = this.board[y][x].piece.color;
        
        let valid = [];
        for (let mv of rawMoves) {
            // CASTLING SPECIAL SAFETY: Cannot castle through check or into check
            if (mv.castling) {
                if (this.isCheck(color, this.board)) continue; // Cannot castle OUT OF check
                
                // Check intermediate square
                const interX = (x + mv.x) / 2;
                const interY = (y + mv.y) / 2;
                const interB = this.cloneBoard(this.board);
                interB[interY][interX].piece = interB[y][x].piece;
                interB[y][x].piece = null;
                if (this.isCheck(color, interB)) continue; // Cannot castle THROUGH check
            }

            const nextB = this.cloneBoard(this.board);
            // Simulate move
            nextB[mv.y][mv.x].piece = nextB[y][x].piece;
            nextB[y][x].piece = null;
            // Check if leaves king in check
            if (!this.isCheck(color, nextB)) {
                valid.push(mv);
            }
        }
        return valid;
    }

    getPieceSummary(b = this.board) {
        let summary = {
            kings: {},
            activePieces: []
        };
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 14; x++) {
                if (this.inBounds(x, y)) {
                    let p = b[y][x].piece;
                    if (p) {
                        let pObj = { x, y, piece: p };
                        summary.activePieces.push(pObj);
                        if (p.type === PIECES.KING) {
                            summary.kings[p.color] = { x, y };
                        }
                    }
                }
            }
        }
        return summary;
    }

    isCheck(color, b = this.board, optionalSummary = null) {
        const summary = optionalSummary || this.getPieceSummary(b);
        const kpos = summary.kings[color];
        if (!kpos) return false; 

        for (let pObj of summary.activePieces) {
            const p = pObj.piece;
            if (!this.isAlly(p.color, color) && this.activePlayers[p.color]) {
                let ops = this.getRawMoves(pObj.x, pObj.y, b);
                if (ops.some(m => m.x === kpos.x && m.y === kpos.y)) {
                    return true;
                }
            }
        }
        return false;
    }

    isCheckmate(color, b = this.board) {
        if (!this.isCheck(color, b)) return false;

        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 14; x++) {
                if (this.inBounds(x, y)) {
                    let p = b[y][x].piece;
                    if (p && p.color === color) {
                        let moves = this.getValidMoves(x, y);
                        if (moves.length > 0) return false;
                    }
                }
            }
        }
        return true;
    }

    getAttackerOfKing(color, b = this.board) {
        const kpos = this.findKing(color, b);
        if (!kpos) return null;
        for (let c of CHESS_COLORS) {
            if (!this.isAlly(c, color) && this.activePlayers[c]) {
                for (let y = 0; y < 14; y++) {
                    for (let x = 0; x < 14; x++) {
                        if (this.inBounds(x, y)) {
                            let p = b[y][x].piece;
                            if (p && p.color === c) {
                                let ops = this.getRawMoves(x, y, b);
                                if (ops.some(m => m.x === kpos.x && m.y === kpos.y)) {
                                    return c;
                                }
                            }
                        }
                    }
                }
            }
        }
        return null;
    }

    movePiece(fx, fy, tx, ty) {
        let piece = this.board[fy][fx].piece;
        let targetPiece = this.board[ty][tx].piece;
        
        if (targetPiece) {
            if (this.activePlayers[targetPiece.color]) {
                this.scores[piece.color] += PIECE_VALUES[targetPiece.type];
            }
        }

        // Execute Castling: Move the Rook as well
        const isKing = piece.type === PIECES.KING;
        const distMoved = Math.max(Math.abs(fx - tx), Math.abs(fy - ty));
        const isCastling = !!(isKing && distMoved > 1);

        if (isCastling) {
            let rx, ry, rtx, rty;
            // Identify Rook based on King's destination and color
            if (piece.color === 'white') {
                ry = 13; rty = 13;
                if (tx === 9) { rx = 10; rtx = 8; } else if (tx === 5) { rx = 3; rtx = 6; }
            } else if (piece.color === 'black') {
                ry = 0; rty = 0;
                if (tx === 9) { rx = 10; rtx = 8; } else if (tx === 5) { rx = 3; rtx = 6; }
            } else if (piece.color === 'blue') {
                rx = 0; rtx = 0;
                if (ty === 9) { ry = 10; rty = 8; } else if (ty === 5) { ry = 3; rty = 6; }
            } else if (piece.color === 'red') {
                rx = 13; rtx = 13;
                if (ty === 9) { ry = 10; rty = 8; } else if (ty === 5) { ry = 3; rty = 6; }
            }

            if (rx !== undefined && this.board[ry][rx].piece) {
                // Relocate the Rook
                this.board[rty][rtx].piece = this.board[ry][rx].piece;
                if (this.board[rty][rtx].piece) {
                    this.board[rty][rtx].piece.moved = true;
                }
                this.board[ry][rx].piece = null;
            }
        }

        piece.moved = true; // Mark as moved for Rok
        this.board[ty][tx].piece = piece;
        this.board[fy][fx].piece = null;

        if (targetPiece && targetPiece.type === PIECES.KING) {
            this.activePlayers[targetPiece.color] = false;
            this.scores[piece.color] += 20; 
            this.checkWinCondition();
        }
        
        let promoted = false;
        if (piece.type === PIECES.PAWN) {
            let reachedEnd = false;
            // 4-Player Promotion Rule: Enter opponent's 3x8 base arm
            if (piece.color === 'white' && ty <= 2 && tx >= 3 && tx <= 10) reachedEnd = true;
            if (piece.color === 'black' && ty >= 11 && tx >= 3 && tx <= 10) reachedEnd = true;
            if (piece.color === 'blue' && tx >= 11 && ty >= 3 && ty <= 10) reachedEnd = true;
            if (piece.color === 'red' && tx <= 2 && ty >= 3 && ty <= 10) reachedEnd = true;

            if (reachedEnd) {
                piece.type = PIECES.QUEEN;
                promoted = true;
            }
        }

        // INSTANT ELIMINATION: Check if this move checkmated any opponent
        for (let c of CHESS_COLORS) {
            if (c !== piece.color && this.activePlayers[c]) {
                if (this.isCheckmate(c, this.board)) {
                    this.activePlayers[c] = false;
                    this.scores[piece.color] += 20; // Bonus for the player who delivered the mate
                    if (!this.eliminationOrder.includes(c)) this.eliminationOrder.push(c);
                    this.checkWinCondition();
                }
            }
        }

        // Auto-eliminate kingless players OR players with ONLY a King
        const summary = this.getPieceSummary(this.board);
        for (let c of CHESS_COLORS) {
            if (this.activePlayers[c]) {
                if (!summary.kings[c] || this.hasOnlyKing(c)) {
                    this.activePlayers[c] = false;
                    if (!this.eliminationOrder.includes(c)) this.eliminationOrder.push(c);
                    this.checkWinCondition();
                }
            }
        }

        // Detect if move resulted in a check to ANY active opponent
        let hasCheck = false;
        for (let c of CHESS_COLORS) {
            if (!this.isAlly(c, piece.color) && this.activePlayers[c]) {
                if (this.isCheck(c, this.board)) {
                    hasCheck = true;
                    break;
                }
            }
        }

        this.lastMove = { fx, fy, tx, ty };
        this.nextTurn();
        return { success: true, promoted, capture: !!targetPiece, check: hasCheck };
    }

    evaluateBoard(b, color) {
        let score = 0;
        const myActive = this.activePlayers[color];
        if (!myActive) return -9999;

        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 14; x++) {
                if (this.inBounds(x, y)) {
                    let p = b[y][x].piece;
                    if (p) {
                        let val = PIECE_VALUES[p.type];
                        if (p.color === color) {
                            score += val * 10;
                            
                            // Center control
                            if (x >= 4 && x <= 9 && y >= 4 && y <= 9) score += 2;
                            
                            // Pawn advancement
                            if (p.type === PIECES.PAWN) {
                                if (color === 'white') score += (12 - y) * 0.1;
                                if (color === 'black') score += (y - 1) * 0.1;
                                if (color === 'blue') score += (x - 1) * 0.1;
                                if (color === 'red') score += (12 - x) * 0.1;
                            }
                        } else if (!this.isAlly(p.color, color)) {
                            // Being in check is bad
                            if (p.type === PIECES.KING) {
                                // If I am checking them, bonus
                                let myPiecesAttackingKing = false;
                                // ... simplified check detection ...
                            }
                            // Only penalize if the opponent is still active
                            if (this.activePlayers[p.color]) {
                                score -= val * 10;
                            }
                        }
                    }
                }
            }
        }

        // SMARTER AI: Checking others is good, but restricted Kings are better!
        const summary = this.getPieceSummary(b);
        for (let c of CHESS_COLORS) {
            if (!this.isAlly(c, color) && this.activePlayers[c]) {
                const kpos = summary.kings[c];
                if (kpos) {
                    if (this.isCheck(c, b, summary)) {
                        score += 10; // Base check bonus (reduced from 15 to prevent infinite loops)
                        if (this.isCheckmate(c, b)) score += 500; // Extreme weight for mate
                    }
                    
                    // KING RESTRICTION BONUS: Highly reward reducing the King's escape squares
                    try {
                        let availableSquares = this.getValidMoves(kpos.x, kpos.y).length;
                        score += (8 - availableSquares) * 5; // Up to +40 for trapping the King
                    } catch(e) {}
                }
            }
        }

        return score;
    }

    getBestMove(color) {
        let bestMove = null;
        let bestScore = -Infinity;
        
        const summary = this.getPieceSummary(this.board);
        let validMovesList = [];
        for (let pObj of summary.activePieces) {
            if (pObj.piece.color === color) {
                let moves = this.getValidMoves(pObj.x, pObj.y);
                for (let mv of moves) {
                    validMovesList.push({ fx: pObj.x, fy: pObj.y, tx: mv.x, ty: mv.y });
                }
            }
        }

        if (validMovesList.length === 0) return null;

        // Current board threats
        const currentThreats = this.getThreatMap(color, this.board, summary);

        for (let move of validMovesList) {
            let nextB = this.cloneBoard(this.board);
            let targetPiece = nextB[move.ty][move.tx].piece;
            let movingPiece = nextB[move.fy][move.fx].piece;
            
            nextB[move.ty][move.tx].piece = movingPiece;
            nextB[move.fy][move.fx].piece = null;
            
            // Optimization: Get summary of the HYPOTHETICAL board
            const nextSummary = this.getPieceSummary(nextB);
            let score = this.evaluateBoard(nextB, color);

            // Capture bonus
            if (targetPiece && this.activePlayers[targetPiece.color]) {
                score += (PIECE_VALUES[targetPiece.type] * 12) + 5;
            }
            
            // Threat detection at destination
            let destThreatMap = this.getThreatMap(color, nextB, nextSummary);
            if (destThreatMap[move.ty][move.tx]) {
                score -= (PIECE_VALUES[movingPiece.type] * 15);
            }

            // Rescue bonus
            if (currentThreats[move.fy][move.fx] && !destThreatMap[move.ty][move.tx]) {
                score += (PIECE_VALUES[movingPiece.type] * 8);
            }
            
            score += Math.random() * 0.5;

            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }
        
        if (!bestMove && validMovesList.length > 0) {
            bestMove = validMovesList[Math.floor(Math.random() * validMovesList.length)];
        }
        
        return bestMove;
    }

    getThreatMap(color, b, optionalSummary = null) {
        let threats = Array.from({length: 14}, () => Array(14).fill(false));
        const summary = optionalSummary || this.getPieceSummary(b);
        
        for (let pObj of summary.activePieces) {
            const p = pObj.piece;
            if (!this.isAlly(p.color, color) && this.activePlayers[p.color]) {
                let ops = this.getRawMoves(pObj.x, pObj.y, b);
                for (let m of ops) {
                    threats[m.y][m.x] = true;
                }
            }
        }
        return threats;
    }
}


// Export for both Node.js and ES6 (Expo)
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { GameEngine, CHESS_COLORS, PIECES, PIECE_VALUES };
}
export { GameEngine, CHESS_COLORS, PIECES, PIECE_VALUES };
