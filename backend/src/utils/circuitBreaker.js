import { logger } from './logger.js';

export class CircuitBreaker {
  /**
   * @param {string} name - Name of the circuit breaker for logging/identification
   * @param {object} options
   * @param {number} [options.failureThreshold=5] - Number of failures before tripping
   * @param {number} [options.cooldownPeriod=10000] - Duration (ms) in OPEN state before trying HALF_OPEN
   * @param {number} [options.timeoutMs=5000] - Max duration (ms) for request execution
   * @param {number} [options.concurrencyLimit=10] - Max concurrent execution limit
   */
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.cooldownPeriod = options.cooldownPeriod || 10000;
    this.timeoutMs = options.timeoutMs || 5000;
    this.concurrencyLimit = options.concurrencyLimit || 10;
    
    this.state = 'CLOSED'; // 'CLOSED', 'OPEN', 'HALF_OPEN'
    this.failureCount = 0;
    this.activeRequests = 0;
    this.lastFailureTime = null;
  }

  /**
   * Executes an async action wrapped by this circuit breaker.
   * 
   * @param {function(): Promise<T>} action 
   * @param {function(): T} [fallback] 
   * @returns {Promise<T>}
   */
  async execute(action, fallback) {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime > this.cooldownPeriod) {
        logger.info(`[CircuitBreaker:${this.name}] Cooldown period expired. Transitioning to HALF_OPEN.`);
        this.state = 'HALF_OPEN';
      } else {
        logger.warn(`[CircuitBreaker:${this.name}] Circuit is OPEN. Fast-failing request.`);
        if (typeof fallback === 'function') return fallback();
        throw new Error(`CircuitBreaker ${this.name} is OPEN`);
      }
    }

    if (this.activeRequests >= this.concurrencyLimit) {
      logger.warn(`[CircuitBreaker:${this.name}] Concurrency limit (${this.concurrencyLimit}) exceeded. Fast-failing request.`);
      if (typeof fallback === 'function') return fallback();
      throw new Error(`CircuitBreaker ${this.name} concurrency limit reached`);
    }

    this.activeRequests++;

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Timeout of ${this.timeoutMs}ms exceeded`));
      }, this.timeoutMs);
    });

    try {
      const result = await Promise.race([
        action().then(res => {
          clearTimeout(timeoutId);
          return res;
        }),
        timeoutPromise
      ]);
      
      this.activeRequests--;
      if (this.state === 'HALF_OPEN') {
        logger.info(`[CircuitBreaker:${this.name}] Request succeeded in HALF_OPEN. Resetting to CLOSED.`);
        this.state = 'CLOSED';
        this.failureCount = 0;
      }
      return result;
    } catch (err) {
      this.activeRequests--;
      this.failureCount++;
      this.lastFailureTime = Date.now();

      logger.error(`[CircuitBreaker:${this.name}] Request failed (${this.failureCount}/${this.failureThreshold}): ${err.message}`);

      if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
        logger.error(`[CircuitBreaker:${this.name}] Tripping circuit to OPEN state.`);
        this.state = 'OPEN';
      }

      if (typeof fallback === 'function') return fallback();
      throw err;
    }
  }
}
