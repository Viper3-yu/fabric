import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  Button,
  ComposedModal,
  InlineNotification,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextArea,
  TextInput,
} from '@carbon/react';
import type { Shipment } from '@jixin/shared';
import { api, getErrorMessage } from '../lib/api';
import { ACTION_LABELS } from '../lib/presentation';
import type { ShipmentAction, ShipmentActionPayload, ShipmentReceipt } from '../types';

const ACTION_COPY: Record<
  ShipmentAction,
  { description: string; submit: string; danger?: boolean }
> = {
  accept: { description: '确认由当前承运方承担后续运输责任。', submit: '确认接单' },
  pickup: { description: '记录实际揽收地点，责任由发货方转移至承运方。', submit: '确认已揽收' },
  checkpoint: {
    description: '追加一条不能被悄悄覆盖的运输记录。温度超出范围时，系统会自动标记异常。',
    submit: '提交运输节点',
  },
  exception: {
    description: '上报运输异常，同时保存位置、现场说明和可选文件核对编号。',
    submit: '确认上报异常',
    danger: true,
  },
  resolve: { description: '说明异常处理结果，运单将恢复为运输中。', submit: '确认解除异常' },
  deliver: {
    description: '保存送达文件的核对编号，随后由收货方使用签收码完成确认。',
    submit: '确认已送达',
  },
  confirm: {
    description: '签收码只可使用一次，校验通过后运单进入已签收状态。',
    submit: '确认签收',
  },
  cancel: {
    description: '仅待接单运单可取消。取消后业务流程终止。',
    submit: '确认取消运单',
    danger: true,
  },
};

function formValue(form: FormData, key: string): string {
  return String(form.get(key) ?? '').trim();
}

function buildPayload(action: ShipmentAction, form: FormData): ShipmentActionPayload {
  const location = formValue(form, 'location');
  const description = formValue(form, 'description');
  const evidenceHash = formValue(form, 'evidenceHash');
  const deliveryCode = formValue(form, 'deliveryCode');
  const reason = formValue(form, 'reason');
  const temperature = formValue(form, 'temperature');
  const payload: ShipmentActionPayload = {};

  if (location) payload.location = location;
  if (description) payload.description = description;
  if (evidenceHash) payload.evidenceHash = evidenceHash;
  if (deliveryCode) payload.deliveryCode = deliveryCode;
  if (reason) payload.reason = reason;
  if (temperature) payload.temperature = Number(temperature);

  if (action === 'cancel') delete payload.description;
  return payload;
}

export function ActionDialog({
  shipment,
  action,
  open,
  onClose,
  onSuccess,
}: {
  shipment: Shipment;
  action: ShipmentAction | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (receipt: ShipmentReceipt) => void;
}) {
  const formId = useId();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) setError('');
  }, [open, action]);

  if (!action) return null;
  const copy = ACTION_COPY[action];

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = buildPayload(action, new FormData(event.currentTarget));
      const { data } = await api.shipments.action(shipment.id, action, payload);
      onSuccess(data);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const needsLocation = ['pickup', 'checkpoint', 'exception', 'resolve', 'deliver'].includes(
    action,
  );
  const optionalLocation = ['accept', 'confirm'].includes(action);
  const needsDescription = ['checkpoint', 'exception', 'resolve'].includes(action);
  const optionalDescription = ['accept', 'pickup', 'deliver', 'confirm'].includes(action);
  const supportsEvidence = ['checkpoint', 'exception', 'resolve', 'deliver'].includes(action);

  return (
    <ComposedModal open={open} onClose={onClose} preventCloseOnClickOutside>
      <ModalHeader
        label={`运单 ${shipment.trackingNumber}`}
        title={ACTION_LABELS[action]}
        closeModal={onClose}
        iconDescription="关闭"
      />
      <ModalBody>
        <p className="action-dialog__description">{copy.description}</p>
        <form id={formId} className="action-dialog__form" onSubmit={handleSubmit}>
          {needsLocation || optionalLocation ? (
            <TextInput
              id={`${formId}-location`}
              name="location"
              labelText={`操作地点${optionalLocation ? '（选填）' : ''}`}
              placeholder="例如：上海市浦东转运中心"
              required={needsLocation}
            />
          ) : null}
          {needsDescription || optionalDescription ? (
            <TextArea
              id={`${formId}-description`}
              name="description"
              labelText={`处理说明${optionalDescription ? '（选填）' : ''}`}
              placeholder="记录现场情况和交接说明"
              rows={3}
              required={needsDescription}
            />
          ) : null}
          {action === 'checkpoint' ? (
            <TextInput
              id={`${formId}-temperature`}
              name="temperature"
              labelText="实测温度（°C，选填）"
              type="number"
              step="0.1"
              helperText={
                shipment.temperatureRange
                  ? `设定温区 ${shipment.temperatureRange.min} °C 至 ${shipment.temperatureRange.max} °C`
                  : '此运单未设置温控范围'
              }
            />
          ) : null}
          {supportsEvidence ? (
            <TextInput
              id={`${formId}-evidence`}
              name="evidenceHash"
              labelText={`文件核对编号${action === 'deliver' ? '' : '（选填）'}`}
              helperText="填写文件生成的 64 位核对编号。系统用它判断文件有没有被换过，不会公开原文件。"
              pattern="[A-Fa-f0-9]{64}"
              required={action === 'deliver'}
            />
          ) : null}
          {action === 'confirm' ? (
            <TextInput
              id={`${formId}-delivery-code`}
              name="deliveryCode"
              labelText="6 位一次性签收码"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              required
            />
          ) : null}
          {action === 'cancel' ? (
            <TextArea id={`${formId}-reason`} name="reason" labelText="取消原因（选填）" rows={3} />
          ) : null}
          {error ? (
            <InlineNotification
              kind="error"
              lowContrast
              hideCloseButton
              title="这次操作保存失败"
              subtitle={error}
            />
          ) : null}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button kind="secondary" onClick={onClose} disabled={submitting}>
          返回
        </Button>
        <Button
          type="submit"
          form={formId}
          kind={copy.danger ? 'danger' : 'primary'}
          disabled={submitting}
        >
          {submitting ? '正在保存记录' : copy.submit}
        </Button>
      </ModalFooter>
    </ComposedModal>
  );
}
