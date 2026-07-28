import type { Shipment, ShipmentEventType } from '@jixin/shared';

export type MapCoordinate = [latitude: number, longitude: number];
export type RoutePointKind = 'origin' | 'checkpoint' | 'current' | 'destination';
export type CoordinateAccuracy = 'city' | 'province';

interface CoordinateEntry {
  names: string[];
  coordinate: MapCoordinate;
}

export interface ShipmentRoutePoint {
  id: string;
  kind: RoutePointKind;
  coordinate: MapCoordinate;
  title: string;
  detail: string;
  timestamp?: string;
  accuracy: CoordinateAccuracy;
}

const CITY_COORDINATES: CoordinateEntry[] = [
  { names: ['北京市', '北京'], coordinate: [39.9042, 116.4074] },
  { names: ['上海市', '上海'], coordinate: [31.2304, 121.4737] },
  { names: ['天津市', '天津'], coordinate: [39.0842, 117.2009] },
  { names: ['重庆市', '重庆'], coordinate: [29.563, 106.5516] },
  { names: ['广州市', '广州'], coordinate: [23.1291, 113.2644] },
  { names: ['深圳市', '深圳'], coordinate: [22.5431, 114.0579] },
  { names: ['东莞市', '东莞'], coordinate: [23.0207, 113.7518] },
  { names: ['佛山市', '佛山'], coordinate: [23.0215, 113.1214] },
  { names: ['南京市', '南京'], coordinate: [32.0603, 118.7969] },
  { names: ['苏州市', '苏州'], coordinate: [31.2989, 120.5853] },
  { names: ['昆山市', '昆山'], coordinate: [31.3856, 120.9807] },
  { names: ['无锡市', '无锡'], coordinate: [31.4912, 120.3119] },
  { names: ['常州市', '常州'], coordinate: [31.8107, 119.9741] },
  { names: ['南通市', '南通'], coordinate: [31.9802, 120.8943] },
  { names: ['杭州市', '杭州'], coordinate: [30.2741, 120.1551] },
  { names: ['宁波市', '宁波'], coordinate: [29.8683, 121.544] },
  { names: ['温州市', '温州'], coordinate: [27.9943, 120.6994] },
  { names: ['合肥市', '合肥'], coordinate: [31.8206, 117.2272] },
  { names: ['武汉市', '武汉'], coordinate: [30.5928, 114.3055] },
  { names: ['长沙市', '长沙'], coordinate: [28.2282, 112.9388] },
  { names: ['南昌市', '南昌'], coordinate: [28.682, 115.8579] },
  { names: ['济南市', '济南'], coordinate: [36.6512, 117.1201] },
  { names: ['青岛市', '青岛'], coordinate: [36.0671, 120.3826] },
  { names: ['郑州市', '郑州'], coordinate: [34.7466, 113.6254] },
  { names: ['石家庄市', '石家庄'], coordinate: [38.0428, 114.5149] },
  { names: ['太原市', '太原'], coordinate: [37.8706, 112.5489] },
  { names: ['西安市', '西安'], coordinate: [34.3416, 108.9398] },
  { names: ['成都市', '成都'], coordinate: [30.5728, 104.0668] },
  { names: ['贵阳市', '贵阳'], coordinate: [26.647, 106.6302] },
  { names: ['昆明市', '昆明'], coordinate: [25.0389, 102.7183] },
  { names: ['福州市', '福州'], coordinate: [26.0745, 119.2965] },
  { names: ['厦门市', '厦门'], coordinate: [24.4798, 118.0894] },
  { names: ['沈阳市', '沈阳'], coordinate: [41.8057, 123.4315] },
  { names: ['大连市', '大连'], coordinate: [38.914, 121.6147] },
  { names: ['长春市', '长春'], coordinate: [43.8171, 125.3235] },
  { names: ['哈尔滨市', '哈尔滨'], coordinate: [45.8038, 126.5349] },
  { names: ['兰州市', '兰州'], coordinate: [36.0611, 103.8343] },
  { names: ['西宁市', '西宁'], coordinate: [36.6171, 101.7782] },
  { names: ['银川市', '银川'], coordinate: [38.4872, 106.2309] },
  { names: ['乌鲁木齐市', '乌鲁木齐'], coordinate: [43.8256, 87.6168] },
  { names: ['呼和浩特市', '呼和浩特'], coordinate: [40.8426, 111.7492] },
  { names: ['南宁市', '南宁'], coordinate: [22.817, 108.3665] },
  { names: ['海口市', '海口'], coordinate: [20.044, 110.1999] },
];

