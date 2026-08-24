export * from './money.js';
export * from './uuid.js';
export * from './state-machine.js';
export * from './permit-machine.js';
export * from './guards.js';
export * from './outbox.js';
export * from './unit-import.js';
export { GRAPHS } from './graphs/index.js';

import { OrderStateMachine } from './state-machine.js';
import { DEFAULT_GUARDS } from './guards.js';
import { GRAPHS } from './graphs/index.js';

/** Готовый исполнитель графов DEV-10 со стандартными guard-проверками */
export function createOrderStateMachine(): OrderStateMachine {
  return new OrderStateMachine(GRAPHS, DEFAULT_GUARDS);
}

import { PermitStateMachine } from './permit-machine.js';

/** Готовый исполнитель графа наряда-допуска DEV-10 §7 (контур «Дом», M7) */
export function createPermitStateMachine(): PermitStateMachine {
  return new PermitStateMachine();
}
