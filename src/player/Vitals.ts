import { CONFIG } from '../config';

export type DamageSource = 'golpe' | 'caida' | 'atropello' | 'choque' | 'fuego';

/** Salud y escudo. El escudo absorbe primero; la salud se regenera lentamente hasta un tope. */
export class Vitals {
  health: number = CONFIG.vitals.healthMax;
  shield = 0;
  dead = false;
  lastCause: DamageSource | null = null;
  private sinceHit = 999;

  damage(amount: number, source: DamageSource): void {
    if (this.dead || amount <= 0) return;
    this.sinceHit = 0;
    this.lastCause = source;
    const absorbed = Math.min(this.shield, amount);
    this.shield -= absorbed;
    this.health = Math.max(0, this.health - (amount - absorbed));
    if (this.health <= 0) this.dead = true;
  }

  /** Daño por caída: solo por encima de la altura segura. */
  fall(height: number): void {
    const v = CONFIG.vitals;
    if (height > v.fallSafeHeight) this.damage((height - v.fallSafeHeight) * v.fallDamagePerMeter, 'caida');
  }

  addShield(n: number): void { this.shield = Math.min(CONFIG.vitals.shieldMax, this.shield + n); }

  step(dt: number): void {
    if (this.dead) return;
    this.sinceHit += dt;
    const v = CONFIG.vitals;
    if (this.sinceHit > v.regenDelay && this.health < v.regenCap) this.health = Math.min(v.regenCap, this.health + v.healthRegen * dt);
  }

  respawn(): void {
    this.health = CONFIG.vitals.healthMax;
    this.shield = 0;
    this.dead = false;
    this.sinceHit = 999;
  }
}