const PROVINCE_COORDINATES: CoordinateEntry[] = [
  { names: ['河北省', '河北'], coordinate: [38.0428, 114.5149] },
  { names: ['山西省', '山西'], coordinate: [37.8706, 112.5489] },
  { names: ['辽宁省', '辽宁'], coordinate: [41.8057, 123.4315] },
  { names: ['吉林省', '吉林'], coordinate: [43.8171, 125.3235] },
  { names: ['黑龙江省', '黑龙江'], coordinate: [45.8038, 126.5349] },
  { names: ['江苏省', '江苏'], coordinate: [32.0603, 118.7969] },
  { names: ['浙江省', '浙江'], coordinate: [30.2741, 120.1551] },
  { names: ['安徽省', '安徽'], coordinate: [31.8206, 117.2272] },
  { names: ['福建省', '福建'], coordinate: [26.0745, 119.2965] },
  { names: ['江西省', '江西'], coordinate: [28.682, 115.8579] },
  { names: ['山东省', '山东'], coordinate: [36.6512, 117.1201] },
  { names: ['河南省', '河南'], coordinate: [34.7466, 113.6254] },
  { names: ['湖北省', '湖北'], coordinate: [30.5928, 114.3055] },
  { names: ['湖南省', '湖南'], coordinate: [28.2282, 112.9388] },
  { names: ['广东省', '广东'], coordinate: [23.1291, 113.2644] },
  { names: ['海南省', '海南'], coordinate: [20.044, 110.1999] },
  { names: ['四川省', '四川'], coordinate: [30.5728, 104.0668] },
  { names: ['贵州省', '贵州'], coordinate: [26.647, 106.6302] },
  { names: ['云南省', '云南'], coordinate: [25.0389, 102.7183] },
  { names: ['陕西省', '陕西'], coordinate: [34.3416, 108.9398] },
  { names: ['甘肃省', '甘肃'], coordinate: [36.0611, 103.8343] },
  { names: ['青海省', '青海'], coordinate: [36.6171, 101.7782] },
  { names: ['台湾省', '台湾'], coordinate: [25.033, 121.5654] },
  { names: ['内蒙古自治区', '内蒙古'], coordinate: [40.8426, 111.7492] },
  { names: ['广西壮族自治区', '广西'], coordinate: [22.817, 108.3665] },
  { names: ['西藏自治区', '西藏'], coordinate: [29.652, 91.1721] },
  { names: ['宁夏回族自治区', '宁夏'], coordinate: [38.4872, 106.2309] },
  { names: ['新疆维吾尔自治区', '新疆'], coordinate: [43.8256, 87.6168] },
];

const EVENT_LABELS: Record<ShipmentEventType, string> = {
  CREATED: '创建运单',
  ACCEPTED: '承运方接单',
  PICKED_UP: '货物揽收',
  CHECKPOINT: '运输节点',
  EXCEPTION_REPORTED: '异常位置',
  EXCEPTION_RESOLVED: '异常解除',
  DELIVERED: '货物送达',
  RECEIVED: '完成签收',
  CANCELLED: '运单取消',
};

function findCoordinate(
  value: string,
  entries: CoordinateEntry[],
): { coordinate: MapCoordinate; name: string } | null {
  const normalized = value.replace(/\s/g, '');
  for (const entry of entries) {
    const name = entry.names.find((candidate) => normalized.includes(candidate));
    if (name) return { coordinate: entry.coordinate, name };
  }
  return null;
}

