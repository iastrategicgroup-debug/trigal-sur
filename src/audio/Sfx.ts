/** Sonidos generados con WebAudio (sin archivos): escopeta, gruñido de criatura, bocado. */
export class Sfx {
  private ctx: AudioContext | null = null;
  volume = 0.7;

  /** Debe llamarse tras un gesto del usuario (clic en Jugar). */
  unlock(): void {
    try { this.ctx ??= new AudioContext(); void this.ctx.resume(); } catch { this.ctx = null; }
  }

  private noise(dur: number): AudioBufferSourceNode | null {
    if (!this.ctx) return null;
    const b = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const s = this.ctx.createBufferSource(); s.buffer = b; return s;
  }

  shotgun(): void {
    const c = this.ctx; const n = this.noise(0.9); if (!c || !n) return;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
    const g = c.createGain(); g.gain.value = 0.9 * this.volume;
    n.connect(f).connect(g).connect(c.destination); n.start();
    const o = c.createOscillator(); o.frequency.setValueAtTime(90, c.currentTime); o.frequency.exponentialRampToValueAtTime(30, c.currentTime + 0.3);
    const og = c.createGain(); og.gain.setValueAtTime(0.8 * this.volume, c.currentTime); og.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.35);
    o.connect(og).connect(c.destination); o.start(); o.stop(c.currentTime + 0.4);
  }

  /** Disparo corto (pistola o AK); `vol` según la distancia. */
  shot(kind: 'pistola' | 'ak', vol = 1): void {
    const c = this.ctx; const n = this.noise(kind === 'ak' ? 0.18 : 0.25); if (!c || !n || vol < 0.02) return;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = kind === 'ak' ? 1400 : 2200; f.Q.value = 0.7;
    const g = c.createGain(); g.gain.value = (kind === 'ak' ? 0.6 : 0.5) * this.volume * vol;
    n.connect(f).connect(g).connect(c.destination); n.start();
  }

  /** Latido (miedo): dos golpes graves. */
  heartbeat(intensity: number): void {
    const c = this.ctx; if (!c) return;
    for (const dt of [0, 0.22]) {
      const o = c.createOscillator(); o.frequency.value = 52;
      const g = c.createGain(); const t = c.currentTime + dt;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5 * intensity * this.volume, t + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.25);
    }
  }

  groan(dist: number): void {
    const c = this.ctx; if (!c) return;
    const vol = Math.max(0, 1 - dist / 60) * 0.35 * this.volume;
    if (vol <= 0.01) return;
    const o = c.createOscillator(); o.type = 'sawtooth';
    const t = c.currentTime;
    o.frequency.setValueAtTime(70 + Math.random() * 30, t); o.frequency.linearRampToValueAtTime(45, t + 1.6);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 380; f.Q.value = 4;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.3); g.gain.linearRampToValueAtTime(0, t + 1.7);
    o.connect(f).connect(g).connect(c.destination); o.start(); o.stop(t + 1.8);
  }

  bite(): void {
    const c = this.ctx; const n = this.noise(0.12); if (!c || !n) return;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
    const g = c.createGain(); g.gain.value = 0.25 * this.volume;
    n.connect(f).connect(g).connect(c.destination); n.start();
  }
}
