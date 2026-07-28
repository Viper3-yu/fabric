import type { CreateShipmentInput } from '../types';

export const MAX_IMPORT_ROWS = 200;

type ImportColumnKey =
  | 'originProvince'
  | 'originCity'
  | 'originDistrict'
  | 'originDetail'
  | 'originContactName'
  | 'originContactPhone'
  | 'destinationProvince'
  | 'destinationCity'
  | 'destinationDistrict'
  | 'destinationDetail'
  | 'destinationContactName'
  | 'destinationContactPhone'
  | 'goodsName'
  | 'goodsCategory'
  | 'quantity'
  | 'weightKg'
  | 'goodsDescription'
  | 'expectedDeliveryDate'
  | 'temperatureMin'
  | 'temperatureMax'
  | 'documentHash';

interface ImportColumn {
  key: ImportColumnKey;
  label: string;
  required: boolean;
  aliases: string[];
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  {
    key: 'originProvince',
    label: '发货省',
    required: true,
    aliases: ['发货省份', 'originProvince'],
  },
  { key: 'originCity', label: '发货市', required: true, aliases: ['发货城市', 'originCity'] },
  {
    key: 'originDistrict',
    label: '发货区县',
    required: false,
    aliases: ['发货区', 'originDistrict'],
  },
  {
    key: 'originDetail',
    label: '发货详细地址',
    required: true,
    aliases: ['发货地址', 'originDetail'],
  },
  {
    key: 'originContactName',
    label: '发货联系人',
    required: true,
    aliases: ['发件人', 'originContactName'],
  },
  {
    key: 'originContactPhone',
    label: '发货联系电话',
    required: true,
    aliases: ['发货电话', '发件人电话', 'originContactPhone'],
  },
  {
    key: 'destinationProvince',
    label: '收货省',
    required: true,
    aliases: ['收货省份', 'destinationProvince'],
  },
  {
    key: 'destinationCity',
    label: '收货市',
    required: true,
    aliases: ['收货城市', 'destinationCity'],
  },
  {
    key: 'destinationDistrict',
    label: '收货区县',
    required: false,
    aliases: ['收货区', 'destinationDistrict'],
  },
  {
    key: 'destinationDetail',
    label: '收货详细地址',
    required: true,
    aliases: ['收货地址', 'destinationDetail'],
  },
  {
    key: 'destinationContactName',
    label: '收货联系人',
    required: true,
    aliases: ['收件人', 'destinationContactName'],
  },
  {
    key: 'destinationContactPhone',
    label: '收货联系电话',
    required: true,
    aliases: ['收货电话', '收件人电话', 'destinationContactPhone'],
  },
  { key: 'goodsName', label: '货物名称', required: true, aliases: ['品名', 'goodsName'] },
  {
    key: 'goodsCategory',
    label: '货物类别',
    required: true,
    aliases: ['货物分类', 'category', 'goodsCategory'],
  },
  { key: 'quantity', label: '件数', required: true, aliases: ['数量', 'quantity'] },
  {
    key: 'weightKg',
    label: '重量kg',
    required: true,
    aliases: ['重量(kg)', '重量（kg）', '重量', 'weightKg'],
  },
  {
    key: 'goodsDescription',
    label: '货物说明',
    required: false,
    aliases: ['备注', 'goodsDescription'],
  },
  {
    key: 'expectedDeliveryDate',
    label: '预计送达日期',
    required: true,
    aliases: ['预计送达', 'expectedDeliveryDate'],
  },
  {
    key: 'temperatureMin',
    label: '温控下限℃',
    required: false,
    aliases: ['温控下限', '最低温度', 'temperatureMin'],
  },
  {
    key: 'temperatureMax',
    label: '温控上限℃',
    required: false,
    aliases: ['温控上限', '最高温度', 'temperatureMax'],
  },
  {
    key: 'documentHash',
    label: '文件核对编号',
    required: false,
    aliases: ['文件哈希', 'documentHash'],
  },
];

export interface ShipmentImportCandidate {
  rowNumber: number;
  input: CreateShipmentInput;
  errors: string[];
  summary: {
    goodsName: string;
    route: string;
    quantity: string;
    expectedDeliveryDate: string;
  };
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_（）()℃°*＊-]/g, '');
}