function resolveAddress(city: string, province: string) {
  const cityMatch = findCoordinate(city, CITY_COORDINATES);
  if (cityMatch) return { ...cityMatch, accuracy: 'city' as const };
  const provinceMatch = findCoordinate(province, PROVINCE_COORDINATES);
  if (provinceMatch) return { ...provinceMatch, accuracy: 'province' as const };
  return null;
}

function resolveEventLocation(location: string) {
  const cityMatch = findCoordinate(location, CITY_COORDINATES);
  if (cityMatch) return { ...cityMatch, accuracy: 'city' as const };
  const provinceMatch = findCoordinate(location, PROVINCE_COORDINATES);
  if (provinceMatch) return { ...provinceMatch, accuracy: 'province' as const };
  return null;
}

function coordinatesEqual(first: MapCoordinate, second: MapCoordinate): boolean {
  return Math.abs(first[0] - second[0]) < 0.005 && Math.abs(first[1] - second[1]) < 0.005;
}

export function buildShipmentRoute(shipment: Shipment): ShipmentRoutePoint[] {
  const points: ShipmentRoutePoint[] = [];
  const origin = resolveAddress(shipment.origin.city, shipment.origin.province);
  const destination = resolveAddress(shipment.destination.city, shipment.destination.province);

  if (origin) {
    points.push({
      id: 'origin',
      kind: 'origin',
      coordinate: origin.coordinate,
      title: shipment.origin.city,
      detail: '发货地址（城市级）',
      timestamp: shipment.createdAt,
      accuracy: origin.accuracy,
    });
  }

  [...shipment.events]
    .sort((first, second) => first.sequence - second.sequence)
    .forEach((event) => {
      if (event.type === 'CREATED' || event.type === 'CANCELLED') return;
      const resolved = resolveEventLocation(event.location);
      if (!resolved) return;
      const lastPoint = points.at(-1);
      if (lastPoint && coordinatesEqual(lastPoint.coordinate, resolved.coordinate)) return;
      points.push({
        id: `event-${event.sequence}`,
        kind: event.type === 'DELIVERED' || event.type === 'RECEIVED' ? 'current' : 'checkpoint',
        coordinate: resolved.coordinate,
        title: event.location,
        detail: EVENT_LABELS[event.type],
        timestamp: event.timestamp,
        accuracy: resolved.accuracy,
      });
    });

  const current = resolveEventLocation(shipment.lastLocation);
  if (
    current &&
    shipment.status !== 'CREATED' &&
    shipment.status !== 'CANCELLED' &&
    !points.some((point) => coordinatesEqual(point.coordinate, current.coordinate))
  ) {
    points.push({
      id: 'current',
      kind: 'current',
      coordinate: current.coordinate,
      title: shipment.lastLocation,
      detail: '最近一次已记录位置',
      timestamp: shipment.updatedAt,
      accuracy: current.accuracy,
    });
  } else if (points.length > 1 && shipment.status !== 'RECEIVED') {
    const lastIndex = points.length - 1;
    const lastPoint = points[lastIndex];
    if (lastPoint) points[lastIndex] = { ...lastPoint, kind: 'current' };
  }

  if (
    destination &&
    !points.some(
      (point) =>
        point.kind === 'current' && coordinatesEqual(point.coordinate, destination.coordinate),
    )
  ) {
    points.push({
      id: 'destination',
      kind: 'destination',
      coordinate: destination.coordinate,
      title: shipment.destination.city,
      detail: '收货地址（城市级）',
      accuracy: destination.accuracy,
    });
  }

  return points;
}

export function routeLineDistanceKm(points: ShipmentRoutePoint[]): number {
  const earthRadiusKm = 6371;
  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    if (!previous) return total;
    const latitudeDelta = ((point.coordinate[0] - previous.coordinate[0]) * Math.PI) / 180;
    const longitudeDelta = ((point.coordinate[1] - previous.coordinate[1]) * Math.PI) / 180;
    const firstLatitude = (previous.coordinate[0] * Math.PI) / 180;
    const secondLatitude = (point.coordinate[0] * Math.PI) / 180;
    const haversine =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
    return total + earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }, 0);
}
