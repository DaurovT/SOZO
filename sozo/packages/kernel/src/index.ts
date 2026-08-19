export * from './money.js';
export * from './uuid.js';
export * from './state-machine.js';
export * from './guards.js';
export * from './outbox.js';
export { GRAPHS } from './graphs/index.js';

import { OrderStateMachine } from './state-machine.js';
import { DEFAULT_GUARDS } from './guards.js';
import { GRAPHS } from './graphs/index.js';

/** Готовый исполнитель графов DEV-10 со стандартными guard-проверками */
export function createOrderStateMachine(): OrderStateMachine {
  return new OrderStateMachine(GRAPHS, DEFAULT_GUARDS);
}