function cellText(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, '0'),
      String(value.getDate()).padStart(2, '0'),
    ].join('-');
  }
  return String(value ?? '').trim();
}

function readCells(record: Record<string, unknown>): Record<ImportColumnKey, string> {
  const normalizedRecord = new Map(
    Object.entries(record).map(([header, value]) => [normalizeHeader(header), cellText(value)]),
  );

  return Object.fromEntries(
    IMPORT_COLUMNS.map((column) => {
      const headers = [column.label, ...column.aliases].map(normalizeHeader);
      const value = headers.map((header) => normalizedRecord.get(header)).find(Boolean) ?? '';
      return [column.key, value];
    }),
  ) as Record<ImportColumnKey, string>;
}

function validDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})[年/.\\-](\d{1,2})[月/.\\-](\d{1,2})日?$/);
  if (!match) return null;
  const year = match[1];
  const month = match[2];
  const day = match[3];
  if (!year || !month || !day) return null;
  const normalized = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return normalized;
}

function validatePhone(value: string): boolean {
  return value.length >= 7 && value.length <= 30 && /^[+\d][\d\s-]+$/.test(value);
}

function addLengthError(errors: string[], value: string, label: string, maximum: number) {
  if (value.length > maximum) errors.push(`${label}不能超过 ${maximum} 个字符`);
}

function toCandidate(
  record: Record<string, unknown>,
  index: number,
): ShipmentImportCandidate | null {
  const cells = readCells(record);
  if (!Object.values(cells).some(Boolean)) return null;

  const errors: string[] = [];
  IMPORT_COLUMNS.filter((column) => column.required).forEach((column) => {
    if (!cells[column.key]) errors.push(`缺少${column.label}`);
  });

  const quantity = Number(cells.quantity);
  const weightKg = Number(cells.weightKg);
  if (cells.quantity && (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000)) {
    errors.push('件数须为 1 至 100000 的整数');
  }
  if (cells.weightKg && (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 1_000_000)) {
    errors.push('重量须为 0 至 1000000 kg 的数字');
  }
  if (cells.originContactPhone && !validatePhone(cells.originContactPhone)) {
    errors.push('发货联系电话格式不正确');
  }
  if (cells.destinationContactPhone && !validatePhone(cells.destinationContactPhone)) {
    errors.push('收货联系电话格式不正确');
  }

  const deliveryDate = validDate(cells.expectedDeliveryDate);
  if (cells.expectedDeliveryDate && !deliveryDate) {
    errors.push('预计送达日期须使用 YYYY-MM-DD');
  }

  const hasTemperature = Boolean(cells.temperatureMin || cells.temperatureMax);
  const temperatureMin = Number(cells.temperatureMin);
  const temperatureMax = Number(cells.temperatureMax);
  if (hasTemperature) {
    if (!cells.temperatureMin || !cells.temperatureMax) {
      errors.push('温控上下限须同时填写');
    } else if (
      !Number.isFinite(temperatureMin) ||
      !Number.isFinite(temperatureMax) ||
      temperatureMin < -100 ||
      temperatureMax > 100 ||
      temperatureMin >= temperatureMax
    ) {
      errors.push('温控范围须在 -100 至 100℃ 且下限小于上限');
    }
  }
  if (cells.documentHash && !/^[a-fA-F0-9]{64}$/.test(cells.documentHash)) {
    errors.push('文件核对编号须为 64 位 SHA-256');
  }

  addLengthError(errors, cells.originProvince, '发货省', 30);
  addLengthError(errors, cells.originCity, '发货市', 30);
  addLengthError(errors, cells.originDistrict, '发货区县', 50);
  addLengthError(errors, cells.originDetail, '发货详细地址', 120);
  addLengthError(errors, cells.originContactName, '发货联系人', 40);
  addLengthError(errors, cells.destinationProvince, '收货省', 30);
  addLengthError(errors, cells.destinationCity, '收货市', 30);
  addLengthError(errors, cells.destinationDistrict, '收货区县', 50);
  addLengthError(errors, cells.destinationDetail, '收货详细地址', 120);
  addLengthError(errors, cells.destinationContactName, '收货联系人', 40);
  addLengthError(errors, cells.goodsName, '货物名称', 80);
  addLengthError(errors, cells.goodsCategory, '货物类别', 40);
  addLengthError(errors, cells.goodsDescription, '货物说明', 300);

  const input: CreateShipmentInput = {
    origin: {
      province: cells.originProvince,
      city: cells.originCity,
      detail: cells.originDetail,
      contactName: cells.originContactName,
      contactPhone: cells.originContactPhone,
      ...(cells.originDistrict ? { district: cells.originDistrict } : {}),
    },
    destination: {
      province: cells.destinationProvince,
      city: cells.destinationCity,
      detail: cells.destinationDetail,
      contactName: cells.destinationContactName,
      contactPhone: cells.destinationContactPhone,
      ...(cells.destinationDistrict ? { district: cells.destinationDistrict } : {}),
    },
    goods: {
      name: cells.goodsName,
      category: cells.goodsCategory,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      weightKg: Number.isFinite(weightKg) ? weightKg : 0,
      ...(cells.goodsDescription ? { description: cells.goodsDescription } : {}),
    },
    expectedDeliveryDate: deliveryDate ?? cells.expectedDeliveryDate,
    ...(hasTemperature && Number.isFinite(temperatureMin) && Number.isFinite(temperatureMax)
      ? { temperatureRange: { min: temperatureMin, max: temperatureMax, unit: 'C' as const } }
      : {}),
    ...(cells.documentHash ? { documentHash: cells.documentHash.toLowerCase() } : {}),
  };

  return {
    rowNumber: index + 2,
    input,
    errors: [...new Set(errors)],
    summary: {
      goodsName: cells.goodsName || '未填写',
      route: `${cells.originCity || '未填写'} → ${cells.destinationCity || '未填写'}`,
      quantity: cells.quantity || '未填写',
      expectedDeliveryDate: deliveryDate ?? (cells.expectedDeliveryDate || '未填写'),
    },
  };
}

