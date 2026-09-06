import { useEffect, useState, type FormEvent } from 'react';
import { Button, TextInput, Toggle } from '@carbon/react';
import {
  readIntegrationSettings,
  saveIntegrationSettings,
  validTelemetryEndpoint,
  type IntegrationSettings,
} from '../lib/integration-settings';

export function IntegrationsPage() {
  const [settings, setSettings] = useState(readIntegrationSettings);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('尚未检测');
  useEffect(() => {
    if (!validTelemetryEndpoint(settings.telemetryEndpoint)) {
      setConnection('代理路径无效');
      return;
    }
    const controller = new AbortController();
    setConnection('检测中…');
    void fetch(`${settings.telemetryEndpoint}/health`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok || payload.ok !== true) throw new Error();
        setConnection('已连接控制塔服务');
      })
      .catch(() => {
        if (!controller.signal.aborted) setConnection('连接失败，请检查服务地址');
      });
    return () => controller.abort();
  }, [settings.telemetryEndpoint]);
  const save = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      saveIntegrationSettings(settings);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    }
  };
  const update = (key: keyof IntegrationSettings, value: boolean | string) => {
    setSaved(false);
    setSettings((current) => ({ ...current, [key]: value }));
  };
  const cards = [
    {
      key: 'gps' as const,
      name: 'GPS 轨迹',
      type: '位置数据',
      detail:
        '展示控制塔数据源提供的坐标；主运单详情可显示已固化的演示定位样例。当前尚未接入真实车辆设备。',
    },
    {
      key: 'temperature' as const,
      name: '温湿度监控',
      type: 'IoT 数据',
      detail: '展示 MySQL 中的温湿度读数和阈值；开启展示不会自动将读数上链。',
    },
    {
      key: 'map' as const,
      name: '地图与网点',
      type: 'GIS 服务',
      detail: '组合计划路线、运输网点和实际轨迹，展示责任段。',
    },
    {
      key: 'evidenceAnchor' as const,
      name: '证据摘要展示',
      type: 'Fabric 证据',
      detail: '展示已有事件的证据摘要。此开关不会触发上链，也不会删除已有证据。',
    },
  ];
  return (
    <div className="page integrations-page">
      <header className="page-header">
        <p className="eyebrow">系统设置</p>
        <h1>数据源与扩展</h1>
        <p>
          配置当前浏览器中的控制塔展示模块。保存后重新进入控制塔生效；不会停止后台采集。当前为内置扩展配置，尚不支持安装第三方插件。
        </p>
      </header>
      <form onSubmit={save}>
        <section className="integration-config">
          <TextInput
            id="telemetry-endpoint"
            labelText="控制塔数据服务"
            helperText="填写同源代理路径，例如 /lianyun-api；不保存数据库或 Fabric 密钥。"
            value={settings.telemetryEndpoint}
            onChange={(event) => update('telemetryEndpoint', event.target.value)}
          />
          <div>
            <strong>连接状态</strong>
            <span role="status">{connection}</span>
          </div>
        </section>
        <div className="integration-grid">
          {cards.map((card) => (
            <article key={card.key}>
              <div className="integration-card__heading">
                <div>
                  <span>{card.type}</span>
                  <h2>{card.name}</h2>
                </div>
                <Toggle
                  id={`toggle-${card.key}`}
                  hideLabel
                  labelText={card.name}
                  toggled={settings[card.key]}
                  onToggle={(value) => update(card.key, value)}
                />
              </div>
              <p>{card.detail}</p>
              <footer>
                <span>{settings[card.key] ? '已启用' : '已停用'}</span>
                <code>{card.key}</code>
              </footer>
            </article>
          ))}
        </div>
        <div className="integration-save">
          <Button type="submit">保存扩展设置</Button>
          {saved ? <span>设置已保存到当前浏览器</span> : null}
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </div>
  );
}
