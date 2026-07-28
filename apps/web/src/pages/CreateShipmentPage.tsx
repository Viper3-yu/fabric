import { useState, type FormEvent } from 'react';
import {
  Button,
  Checkbox,
  ComposedModal,
  Form,
  InlineNotification,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextArea,
  TextInput,
  Tile,
} from '@carbon/react';
import {
  ArrowLeft,
  ArrowRight,
  CheckmarkFilled,
  DeliveryParcel,
  Information,
  Location,
} from '@carbon/icons-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { CopyButton } from '../components/CopyButton';
import { api, getErrorMessage } from '../lib/api';
import type { CreateShipmentInput, ShipmentReceipt } from '../types';

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

export function CreateShipmentPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [temperatureEnabled, setTemperatureEnabled] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<ShipmentReceipt | null>(null);

  if (user?.role !== 'shipper') return <Navigate to="/app/shipments" replace />;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const quantity = Number(field(form, 'quantity'));
    const weightKg = Number(field(form, 'weightKg'));
    const min = Number(field(form, 'temperatureMin'));
    const max = Number(field(form, 'temperatureMax'));

    if (!Number.isInteger(quantity) || quantity < 1) {
      setError('货物件数必须是大于 0 的整数');
      return;
    }
    if (!Number.isFinite(weightKg) || weightKg <= 0) {
      setError('货物重量必须大于 0');
      return;
    }
    if (temperatureEnabled && (!Number.isFinite(min) || !Number.isFinite(max) || min >= max)) {
      setError('温控下限必须小于上限');
      return;
    }

    const goodsDescription = field(form, 'goodsDescription');
    const originDistrict = field(form, 'originDistrict');
    const destinationDistrict = field(form, 'destinationDistrict');
    const documentHash = field(form, 'documentHash');

    const input: CreateShipmentInput = {
      origin: {
        province: field(form, 'originProvince'),
        city: field(form, 'originCity'),
        detail: field(form, 'originDetail'),
        contactName: field(form, 'originContactName'),
        contactPhone: field(form, 'originContactPhone'),
        ...(originDistrict ? { district: originDistrict } : {}),
      },
      destination: {
        province: field(form, 'destinationProvince'),
        city: field(form, 'destinationCity'),
        detail: field(form, 'destinationDetail'),
        contactName: field(form, 'destinationContactName'),
        contactPhone: field(form, 'destinationContactPhone'),
        ...(destinationDistrict ? { district: destinationDistrict } : {}),
      },
      goods: {
        name: field(form, 'goodsName'),
        category: field(form, 'goodsCategory'),
        quantity,
        weightKg,
        ...(goodsDescription ? { description: goodsDescription } : {}),
      },
      expectedDeliveryDate: field(form, 'expectedDeliveryDate'),
      ...(temperatureEnabled ? { temperatureRange: { min, max, unit: 'C' as const } } : {}),
      ...(documentHash ? { documentHash } : {}),
    };

    setSubmitting(true);
    try {
      const { data } = await api.shipments.create(input);
      setReceipt(data);
    } catch (caught) {
      setError(getErrorMessage(caught));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page create-shipment-page">
      <header className="page-header">
        <Button
          className="page-back-button"
          kind="ghost"
          size="sm"
          onClick={() => navigate('/app/shipments')}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span>返回运单列表</span>
        </Button>
        <p className="eyebrow">发货方操作</p>
        <h1>创建运单</h1>
        <p>提交后将生成唯一运单号和一次性签收码。请将签收码通过安全渠道交给收货方。</p>
      </header>

      <ol className="creation-steps" aria-label="创建运单填写顺序">
        <li>
          <span className="mono">01</span>
          <strong>发货信息</strong>
        </li>
        <li>
          <span className="mono">02</span>
          <strong>收货信息</strong>
        </li>
        <li>
          <span className="mono">03</span>
          <strong>货物与交付</strong>
        </li>
      </ol>

      {error ? (
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title="运单创建失败"
          subtitle={error}
        />
      ) : null}

      <Form className="shipment-form" onSubmit={handleSubmit}>
        <Tile className="form-section">
          <div className="form-section__heading">
            <span className="form-section__number" aria-hidden="true">
              <Location size={20} />
            </span>
            <div>
              <h2>发货信息</h2>
              <p>填写货物出发地点和发货联系人。</p>
            </div>
          </div>
          <div className="form-grid form-grid--3">
            <TextInput id="origin-province" name="originProvince" labelText="省份" required />
            <TextInput id="origin-city" name="originCity" labelText="城市" required />
            <TextInput id="origin-district" name="originDistrict" labelText="区县（选填）" />
          </div>
          <TextInput id="origin-detail" name="originDetail" labelText="详细地址" required />
          <div className="form-grid form-grid--2">
            <TextInput
              id="origin-contact"
              name="originContactName"
              labelText="发货联系人"
              required
            />
            <TextInput
              id="origin-phone"
              name="originContactPhone"
              labelText="联系电话"
              type="tel"
              autoComplete="tel"
              required
            />
          </div>
        </Tile>

        <Tile className="form-section">
          <div className="form-section__heading">
            <span className="form-section__number" aria-hidden="true">
              <Location size={20} />
            </span>
            <div>
              <h2>收货信息</h2>
              <p>公开查询仅显示脱敏后的收货资料。</p>
            </div>
          </div>
          <div className="form-grid form-grid--3">
            <TextInput
              id="destination-province"
              name="destinationProvince"
              labelText="省份"
              required
            />
            <TextInput id="destination-city" name="destinationCity" labelText="城市" required />
            <TextInput
              id="destination-district"
              name="destinationDistrict"
              labelText="区县（选填）"
            />
          </div>
          <TextInput
            id="destination-detail"
            name="destinationDetail"
            labelText="详细地址"
            required
          />
          <div className="form-grid form-grid--2">
            <TextInput
              id="destination-contact"
              name="destinationContactName"
              labelText="收货联系人"
              autoComplete="name"
              required
            />
            <TextInput
              id="destination-phone"
              name="destinationContactPhone"
              labelText="收货联系电话"
              type="tel"
              autoComplete="tel"
              required
            />
          </div>
        </Tile>

        <Tile className="form-section">
          <div className="form-section__heading">
            <span className="form-section__number" aria-hidden="true">
              <DeliveryParcel size={20} />
            </span>
            <div>
              <h2>货物与交付</h2>
              <p>如有温区要求可选择设置；承运方人工录入节点温度后，链码会判断是否越界。</p>
            </div>
          </div>
          <div className="form-grid form-grid--2">
            <TextInput id="goods-name" name="goodsName" labelText="货物名称" required />
            <TextInput id="goods-category" name="goodsCategory" labelText="货物类别" required />
            <TextInput
              id="goods-quantity"
              name="quantity"
              labelText="件数"
              type="number"
              min="1"
              step="1"
              required
            />
            <TextInput
              id="goods-weight"
              name="weightKg"
              labelText="总重量（kg）"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </div>
          <TextArea
            id="goods-description"
            name="goodsDescription"
            labelText="货物说明（选填）"
            rows={3}
          />
          <TextInput
            id="expected-delivery"
            name="expectedDeliveryDate"
            labelText="预计送达日期"
            type="date"
            required
          />
          <div className="temperature-control">
            <Checkbox
              id="temperature-enabled"
              labelText="设置温控范围（选填）"
              checked={temperatureEnabled}
              onChange={(_event, data) => setTemperatureEnabled(Boolean(data.checked))}
            />
            {temperatureEnabled ? (
              <div className="form-grid form-grid--2">
                <TextInput
                  id="temperature-min"
                  name="temperatureMin"
                  labelText="温度下限（°C）"
                  type="number"
                  step="0.1"
                  required
                />
                <TextInput
                  id="temperature-max"
                  name="temperatureMax"
                  labelText="温度上限（°C）"
                  type="number"
                  step="0.1"
                  required
                />
              </div>
            ) : null}
          </div>
          <TextInput
            id="document-hash"
            name="documentHash"
            labelText="发货文件核对编号（选填）"
            helperText="填写文件生成的 64 位核对编号。系统用它判断文件有没有被换过，不会公开原文件。"
            pattern="[A-Fa-f0-9]{64}"
          />
        </Tile>

        <div className="form-submit-bar">
          <div>
            <Information size={20} aria-hidden="true" />
            <span>操作时间由记录服务统一提供，不使用当前电脑的时间。</span>
          </div>
          <Button type="submit" renderIcon={ArrowRight} disabled={submitting}>
            {submitting ? '正在保存运单' : '创建并保存运单'}
          </Button>
        </div>
      </Form>

      <ComposedModal open={Boolean(receipt)} preventCloseOnClickOutside>
        <ModalHeader title="运单创建成功" iconDescription="关闭" />
        <ModalBody>
          {receipt ? (
            <div className="creation-success">
              <CheckmarkFilled size={32} aria-hidden="true" />
              <p>
                运单已保存到
                {receipt.ledgerMode === 'fabric' ? ' Fabric 协作网络' : '演示环境'}。
              </p>
              {receipt.deliveryCode ? (
                <div className="delivery-code-block">
                  <span>一次性签收码</span>
                  <div>
                    <strong className="mono">{receipt.deliveryCode}</strong>
                    <CopyButton value={receipt.deliveryCode} label="复制签收码" />
                  </div>
                  <p>此签收码仅在这里显示一次。请立即保存，并通过安全渠道交给收货方。</p>
                </div>
              ) : null}
              <dl className="receipt-list">
                <div>
                  <dt>运单号</dt>
                  <dd className="mono">{receipt.data.trackingNumber}</dd>
                </div>
                <div>
                  <dt>系统记录编号</dt>
                  <dd className="mono hash-value">{receipt.transactionId}</dd>
                </div>
              </dl>
            </div>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <Button
            onClick={() => {
              if (!receipt) return;
              navigate(`/app/shipments/${receipt.data.id}`, {
                state: { receipt, deliveryCode: receipt.deliveryCode },
              });
            }}
          >
            查看运单详情
          </Button>
        </ModalFooter>
      </ComposedModal>
    </div>
  );
}
