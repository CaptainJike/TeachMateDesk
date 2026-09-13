import { ChineseExpertAgent } from "../agents/chinese-expert.agent.js";
import { FileBasedRetriever } from "../retriever/file-based-retriever.js";
import type { SchoolStage } from "../agents/router.agent.js";
import type { ModelTier } from "../providers/model-registry.js";

export interface PooledWorker {
  id: number;
  agent: ChineseExpertAgent;
  isBusy: boolean;
  tier: ModelTier;
}

export class ChineseExpertAgentPool {
  private workers: PooledWorker[] = [];
  private waitQueue: Array<(worker: PooledWorker) => void> = [];
  private retriever: FileBasedRetriever;

  constructor(
    private readonly capacity = 10,
    private readonly stage: SchoolStage = "MIDDLE",
    retriever?: FileBasedRetriever
  ) {
    this.retriever = retriever || new FileBasedRetriever();
    for (let i = 0; i < capacity; i++) {
      this.workers.push({
        id: i + 1,
        agent: new ChineseExpertAgent(this.retriever, stage, "TIER_2_STANDARD"),
        isBusy: false,
        tier: "TIER_2_STANDARD",
      });
    }
  }

  public async acquire(tier: ModelTier = "TIER_2_STANDARD"): Promise<PooledWorker> {
    const available = this.workers.find((w) => !w.isBusy);
    if (available) {
      available.isBusy = true;
      available.tier = tier;
      // Workers only provide concurrency control. Never reuse an Agent with
      // message history: a grading run must receive a fresh session and the
      // requested model tier.
      available.agent = new ChineseExpertAgent(this.retriever, this.stage, tier);
      return available;
    }

    return new Promise<PooledWorker>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  public release(worker: PooledWorker): void {
    worker.isBusy = false;
    const nextWaiter = this.waitQueue.shift();
    if (nextWaiter) {
      worker.isBusy = true;
      nextWaiter(worker);
    }
  }

  public async executeGrading<T>(
    tier: ModelTier,
    task: (agent: ChineseExpertAgent) => Promise<T>
  ): Promise<T> {
    const worker = await this.acquire(tier);
    try {
      return await task(worker.agent);
    } finally {
      this.release(worker);
    }
  }

  public getPoolStats() {
    return {
      capacity: this.capacity,
      activeWorkers: this.workers.filter((w) => w.isBusy).length,
      idleWorkers: this.workers.filter((w) => !w.isBusy).length,
      waitingTasks: this.waitQueue.length,
    };
  }
}
