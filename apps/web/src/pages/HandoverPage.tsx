import { useMemo, useState } from 'react';
import { Button, Select, SelectItem, Tag, TextInput } from '@carbon/react';
import { Renew } from '@carbon/icons-react';
import { controlTowerApi, type ControlTowerData } from '../lib/control-tower-api';
import { useControlTower } from '../lib/use-control-tower';

export function HandoverPage() {
  const [shipmentId, setShipmentId] = useState('YT20260001');
  const [handoverId, setHandoverId] = useState(() => `HO-${Date.now().toString(36).toUpperCase()}`);
  const [fromHub, setFromHub] = useState('HZ-HUB-01');
  const [toHub, setToHub] = useState('WH-HUB-01');
  const { data, error, loading, load } = useControlTower(shipmentId);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const records = useMemo(
    () => data?.shipment.events.filter((event) => event.type.startsWith('HANDOVER_')) ?? [],
    [data],
  );
  const units = useMemo(
    () =>
      (data?.shipment.parcels ?? []).reduce<
        Record<string, NonNullable<ControlTowerData['shipment']['parcels'][number]>[]>
      >((groups, parcel) => {
        const key = parcel.unitId || '未装箱';
        (groups[key] ??= []).push(parcel);
        return groups;
      }, {}),
    [data],
  );
  const submit = async (type: 'HANDOVER_INITIATED' | 'HANDOVER_CONFIRMED') => {
    if (loading || !data || data.shipment.id !== shipmentId.trim()) {
      setMessage('请先读取有效运单');
      return;
    }
    if (!handoverId.trim() || fromHub === toHub) {
      setMessage('请填写交接单号，并选择不同的移交和接收网点');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const receipt =
        type === 'HANDOVER_INITIATED'
          ? await controlTowerApi.initiateHandover(shipmentId, {
              handoverId,
              fromHub,
              toHub,
              carrierOrg: data?.shipment.carrierOrg || 'Org2MSP',
            })
          : await controlTowerApi.confirmHandover(handoverId);
      setMessage(
        type === 'HANDOVER_INITIATED'
          ? `Org1 已发起交接：${receipt.handoverId}`
          : `Org2 已确认接收：${receipt.confirmOrg ?? 'Org2MSP'}`,
      );
      await load();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : '链上提交失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page handover-page">
      <header className="page-header">
        <p className="eyebrow">多组织协同</p>
        <h1>交接与物流单元</h1>
        <p>发起方与接收方分别留下交易记录，结合箱/托盘关系界定责任边界。</p>
        <p>本机双组织演示：两个按钮分别调用 Org1 / Org2 服务身份；尚未隔离为企业独立登录权限。</p>
      </header>
      {error ? (
        <p className="tower-error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="handover-workbench">
        <div className="handover-form">
          <TextInput
            id="handover-shipment"
            labelText="运单号"
            value={shipmentId}
            onChange={(event) => setShipmentId(event.target.value)}
          />
          <TextInput
            id="handover-id"
            labelText="交接单号"
            value={handoverId}
            onChange={(event) => setHandoverId(event.target.value)}
          />
          <Select
            id="handover-from-hub"
            labelText="移交网点"
            value={fromHub}
            onChange={(event) => setFromHub(event.target.value)}
          >
            {(data?.hubs ?? []).map((hub) => (
              <SelectItem key={hub.code} value={hub.code} text={`${hub.name}（${hub.code}）`} />
            ))}
            {!data?.hubs.length ? <SelectItem value="HZ-HUB-01" text="杭州分拨中心" /> : null}
          </Select>
          <Select
            id="handover-to-hub"
            labelText="接收网点"
            value={toHub}
            onChange={(event) => setToHub(event.target.value)}
          >
            {(data?.hubs ?? []).map((hub) => (
              <SelectItem key={hub.code} value={hub.code} text={`${hub.name}（${hub.code}）`} />
            ))}
            {!data?.hubs.length ? <SelectItem value="WH-HUB-01" text="武汉中转中心" /> : null}
          </Select>
          <div className="handover-actions">
            <Button disabled={busy} onClick={() => void submit('HANDOVER_INITIATED')}>
              发起交接
            </Button>
            <Button
              kind="tertiary"
              disabled={busy}
              onClick={() => void submit('HANDOVER_CONFIRMED')}
            >
              确认接收
            </Button>
            <Button kind="ghost" renderIcon={Renew} onClick={() => void load()}>
              刷新
            </Button>
          </div>
          {message ? <p className="handover-message">{message}</p> : null}
        </div>
        <aside className="handover-explain">
          <span>为什么要两次交易？</span>
          <h2>交接不是单方修改状态</h2>
          <p>
            发起记录证明“谁在何处移交”，确认记录证明“谁接收并核验”。两次交易由 Fabric 保存交易
            ID、组织身份和时间顺序，后续异常可落到对应责任段。
          </p>
        </aside>
      </section>
      <div className="tower-grid">
        <section className="tower-panel">
          <header>
            <span>链上交接</span>
            <h2>交接记录</h2>
          </header>
          <ol className="evidence-timeline">
            {[...records]
              .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
              .map((record) => (
                <li key={record.id}>
                  <div>
                    <strong>
                      {record.type === 'HANDOVER_CONFIRMED' ? '接收方确认' : '发起方移交'}
                    </strong>
                    <Tag type={record.type === 'HANDOVER_CONFIRMED' ? 'green' : 'blue'}>
                      {record.type === 'HANDOVER_CONFIRMED' ? '已确认' : '已发起'}
                    </Tag>
                  </div>
                  <p>
                    {record.hubName || record.hubCode} · {record.actorOrg} · {record.actorName}
                  </p>
                  <code>{record.txId}</code>
                </li>
              ))}
            {!records.length ? <p className="tower-empty">暂无交接事件</p> : null}
          </ol>
        </section>
        <section className="tower-panel">
          <header>
            <span>装箱关系</span>
            <h2>当前物流单元</h2>
          </header>
          <div className="unit-groups">
            {Object.entries(units).map(([unit, parcels]) => (
              <article key={unit}>
                <div>
                  <strong>{unit}</strong>
                  <Tag type={unit === '未装箱' ? 'warm-gray' : 'green'}>{parcels.length} 件</Tag>
                </div>
                <p>{parcels.map((parcel) => parcel.id).join('、')}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
