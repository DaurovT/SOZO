/** Типы ответов API кабинета. Источник истины — packages/contracts и DEV-03. */

export interface AuthUser {
  phone: string;
  fullName?: string;
  roles: string[];
}

export type ConnectionStatus = 'unmanaged' | 'claimed' | 'verified' | 'active' | 'degraded';
export type Health = 'red' | 'amber' | 'green';

export interface DashboardObject {
  buildingId: string;
  name: string;
  connectionStatus: ConnectionStatus;
  readinessGaps: string[];
  permitsPending: number;
  permitsOverdue: number;
  criticalPending: number;
  shutdownsActive: number;
  shutdownsPlanned: number;
  shutdownsLateNotice: number;
  observationsOpen: number;
  observationsEmergency: number;
  health: Health;
}

export interface Dashboard {
  operatorOrgId: string;
  plan: 'free' | 'pro' | 'enterprise';
  objectsTotal: number;
  scope: 'building' | 'portfolio';
  totals: {
    permitsPending: number;
    permitsOverdue: number;
    criticalPending: number;
    objectsDegraded: number;
    objectsNotActive: number;
  };
  objects: DashboardObject[];
}

export type PermitStatus =
  | 'draft' | 'requested' | 'approved' | 'rescheduled' | 'rejected'
  | 'scheduled' | 'opened' | 'closed' | 'expired' | 'cancelled';

export interface Permit {
  id: string;
  orderId: string;
  buildingId: string;
  status: PermitStatus;
  zoneTypes: string[];
  hasCriticalZone: boolean;
  hasLicensedZone: boolean;
  requiresShutdown: boolean;
  affectedUnitIds: string[];
  windowFrom: string | null;
  windowTo: string | null;
  slaDeadline: string | null;
  approvalKind: 'manual' | 'auto_silence' | 'emergency_override' | null;
  approverName: string | null;
  isEmergency: boolean;
  masterIsPlatform: boolean;
}

export interface Settlement {
  subscriptionTiyin: number;
  claimsTiyin: number;
  serviceFeeTiyin: number;
  netTiyin: number;
  direction: 'invoice_to_operator' | 'payout_to_operator';
  rows: Array<{ id: string; kind: string; amountTiyin: number; note: string; at: string }>;
}

export interface Observation {
  id: string;
  zoneKey: string;
  categoryId: string;
  severity: 'emergency' | 'work_required' | 'housekeeping' | 'info';
  source: 'walkthrough' | 'resident' | 'master' | 'complaint';
  status: 'open' | 'routed' | 'resolved' | 'rejected';
  photoIds: string[];
  comment: string | null;
  /** маршрут, предложенный категорией A-44 — не решение, а подсказка */
  suggestedRoute: 'task' | 'defect' | 'order' | 'contractor' | 'journal';
  routedTo: 'task' | 'defect' | 'order' | 'contractor' | 'journal' | null;
  /** заявка, созданная по замечанию (аварийное — автоматически) */
  routedEntityId: string | null;
  createdAt: string;
}

/** Справочник A-44 — читается с сервера, чтобы подписи не разъехались */
export interface ObservationCategory {
  id: string;
  label: string;
  defaultSeverity: Observation['severity'];
  defaultRoute: Observation['suggestedRoute'];
  icon: string;
}
