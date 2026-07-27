import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Button,
  Pagination,
  Search,
  Select,
  SelectItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from '@carbon/react';
import { Add, ArrowRight, Filter } from '@carbon/icons-react';
import { SHIPMENT_STATUSES, type Shipment, type ShipmentStatus } from '@jixin/shared';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorState, PageSkeleton } from '../components/PageState';
import { StatusTag } from '../components/StatusTag';
import { api, getErrorMessage } from '../lib/api';
import {
  ACTION_LABELS,
  STATUS_LABELS,
  formatDateTime,
  getAvailableActions,
  routeLabel,
} from '../lib/presentation';

const PAGE_SIZE = 20;

export function ShipmentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [total, setTotal] = useState(0);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ShipmentStatus | ''>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const filters: Parameters<typeof api.shipments.list>[0] = {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      };
      if (search) filters.search = search;
      if (status) filters.status = status;
      const { data } = await api.shipments.list(filters);
      setShipments(data.items);
      setTotal(data.total);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeFilterCount = Number(Boolean(search)) + Number(Boolean(status));

  const nextActions = useMemo(() => {
    const map = new Map<string, string>();
    if (!user) return map;
    shipments.forEach((shipment) => {
      const actions = getAvailableActions(user.role, shipment.status);
      map.set(shipment.id, actions.map((action) => ACTION_LABELS[action]).join('、'));
    });
    return map;
  }, [shipments, user]);

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  };

  const resetFilters = () => {
    setSearchDraft('');
    setSearch('');
    setStatus('');
    setPage(1);
  };

  return (
    <div className="page shipments-page">
      <header className="page-header page-header--with-action">
        <div>
          <p className="eyebrow">运输业务</p>
          <h1>运单管理</h1>
          <p>按运单号、货物或路线检索，并进入详情完成当前角色可执行的动作。</p>
        </div>
        {user?.role === 'shipper' ? (
          <Button renderIcon={Add} onClick={() => navigate('/app/shipments/new')}>
            创建运单
          </Button>
        ) : null}
      </header>

      <form className="filter-bar" onSubmit={handleSearch} aria-label="筛选运单">
        <Search
          id="shipment-search"
          labelText="搜索运单"
          placeholder="运单号、货物或城市"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.currentTarget.value)}
          closeButtonLabelText="清除搜索"
          onClear={() => {
            setSearchDraft('');
            setSearch('');
            setPage(1);
          }}
        />
        <Select
          id="shipment-status"
          labelText="运单状态"
          hideLabel
          value={status}
          onChange={(event) => {
            setStatus(event.currentTarget.value as ShipmentStatus | '');
            setPage(1);
          }}
        >
          <SelectItem value="" text="全部状态" />
          {SHIPMENT_STATUSES.map((value) => (
            <SelectItem key={value} value={value} text={STATUS_LABELS[value]} />
          ))}
        </Select>
        <Button type="submit" kind="secondary" renderIcon={Filter}>
          应用筛选
        </Button>
        {activeFilterCount ? (
          <Button type="button" kind="ghost" onClick={resetFilters}>
            清除筛选
          </Button>
        ) : null}
      </form>

      <div className="result-summary" aria-live="polite">
        <span>共 {total} 张运单</span>
        {activeFilterCount ? <Tag type="cool-gray">{activeFilterCount} 个筛选条件</Tag> : null}
      </div>

      {loading ? <PageSkeleton rows={4} /> : null}
      {!loading && error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && !shipments.length ? (
        <EmptyState
          title={activeFilterCount ? '没有匹配的运单' : '还没有运单'}
          description={
            activeFilterCount
              ? '调整运单号或状态条件后再次查询。'
              : user?.role === 'shipper'
                ? '创建第一张运单，开始可信物流流程。'
                : '当前账户暂时没有可查看的运单。'
          }
          action={
            activeFilterCount ? (
              <Button kind="tertiary" onClick={resetFilters}>
                清除筛选
              </Button>
            ) : user?.role === 'shipper' ? (
              <Button renderIcon={Add} onClick={() => navigate('/app/shipments/new')}>
                创建运单
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {!loading && !error && shipments.length ? (
        <>
          <div className="shipment-table-wrap">
            <TableContainer>
              <Table size="lg">
                <TableHead>
                  <TableRow>
                    <TableHeader>运单号</TableHeader>
                    <TableHeader>货物</TableHeader>
                    <TableHeader>运输路线</TableHeader>
                    <TableHeader>状态</TableHeader>
                    <TableHeader>最近更新</TableHeader>
                    <TableHeader>待执行</TableHeader>
                    <TableHeader aria-label="查看详情" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shipments.map((shipment) => (
                    <TableRow key={shipment.id}>
                      <TableCell className="mono">{shipment.trackingNumber}</TableCell>
                      <TableCell>
                        <strong>{shipment.goods.name}</strong>
                        <span className="table-secondary">{shipment.goods.quantity} 件</span>
                      </TableCell>
                      <TableCell>{routeLabel(shipment)}</TableCell>
                      <TableCell>
                        <StatusTag status={shipment.status} />
                      </TableCell>
                      <TableCell>{formatDateTime(shipment.updatedAt)}</TableCell>
                      <TableCell>{nextActions.get(shipment.id) || '查看记录'}</TableCell>
                      <TableCell>
                        <Button
                          kind="ghost"
                          size="sm"
                          renderIcon={ArrowRight}
                          onClick={() => navigate(`/app/shipments/${shipment.id}`)}
                        >
                          详情
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </div>

          <div className="shipment-mobile-list" aria-label="运单列表">
            {shipments.map((shipment) => (
              <article key={shipment.id} className="shipment-mobile-card">
                <div className="shipment-mobile-card__top">
                  <span className="mono">{shipment.trackingNumber}</span>
                  <StatusTag status={shipment.status} />
                </div>
                <h2>{shipment.goods.name}</h2>
                <p>{routeLabel(shipment)}</p>
                <dl>
                  <div>
                    <dt>最近更新</dt>
                    <dd>{formatDateTime(shipment.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>待执行</dt>
                    <dd>{nextActions.get(shipment.id) || '查看记录'}</dd>
                  </div>
                </dl>
                <Button
                  kind="tertiary"
                  size="sm"
                  renderIcon={ArrowRight}
                  onClick={() => navigate(`/app/shipments/${shipment.id}`)}
                >
                  查看详情
                </Button>
              </article>
            ))}
          </div>

          {total > PAGE_SIZE ? (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              pageSizes={[PAGE_SIZE]}
              totalItems={total}
              backwardText="上一页"
              forwardText="下一页"
              itemsPerPageText="每页数量"
              itemRangeText={(minimum, maximum, count) => `${minimum}-${maximum}，共 ${count} 项`}
              itemText={(minimum, maximum) => `${minimum}-${maximum} 项`}
              onChange={({ page: nextPage }) => setPage(nextPage)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
