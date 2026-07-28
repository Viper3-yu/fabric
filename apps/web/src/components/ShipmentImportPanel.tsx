import { Button, InlineLoading, InlineNotification, ProgressBar, Tag } from '@carbon/react';
import {
  CheckmarkFilled,
  Close,
  DocumentDownload,
  DocumentImport,
  Upload,
  WarningAltFilled,
} from '@carbon/icons-react';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  downloadShipmentTemplate,
  MAX_IMPORT_ROWS,
  parseShipmentFile,
  type ShipmentImportCandidate,
} from '../lib/shipment-import';
import { api, getErrorMessage } from '../lib/api';
import type { ShipmentReceipt } from '../types';

interface ShipmentImportPanelProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

type ImportState = 'pending' | 'importing' | 'success' | 'error';

interface ImportRow extends ShipmentImportCandidate {
  state: ImportState;
  receipt?: ShipmentReceipt;
  importError?: string;
}

function escapeCsv(value: string | number | undefined): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadResults(rows: ImportRow[]) {
  const headers = [
    'Excel行号',
    '货物名称',
    '路线',
    '导入结果',
    '系统运单号',
    '一次性签收码',
    '系统记录编号',
    '失败原因',
  ];
  const lines = rows.map((row) =>
    [
      row.rowNumber,
      row.summary.goodsName,
      row.summary.route,
      row.state === 'success' ? '成功' : row.errors.length ? '校验未通过' : '失败',
      row.receipt?.data.trackingNumber,
      row.receipt?.deliveryCode,
      row.receipt?.transactionId,
      row.errors.join('；') || row.importError,
    ]
      .map(escapeCsv)
      .join(','),
  );
  const blob = new Blob([`\uFEFF${[headers.map(escapeCsv).join(','), ...lines].join('\r\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '迹信运单导入结果.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ShipmentImportPanel({ open, onClose, onImported }: ShipmentImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [importing, setImporting] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [importProgress, setImportProgress] = useState({ completed: 0, total: 0 });

  const validCount = rows.filter((row) => row.errors.length === 0).length;
  const invalidCount = rows.length - validCount;
  const successCount = rows.filter((row) => row.state === 'success').length;
  const errorCount = rows.filter((row) => row.state === 'error').length;
  const pendingCount = rows.filter(
    (row) => row.errors.length === 0 && row.state !== 'success',
  ).length;
  const hasResults = successCount > 0 || errorCount > 0;

  const progressLabel = useMemo(() => {
    if (!importing) return '';
    return `正在写入第 ${Math.min(importProgress.completed + 1, importProgress.total)} / ${importProgress.total} 张运单`;
  }, [importProgress, importing]);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const fileInput = event.currentTarget;
    const file = fileInput.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setRows([]);
    setImportProgress({ completed: 0, total: 0 });
    setParseError('');
    setParsing(true);
    try {
      const candidates = await parseShipmentFile(file);
      setRows(candidates.map((candidate) => ({ ...candidate, state: 'pending' })));
    } catch (caught) {
      setParseError(getErrorMessage(caught));
    } finally {
      setParsing(false);
      fileInput.value = '';
    }
  };

  const handleTemplate = async () => {
    setTemplateLoading(true);
    setParseError('');
    try {
      await downloadShipmentTemplate();
    } catch (caught) {
      setParseError(`模板生成失败：${getErrorMessage(caught)}`);
    } finally {
      setTemplateLoading(false);
    }
  };

  const handleImport = async () => {
    if (!pendingCount || importing) return;
    setImporting(true);
    const working = [...rows];
    const attemptTotal = working.filter(
      (row) => row.errors.length === 0 && row.state !== 'success',
    ).length;
    let attemptCompleted = 0;
    setImportProgress({ completed: 0, total: attemptTotal });
    let importedAny = false;

    for (let index = 0; index < working.length; index += 1) {
      const row = working[index];
      if (!row) continue;
      if (row.errors.length || row.state === 'success') continue;
      const importingRow: ImportRow = { ...row, state: 'importing' };
      delete importingRow.importError;
      working[index] = importingRow;
      setRows([...working]);
      try {
        const { data } = await api.shipments.create(row.input);
        working[index] = { ...importingRow, state: 'success', receipt: data };
        importedAny = true;
      } catch (caught) {
        working[index] = {
          ...importingRow,
          state: 'error',
          importError: getErrorMessage(caught),
        };
      }
      setRows([...working]);
      attemptCompleted += 1;
      setImportProgress({ completed: attemptCompleted, total: attemptTotal });
    }

    setImporting(false);
    if (importedAny) onImported();
  };

  if (!open) return null;

  return (
    <section className="shipment-import-panel" aria-labelledby="shipment-import-title">
      <header>
        <div>
          <span>Excel / CSV 批量建单</span>
          <h2 id="shipment-import-title">导入运单</h2>
          <p>每一行会单独创建运单并返回系统记录编号；系统仍会生成唯一运单号。</p>
        </div>
        <Button
          hasIconOnly
          kind="ghost"
          renderIcon={Close}
          iconDescription="关闭导入面板"
          onClick={onClose}
          disabled={importing}
        />
      </header>

      <div className="shipment-import-panel__start">
        <label className="shipment-import-dropzone">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFile}
            disabled={parsing || importing}
          />
          <Upload size={24} aria-hidden="true" />
          <span>
            <strong>{fileName || '选择 Excel 或 CSV 文件'}</strong>
            <small>支持 .xlsx、.xls、.csv，第一行须为表头，单次最多 {MAX_IMPORT_ROWS} 行</small>
          </span>
        </label>
        <Button
          kind="tertiary"
          size="sm"
          renderIcon={DocumentDownload}
          onClick={() => void handleTemplate()}
          disabled={templateLoading || importing}
        >
          {templateLoading ? '正在生成' : '下载 Excel 模板'}
        </Button>
      </div>

      {parsing ? <InlineLoading description="正在读取并校验文件" /> : null}
      {parseError ? (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title="文件没有通过校验"
          subtitle={parseError}
        />
      ) : null}

      {rows.length ? (
        <>
          <div className="shipment-import-panel__summary" aria-live="polite">
            <span>已读取 {rows.length} 行</span>
            <Tag type="green">可导入 {validCount}</Tag>
            {invalidCount ? <Tag type="red">需修正 {invalidCount}</Tag> : null}
            {successCount ? <Tag type="teal">已成功 {successCount}</Tag> : null}
            {errorCount ? <Tag type="magenta">写入失败 {errorCount}</Tag> : null}
          </div>

          {importing ? (
            <ProgressBar
              label={progressLabel}
              value={importProgress.completed}
              max={Math.max(importProgress.total, 1)}
              helperText="正在逐条提交，关闭页面会中断未提交的行"
            />
          ) : null}

          {successCount ? (
            <InlineNotification
              kind="warning"
              lowContrast
              hideCloseButton
              title="请立即下载并妥善保存导入结果"
              subtitle="结果文件包含每张运单的一次性签收码；接口不会再次返回该签收码。"
            />
          ) : null}

          <div className="shipment-import-preview">
            <table>
              <thead>
                <tr>
                  <th>行</th>
                  <th>货物</th>
                  <th>路线</th>
                  <th>件数</th>
                  <th>预计送达</th>
                  <th>校验 / 写入结果</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowNumber} data-state={row.errors.length ? 'invalid' : row.state}>
                    <td className="mono">{row.rowNumber}</td>
                    <td>{row.summary.goodsName}</td>
                    <td>{row.summary.route}</td>
                    <td className="mono">{row.summary.quantity}</td>
                    <td className="mono">{row.summary.expectedDeliveryDate}</td>
                    <td>
                      {row.errors.length ? (
                        <span className="import-row-result is-error">
                          <WarningAltFilled size={16} aria-hidden="true" />
                          {row.errors.join('；')}
                        </span>
                      ) : null}
                      {!row.errors.length && row.state === 'pending' ? (
                        <span className="import-row-result">等待写入</span>
                      ) : null}
                      {row.state === 'importing' ? (
                        <span className="import-row-result">正在写入</span>
                      ) : null}
                      {row.state === 'success' ? (
                        <span className="import-row-result is-success">
                          <CheckmarkFilled size={16} aria-hidden="true" />
                          <span>
                            {row.receipt?.data.trackingNumber}
                            <small className="mono">签收码 {row.receipt?.deliveryCode}</small>
                          </span>
                        </span>
                      ) : null}
                      {row.state === 'error' ? (
                        <span className="import-row-result is-error">
                          <WarningAltFilled size={16} aria-hidden="true" />
                          {row.importError}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <footer>
            <p>
              {invalidCount
                ? '校验未通过的行不会提交，请按提示修改原文件后重新选择。'
                : '全部行已通过格式校验，可以开始写入。'}
            </p>
            <div>
              {hasResults ? (
                <Button
                  kind="secondary"
                  renderIcon={DocumentDownload}
                  onClick={() => downloadResults(rows)}
                  disabled={importing}
                >
                  下载导入结果
                </Button>
              ) : null}
              <Button
                renderIcon={DocumentImport}
                onClick={() => void handleImport()}
                disabled={!pendingCount || importing}
              >
                {importing
                  ? '正在导入'
                  : errorCount
                    ? `重试失败项（${errorCount}）`
                    : `导入 ${validCount} 张运单`}
              </Button>
            </div>
          </footer>
        </>
      ) : null}
    </section>
  );
}
