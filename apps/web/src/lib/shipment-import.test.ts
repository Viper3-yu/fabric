import { describe, expect, it } from 'vitest';
import {
  getShipmentTemplateHeaders,
  parseImportRecords,
  parseShipmentFile,
} from './shipment-import';

const validRecord = {
  发货省: '上海市',
  发货市: '上海市',
  发货区县: '浦东新区',
  发货详细地址: '张江路 88 号',
  发货联系人: '周敏',
  发货联系电话: '138 0013 8000',
  收货省: '江苏省',
  收货市: '南京市',
  收货区县: '江宁区',
  收货详细地址: '秣周东路 12 号',
  收货联系人: '王宁',
  收货联系电话: '139 0013 9000',
  货物名称: '医用耗材',
  货物类别: '医疗物资',
  件数: '24',
  重量kg: '186.5',
  货物说明: '防潮',
  预计送达日期: '2026/8/6',
  '温控下限℃': '2',
  '温控上限℃': '8',
  文件核对编号: '',
};

describe('parseImportRecords', () => {
  it('builds a downloadable template without required-field asterisks', () => {
    expect(getShipmentTemplateHeaders()).not.toContainEqual(expect.stringMatching(/[*＊]/));
  });

  it('maps the downloadable Chinese template into create-shipment input', () => {
    const candidate = parseImportRecords([validRecord])[0]!;

    expect(candidate.errors).toEqual([]);
    expect(candidate.rowNumber).toBe(2);
    expect(candidate.input).toMatchObject({
      origin: { province: '上海市', city: '上海市', district: '浦东新区' },
      destination: { province: '江苏省', city: '南京市', district: '江宁区' },
      goods: { name: '医用耗材', quantity: 24, weightKg: 186.5 },
      expectedDeliveryDate: '2026-08-06',
      temperatureRange: { min: 2, max: 8, unit: 'C' },
    });
  });

  it('reports row-level validation failures without discarding the row', () => {
    const candidate = parseImportRecords([
      {
        ...validRecord,
        件数: '2.5',
        预计送达日期: '2026-02-31',
        '温控下限℃': '8',
        '温控上限℃': '2',
      },
    ])[0]!;

    expect(candidate.errors).toEqual(
      expect.arrayContaining([
        '件数须为 1 至 100000 的整数',
        '预计送达日期须使用 YYYY-MM-DD',
        '温控范围须在 -100 至 100℃ 且下限小于上限',
      ]),
    );
  });

  it('ignores completely empty spreadsheet rows', () => {
    expect(parseImportRecords([{}, validRecord, { 发货省: '   ' }])).toHaveLength(1);
  });

  it('decodes UTF-8 Chinese CSV headers before workbook parsing', async () => {
    const csv = [
      Object.keys(validRecord).join(','),
      Object.values(validRecord).join(','),
      Object.values({ ...validRecord, 预计送达日期: '2026-02-31' }).join(','),
    ].join('\r\n');
    const bytes = new TextEncoder().encode(csv);
    const file = {
      name: '运单.csv',
      arrayBuffer: async () => bytes.buffer,
    } as File;

    const [candidate, invalidDateCandidate] = await parseShipmentFile(file);

    expect(candidate?.errors).toEqual([]);
    expect(candidate?.input.goods.name).toBe('医用耗材');
    expect(invalidDateCandidate?.errors).toContain('预计送达日期须使用 YYYY-MM-DD');
  });

  it('reads an xlsx workbook through the same row validation path', async () => {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.json_to_sheet([validRecord]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '运单导入');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const file = {
      name: '运单.xlsx',
      arrayBuffer: async () => bytes,
    } as File;

    const [candidate] = await parseShipmentFile(file);

    expect(candidate?.errors).toEqual([]);
    expect(candidate?.input.destination.city).toBe('南京市');
  });
});
