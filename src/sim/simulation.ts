import { CITY_NAME, SPEEDS, START_FUNDS, START_YEAR, TAX_PER_JOB, TAX_PER_RESIDENT, TICKS_PER_MONTH } from '../config';
import { computeDemand } from './demand';
import { GrowthBudget, computeStats, emptyBudget, refillBudget, tickConstruction, tickGrowth } from './growth';
import { Rng, randomSeed } from './rng';
import { Plan, applyPlan } from './tools';
import { CityStats, Demand } from './types';
import { World } from './world';

export type MessageKind = 'info' | 'good' | 'warn';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const POPULATION_MILESTONES = [100, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000];
/** Never run more than this many ticks per frame, so a slow frame cannot snowball. */
const MAX_TICKS_PER_UPDATE = 12;
/** Finished buildings nobody consumed (e.g. no renderer attached) are dropped beyond this. */
const MAX_COMPLETED_QUEUE = 200;

export interface ToolResult {
  ok: boolean;
  reason?: string;
}

export class Simulation {
  readonly world: World;
  cityName = CITY_NAME;
  funds = START_FUNDS;
  tick = 0;
  speed = 1;
  stats: CityStats;
  demand: Demand;
  lastMonthIncome = 0;
  /** Index into POPULATION_MILESTONES of the next milestone to announce. */
  nextMilestone = 0;
  /** Tiles whose building just finished construction (newcomers move in); drained by the traffic layer. */
  readonly completed: number[] = [];

  onMessage: (text: string, kind: MessageKind) => void = () => {};

  private rng = new Rng(randomSeed());
  private accumulator = 0;
  private budget: GrowthBudget = emptyBudget();

  constructor(world: World) {
    this.world = world;
    world.updateRoadAccess();
    this.stats = computeStats(world);
    this.demand = computeDemand(this.stats);
  }

  /** Advances the simulation by real elapsed time according to the current speed. */
  update(dtSeconds: number): void {
    const rate = SPEEDS[this.speed] ?? 0;
    if (rate === 0) return;
    this.accumulator += dtSeconds * rate;
    let ticks = 0;
    while (this.accumulator >= 1 && ticks < MAX_TICKS_PER_UPDATE) {
      this.step();
      this.accumulator -= 1;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_UPDATE) this.accumulator = 0;
  }

  step(): void {
    const { world } = this;
    world.updateRoadAccess();
    tickConstruction(world, this.completed);
    if (this.completed.length > MAX_COMPLETED_QUEUE) this.completed.splice(0, this.completed.length - MAX_COMPLETED_QUEUE);
    this.stats = computeStats(world);
    refillBudget(this.budget, this.stats);
    this.demand = tickGrowth(world, this.stats, this.budget, this.tick, this.rng);
    this.tick++;
    if (this.tick % TICKS_PER_MONTH === 0) this.onNewMonth();
  }

  private onNewMonth(): void {
    const s = this.stats;
    const income = Math.round(s.population * TAX_PER_RESIDENT + (s.comJobs + s.indJobs) * TAX_PER_JOB);
    this.funds += income;
    this.lastMonthIncome = income;

    while (
      this.nextMilestone < POPULATION_MILESTONES.length &&
      s.population >= POPULATION_MILESTONES[this.nextMilestone]
    ) {
      const n = POPULATION_MILESTONES[this.nextMilestone];
      this.onMessage(`${this.cityName} reached a population of ${n.toLocaleString('en-US')}!`, 'good');
      this.nextMilestone++;
    }
  }

  get monthIndex(): number {
    return Math.floor(this.tick / TICKS_PER_MONTH);
  }

  get dateLabel(): string {
    const m = this.monthIndex;
    return `${MONTHS[m % 12]} ${START_YEAR + Math.floor(m / 12)}`;
  }

  applyTool(plan: Plan): ToolResult {
    if (plan.count === 0) return { ok: false };
    if (plan.cost > this.funds) return { ok: false, reason: 'Not enough funds' };
    this.funds -= plan.cost;
    applyPlan(this.world, plan);
    this.world.updateRoadAccess();
    this.stats = computeStats(this.world);
    this.demand = computeDemand(this.stats);
    return { ok: true };
  }
}