export function parseImportRecords(records: Record<string, unknown>[]): ShipmentImportCandidate[] {
  return records
    .slice(0, MAX_IMPORT_ROWS)
    .map(toCandidate)
    .filter((candidate): candidate is ShipmentImportCandidate => candidate !== null);
}

function csvRecords(text: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [headerRow, ...dataRows] = rows;
  if (!headerRow) return [];
  const headers = headerRow.map((header, index) =>
    index === 0 ? header.replace(/^\uFEFF/, '') : header,
  );
  return dataRows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])),
  );
}

export async function parseShipmentFile(file: File): Promise<ShipmentImportCandidate[]> {
  const fileData = await file.arrayBuffer();
  const isCsv = file.name.toLowerCase().endsWith('.csv');
  let records: Record<string, unknown>[];

  if (isCsv) {
    records = csvRecords(new TextDecoder('utf-8').decode(fileData));
  } else {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(fileData, {
      type: 'array',
      cellDates: true,
      dateNF: 'yyyy-mm-dd',
    });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) throw new Error('文件中没有可读取的工作表');
    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) throw new Error('文件中的第一个工作表无法读取');
    records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: false,
      dateNF: 'yyyy-mm-dd',
    });
  }

  if (records.length > MAX_IMPORT_ROWS) {
    throw new Error(`单次最多导入 ${MAX_IMPORT_ROWS} 行，请拆分文件后重试`);
  }
  const candidates = parseImportRecords(records);
  if (!candidates.length) throw new Error('没有读取到运单数据，请检查表头和内容');
  return candidates;
}

export async function downloadShipmentTemplate(): Promise<void> {
  const XLSX = await import('xlsx');
  const headers = IMPORT_COLUMNS.map((column) => `${column.label}${column.required ? '*' : ''}`);
  const sample = [
    '上海市',
    '上海市',
    '浦东新区',
    '张江路 88 号 3 号库',
    '周敏',
    '138 0013 8000',
    '江苏省',
    '南京市',
    '江宁区',
    '秣周东路 12 号',
    '王宁',
    '139 0013 9000',
    '医用耗材',
    '医疗物资',
    24,
    186.5,
    '防潮，轻拿轻放',
    '2026-08-06',
    2,
    8,
    '',
  ];
  const sheet = XLSX.utils.aoa_to_sheet([headers, sample]);
  sheet['!cols'] = IMPORT_COLUMNS.map((column) => ({
    wch: Math.max(column.label.length * 2 + 4, column.key.includes('Detail') ? 24 : 14),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '运单导入');
  XLSX.writeFile(workbook, '迹信运单导入模板.xlsx');
}
