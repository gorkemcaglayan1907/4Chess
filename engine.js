const CHESS_COLORS = ['white', 'blue', 'black', 'red'];
const PIECES = {
    PAWN: 'pawn', ROOK: 'rook', KNIGHT: 'knight', BISHOP: 'bishop', QUEEN: 'queen', KING: 'king'
};
const PIECE_VALUES = {
    pawn: 1, knight: 2, bishop: 3, rook: 4, queen: 8, king: 20
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
        
        // White (y = 13, y = 12)
        for (let i = 0; i < 8; i++) {
            let x = i + 3;
            this.board[13][x].piece = { type: backRank[i], color: 'white' };
            this.board[12][x].piece = { type: PIECES.PAWN, color: 'white' };
        }
        // Black (y = 0, y = 1)
        for (let i = 0; i < 8; i++) {
            let x = i + 3;
            this.board[0][x].piece = { type: backRank[i], color: 'black' };
            this.board[1][x].piece = { type: PIECES.PAWN, color: 'black' };
        }
        // Blue (x = 0, x = 1)
        for (let i = 0; i < 8; i++) {
            let y = i + 3;
            this.board[y][0].piece = { type: backRank[i], color: 'blue' };
            this.board[y][1].piece = { type: PIECES.PAWN, color: 'blue' };
        }
        // Red (x = 13, x = 12)
        for (let i = 0; i < 8; i++) {
            let y = i + 3;
            this.board[y][13].piece = { type: backRank[i], color: 'red' };
            this.board[y][12].piece = { type: PIECES.PAWN, color: 'red' };
        }
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
            if (attempts > 4) {
                // Should not happen unless game is bugged or ended
                break;
            }
        } while (!this.activePlayers[this.getCurrentTurnColor()]);
        
        // Check if the current player is checkmated
        if (this.isCheckmate(this.getCurrentTurnColor(), this.board)) {
            let eliminatedColor = this.getCurrentTurnColor();
            this.activePlayers[eliminatedColor] = false;
            
            // Find who gets the 20 points for the King. We check who is actually attacking the king.
            let attacker = this.getAttackerOfKing(eliminatedColor);
            if (attacker) {
                this.scores[attacker] += PIECE_VALUES.king;
            }
            
            this.removePiecesOfColor(eliminatedColor);
            
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
                if (canCapture && target.color !== color) {
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
                        if (t && t.color !== color) {
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

    isCheck(color, b = this.board) {
        const kpos = this.findKing(color, b);
        if (!kpos) return false; // If no king exists (maybe eliminated), not in check

        // Check if any opponent piece can hit king
        for (let c of CHESS_COLORS) {
            if (c !== color && this.activePlayers[c]) {
                for (let y = 0; y < 14; y++) {
                    for (let x = 0; x < 14; x++) {
                        if (this.inBounds(x, y)) {
                            let p = b[y][x].piece;
                            if (p && p.color === c) {
                                let ops = this.getRawMoves(x, y, b);
                                if (ops.some(m => m.x === kpos.x && m.y === kpos.y)) {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }
        return false;
    }

    isCheckmate(color, b = this.board) {
        if (!this.isCheck(color, b)) return false;

        // Has any valid moves left?
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

    // Helper to find who is attacking the king to award points
    getAttackerOfKing(color, b = this.board) {
        const kpos = this.findKing(color, b);
        if (!kpos) return null;
        for (let c of CHESS_COLORS) {
            if (c !== color && this.activePlayers[c]) {
                for (let y = 0; y < 14; y++) {
                    for (let x = 0; x < 14; x++) {
                        if (this.inBounds(x, y)) {
                            let p = b[y][x].piece;
                            if (p && p.color === c) {
                                let ops = this.getRawMoves(x, y, b);
                                if (ops.some(m => m.x === kpos.x && m.y === kpos.y)) {
                                    return c; // Returning the first color found attacking the king
                                }
                            }
                        }
                    }
                }
            }
        }
        return null; // Should not happen if they are checkmated
    }

    movePiece(fx, fy, tx, ty) {
        let piece = this.board[fy][fx].piece;
        let targetPiece = this.board[ty][tx].piece;
        
        // Add score if capturing something
        if (targetPiece) {
            this.scores[piece.color] += PIECE_VALUES[targetPiece.type];
        }

        this.board[ty][tx].piece = piece;
        this.board[fy][fx].piece = null;
        
        let promoted = false;
        // Check promotion
        if (piece.type === PIECES.PAWN) {
            let reachedEnd = false;
            if (piece.color === 'white' && ty === 0) reachedEnd = true;
            if (piece.color === 'black' && ty === 13) reachedEnd = true;
            if (piece.color === 'blue' && tx === 13) reachedEnd = true;
            if (piece.color === 'red' && tx === 0) reachedEnd = true;

            if (reachedEnd) {
                piece.type = PIECES.QUEEN; // otomatik vezir
                promoted = true;
            }
        }

        // Complete the turn automatically if not Game Over logic
        this.nextTurn();
        return { success: true, promoted };
    }

    evaluateBoard(b, color) {
        let score = 0;
        for (let y = 0; y < 14; y++) {
            for (let x = 0; x < 14; x++) {
                if (this.inBounds(x, y)) {
                    let p = b[y][x].piece;
                    if (p) {
                        let val = PIECE_VALUES[p.type] * 10;
                        if (p.color === color) {
                            score += val;
                            // Merkezi pozisyon kontrolü bonusu
                            if (x >= 4 && x <= 9 && y >= 4 && y <= 9) score += 0.5;
                        } else {
                            score -= val;
                        }
                    }
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

        for (let move of validMovesList) {
            let nextB = this.cloneBoard(this.board);
            let targetPiece = nextB[move.ty][move.tx].piece;
            let movingPiece = nextB[move.fy][move.fx].piece;
            
            nextB[move.ty][move.tx].piece = movingPiece;
            nextB[move.fy][move.fx].piece = null;
            
            let score = this.evaluateBoard(nextB, color);

            // Yakalama bonusu
            if (targetPiece) {
                score += (PIECE_VALUES[targetPiece.type] * 10) + 5;
            }
            
            // Tehdit analizi (Basit 1-ply: o anki kare başka biri tarafından tehdit ediliyor mu?)
            let inDanger = false;
            for (let y2 = 0; y2 < 14; y2++) {
                for (let x2 = 0; x2 < 14; x2++) {
                    if (this.inBounds(x2, y2)) {
                        let op = nextB[y2][x2].piece;
                        if (op && op.color !== color && this.activePlayers[op.color]) {
                            let opMoves = this.getRawMoves(x2, y2, nextB);
                            if (opMoves.some(m => m.x === move.tx && m.y === move.ty)) {
                                inDanger = true;
                                break;
                            }
                        }
                    }
                }
                if (inDanger) break;
            }

            if (inDanger) {
                score -= (PIECE_VALUES[movingPiece.type] * 10) + 1;
            }
            
            // Çeşitlilik
            score += Math.random();

            if (score > bestScore) {
                bestScore = score;
                bestMove = move;
            }
        }
        
        return bestMove;
    }
}


// Make compatible with Node.js
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = { GameEngine, CHESS_COLORS, PIECES, PIECE_VALUES };
}
