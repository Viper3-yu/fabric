import type { Shipment, ShipmentEventType, ShipmentStatus, UserRole } from '@jixin/shared';
import { ROLE_LABELS, STATUS_LABELS } from '@jixin/shared';
import type { ShipmentAction } from '../types';

export { ROLE_LABELS, STATUS_LABELS };

export const EVENT_LABELS: Record<ShipmentEventType, string> = {
  CREATED: '运单已创建',
  ACCEPTED: '承运方已接单',
  PICKED_UP: '货物已揽收',
  CHECKPOINT: '运输节点更新',
  EXCEPTION_REPORTED: '运输异常上报',
  EXCEPTION_RESOLVED: '异常已处理',
  DELIVERED: '货物已送达',
  RECEIVED: '收货方已签收',
  CANCELLED: '运单已取消',
};

export const ACTION_LABELS: Record<ShipmentAction, string> = {
  accept: '接单',
  pickup: '确认揽收',
  checkpoint: '更新运输节点',
  exception: '上报异常',
  resolve: '解除异常',
  deliver: '标记送达',
  confirm: '确认签收',
  cancel: '取消运单',
};

const ACTION_MATRIX: Record<UserRole, Partial<Record<ShipmentStatus, ShipmentAction[]>>> = {
  shipper: {
    CREATED: ['cancel'],
  },
  carrier: {
    CREATED: ['accept'],
    ACCEPTED: ['pickup'],
    PICKED_UP: ['checkpoint', 'exception'],
    IN_TRANSIT: ['checkpoint', 'exception', 'deliver'],
    EXCEPTION: ['resolve'],
  },
  receiver: {
    DELIVERED: ['confirm'],
  },
  auditor: {},
};

export function getAvailableActions(role: UserRole, status: ShipmentStatus): ShipmentAction[] {
  return ACTION_MATRIX[role][status] ?? [];
}

export function getResponsibility(shipment: Shipment): string {
  switch (shipment.status) {
    case 'CREATED':
      return '承运方接单';
    case 'ACCEPTED':
      return '承运方揽收';
    case 'PICKED_UP':
    case 'IN_TRANSIT':
    case 'EXCEPTION':
      return '承运方运输处理';
    case 'DELIVERED':
      return '收货方签收';
    case 'RECEIVED':
      return '业务闭环完成';
    case 'CANCELLED':
      return '流程已终止';
  }
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function routeLabel(shipment: Shipment): string {
  return `${shipment.origin.city} 至 ${shipment.destination.city}`;
}

export function statusTone(
  status: ShipmentStatus,
): 'cool-gray' | 'blue' | 'cyan' | 'teal' | 'red' | 'purple' | 'green' | 'gray' {
  switch (status) {
    case 'CREATED':
      return 'cool-gray';
    case 'ACCEPTED':
      return 'blue';
    case 'PICKED_UP':
      return 'cyan';
    case 'IN_TRANSIT':
      return 'teal';
    case 'EXCEPTION':
      return 'red';
    case 'DELIVERED':
      return 'purple';
    case 'RECEIVED':
      return 'green';
    case 'CANCELLED':
      return 'gray';
  }
}
