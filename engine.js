const CHESS_COLORS = ['white', 'blue', 'black', 'red'];
const PIECES = {
    PAWN: 'pawn', ROOK: 'rook', KNIGHT: 'knight', BISHOP: 'bishop', QUEEN: 'queen', KING: 'king'
};
const PIECE_VALUES = {
    pawn: 1, knight: 3, bishop: 3.5, rook: 5, queen: 9, king: 100
};

class GameEngine {
    constructor() {
        this.board = this.createEmptyBoard();
        this.turnIndex = 0; // 0=white, 1=blue, 2=black, 3=red
        this.activePlayers = { white: true, blue: true, black: true, red: true };
        this.scores = { white: 0, blue: 0, black: 0, red: 0 };
        this.setupPieces();
        this.gameOver = false;
        this.winner = null;
        this.lastMove = null;
        this.teamMode = false;

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
        
        // Check if the current player is checkmated
        if (this.isCheckmate(this.getCurrentTurnColor(), this.board)) {
            let eliminatedColor = this.getCurrentTurnColor();
            this.activePlayers[eliminatedColor] = false;
            
            // Find who gets the 20 points for the King. We check who is actually attacking the king.
            let attacker = this.getAttackerOfKing(eliminatedColor);
            if (attacker) {
                this.scores[attacker] += 20; // 20 points for eliminating a king
            }
            
            // Re-evaluate win condition
            this.checkWinCondition();
            
            // Recurse to pass turn to next active
            if (!this.gameOver) {
                this.nextTurn();
            }
        }
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
            } else if (activeCount === 0) {
                this.gameOver = true; // Draw / everyone lost
            }
        }
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

    findKing(color, b) {
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 14; x++) {
                if (this.inBounds(x, y)) {
                    let p = b[y][x].piece;
                    if (p && p.type === PIECES.KING && p.color === color) {
                        return {x, y};
                    }
                }
            }
        }
        return null;
    }

    getAllPieces(b = this.board) {
        let pieces = [];
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 14; x++) {
                if (this.inBounds(x, y) && b[y][x].piece) {
                    pieces.push({ x, y, piece: b[y][x].piece });
                }
            }
        }
        return pieces;
    }

    isCheck(color, b = this.board) {
        const kpos = this.findKing(color, b);
        if (!kpos) return false; 

        // Optimization: Get only relevant pieces once
        const allPieces = this.getAllPieces(b);

        for (let pObj of allPieces) {
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
            if (piece.color === 'white' && ty === 0) reachedEnd = true;
            if (piece.color === 'black' && ty === 13) reachedEnd = true;
            if (piece.color === 'blue' && tx === 13) reachedEnd = true;
            if (piece.color === 'red' && tx === 0) reachedEnd = true;

            if (reachedEnd) {
                piece.type = PIECES.QUEEN;
                promoted = true;
            }
        }

        // Auto-eliminate kingless
        for (let c of CHESS_COLORS) {
            if (this.activePlayers[c] && !this.findKing(c, this.board)) {
                this.activePlayers[c] = false;
                this.checkWinCondition();
            }
        }

        // Detect if move resulted in a check to ANY opponent
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

        // Critical: Checking others is good
        for (let c of CHESS_COLORS) {
            if (!this.isAlly(c, color) && this.activePlayers[c]) {
                if (this.isCheck(c, b)) {
                    score += 15; // Bonus for checking an opponent
                    if (this.isCheckmate(c, b)) score += 100; // Major bonus for mate
                }
            }
        }

        return score;
    }

    getBestMove(color) {
        let bestMove = null;
        let bestScore = -Infinity;
        
        let validMovesList = [];
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 14; x++) {
                if (this.inBounds(x, y)) {
                    let p = this.board[y][x].piece;
                    if (p && p.color === color) {
                        let moves = this.getValidMoves(x, y);
                        for (let mv of moves) {
                            validMovesList.push({ fx: x, fy: y, tx: mv.x, ty: mv.y });
                        }
                    }
                }
            }
        }

        if (validMovesList.length === 0) return null;

        // Current board threats
        const currentThreats = this.getThreatMap(color, this.board);

        for (let move of validMovesList) {
            let nextB = this.cloneBoard(this.board);
            let targetPiece = nextB[move.ty][move.tx].piece;
            let movingPiece = nextB[move.fy][move.fx].piece;
            
            nextB[move.ty][move.tx].piece = movingPiece;
            nextB[move.fy][move.fx].piece = null;
            
            let score = this.evaluateBoard(nextB, color);

            // Capture bonus (Greedy)
            if (targetPiece) {
                // Only give bonus if target player is still in the game
                if (this.activePlayers[targetPiece.color]) {
                    score += (PIECE_VALUES[targetPiece.type] * 12) + 5;
                } else {
                    // Very small bonus to clear dead pieces if literally nothing else to do
                    score += 0.1;
                }
            }
            
            // Threat detection at destination
            let destThreatMap = this.getThreatMap(color, nextB);
            if (destThreatMap[move.ty][move.tx]) {
                // Moving into danger penalty
                score -= (PIECE_VALUES[movingPiece.type] * 15);
            }

            // Rescue bonus: If piece was under threat and now it's not (and destination is safe)
            if (currentThreats[move.fy][move.fx] && !destThreatMap[move.ty][move.tx]) {
                score += (PIECE_VALUES[movingPiece.type] * 8);
            }
            
            // Small randomness to avoid identical games
            score += Math.random() * 0.5;

            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }
        
        // Safety Fallback: If evaluation failed to pick a move but moves exist, pick one at random.
        if (!bestMove && validMovesList.length > 0) {
            bestMove = validMovesList[Math.floor(Math.random() * validMovesList.length)];
        }
        
        return bestMove;
    }

    getThreatMap(color, b) {
        let threats = Array.from({length: 14}, () => Array(14).fill(false));
        for (let c of CHESS_COLORS) {
            if (!this.isAlly(c, color) && this.activePlayers[c]) {
                for (let y = 0; y < 14; y++) {
                    for (let x = 0; x < 14; x++) {
                        if (this.inBounds(x, y)) {
                            let p = b[y][x].piece;
                            if (p && p.color === c) {
                                let ops = this.getRawMoves(x, y, b);
                                for (let m of ops) {
                                    threats[m.y][m.x] = true;
                                }
                            }
                        }
                    }
                }
            }
        }
        return threats;
    }
}


if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { GameEngine, CHESS_COLORS, PIECES, PIECE_VALUES };
}
