class SoundEngine {
    constructor() {
        this.ctx = null;
        this.unlocked = false;
        // Do not create AudioContext immediately to prevent console warnings, do it on unlock
    }

    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.ctx = new AudioContext();
            }
        }
    }

    unlock() {
        if (this.unlocked) return;
        this.init();
        if (!this.ctx) return;

        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        // Create and play a silent buffer (more reliable on some mobile browsers)
        const buffer = this.ctx.createBuffer(1, 1, 22050);
        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);
        source.start(0);
        
        this.unlocked = true;
        console.log("4CHESS: Audio Engine Unlocked");
    }

    playMove() {
        if (!this.unlocked || !this.ctx) return;
        this._playTone(400, 'sine', 0.05, 0.5, 0.01);
    }

    playCapture() {
        if (!this.unlocked || !this.ctx) return;
        this._playTone(800, 'triangle', 0.1, 0.4, 0.05);
        setTimeout(() => this._playTone(600, 'square', 0.15, 0.2, 0.02), 50);
    }

    playCheck() {
        if (!this.unlocked || !this.ctx) return;
        this._playTone(300, 'sawtooth', 0.4, 0.6, 0.1);
        setTimeout(() => this._playTone(300, 'sawtooth', 0.4, 0.6, 0.1), 150);
    }
    
    playGameOver() {
        if (!this.unlocked || !this.ctx) return;
        this._playTone(300, 'square', 0.8, 0.5, 0.2);
        setTimeout(() => this._playTone(250, 'square', 0.8, 0.5, 0.2), 300);
        setTimeout(() => this._playTone(200, 'square', 1.5, 0.5, 0.4), 600);
    }

    _playTone(freq, type, duration, vol, fadeOutTime) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + duration + fadeOutTime);
    }
}

// Global instance
window.audio = new SoundEngine();
