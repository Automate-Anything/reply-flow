declare module 'node-cron' {
  interface ScheduledTask {
    start(): void;
    stop(): void;
    destroy(): void;
  }

  function schedule(expression: string, func: () => void | Promise<void>, options?: { scheduled?: boolean; timezone?: string }): ScheduledTask;
  function validate(expression: string): boolean;

  export { schedule, validate, ScheduledTask };
}
