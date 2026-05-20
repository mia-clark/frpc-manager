import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  Space,
  Tag,
  Typography,
  Switch,
  Select,
  Input,
  Button,
  Table,
  Empty,
  Tooltip,
  Drawer,
  Descriptions,
  Statistic,
  Row,
  Col,
  theme as antdTheme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ClearOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ExportOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useEventStream } from '../events/EventStreamContext';
import type { BusEvent, EventType } from '../events/types';

const { Title, Text } = Typography;

const TYPE_OPTIONS: { value: EventType; label: string; color: string }[] = [
  { value: 'instance.state', label: '实例状态', color: 'geekblue' },
  { value: 'instance.error', label: '实例错误', color: 'red' },
  { value: 'proxy.status', label: '隧道状态', color: 'cyan' },
  { value: 'proxy.connections', label: '隧道连接', color: 'purple' },
  { value: 'config.changed', label: '配置变更', color: 'gold' },
  { value: 'config.deleted', label: '配置删除', color: 'volcano' },
  { value: 'log.line', label: '日志行', color: 'default' },
];

const TYPE_META: Record<EventType, { label: string; color: string }> = TYPE_OPTIONS.reduce(
  (acc, o) => ({ ...acc, [o.value]: { label: o.label, color: o.color } }),
  {} as Record<EventType, { label: string; color: string }>
);

const MAX_BUFFER = 2000;

function fmtTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(
    d.getMilliseconds()
  ).padStart(3, '0')}`;
}

function summarize(e: BusEvent): string {
  const d = e.data as Record<string, unknown> | undefined;
  if (!d) return '';
  switch (e.type) {
    case 'instance.state':
      return `${d.prev_state ? d.prev_state + ' → ' : ''}${d.state}`;
    case 'instance.error':
      return String(d.message ?? '');
    case 'proxy.status':
      return `[${d.type}] ${d.name} → ${d.status}${d.error ? ' (' + d.error + ')' : ''}`;
    case 'proxy.connections':
      return `[${d.type}] ${d.name} 连接数=${d.cur_conns}`;
    case 'log.line':
      return String(d.line ?? '');
    default:
      return JSON.stringify(d);
  }
}

const Events: React.FC = () => {
  const { token } = antdTheme.useToken();
  const { subscribe, state: connState } = useEventStream();
  const [events, setEvents] = useState<BusEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [typeFilter, setTypeFilter] = useState<EventType[]>([]);
  const [keyword, setKeyword] = useState('');
  const [detail, setDetail] = useState<BusEvent | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const off = subscribe(null, (e) => {
      if (pausedRef.current) return;
      setEvents((prev) => {
        const next = prev.length >= MAX_BUFFER ? prev.slice(prev.length - MAX_BUFFER + 1) : prev.slice();
        next.push(e);
        return next;
      });
    });
    return off;
  }, [subscribe]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return events
      .filter((e) => (typeFilter.length === 0 ? true : typeFilter.includes(e.type)))
      .filter((e) => {
        if (!kw) return true;
        if (e.config_id?.toLowerCase().includes(kw)) return true;
        if (e.type.includes(kw)) return true;
        return JSON.stringify(e.data ?? '').toLowerCase().includes(kw);
      })
      .slice()
      .reverse();
  }, [events, typeFilter, keyword]);

  const stats = useMemo(() => {
    const out: Record<EventType, number> = {} as Record<EventType, number>;
    for (const o of TYPE_OPTIONS) out[o.value] = 0;
    for (const e of events) out[e.type] = (out[e.type] ?? 0) + 1;
    return out;
  }, [events]);

  const handleExport = () => {
    const blob = new Blob(
      [filtered.map((e) => JSON.stringify(e)).join('\n')],
      { type: 'application/x-ndjson' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `frp-events-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: ColumnsType<BusEvent> = [
    {
      title: '时间',
      dataIndex: 'ts',
      width: 130,
      render: (v: string) => (
        <Text style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }}>
          {fmtTs(v)}
        </Text>
      ),
    },
    {
      title: '#',
      dataIndex: 'seq',
      width: 78,
      render: (v: number) => <Text type="secondary" style={{ fontSize: 12 }}>#{v}</Text>,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 130,
      render: (t: EventType) => {
        const meta = TYPE_META[t];
        return <Tag color={meta?.color}>{meta?.label ?? t}</Tag>;
      },
    },
    {
      title: '实例',
      dataIndex: 'config_id',
      width: 200,
      ellipsis: true,
      render: (v?: string) =>
        v ? (
          <Tooltip title={v}>
            <Tag bordered={false} style={{ fontFamily: 'ui-monospace, monospace' }}>
              {v.slice(0, 8)}…
            </Tag>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '内容',
      dataIndex: 'data',
      render: (_: unknown, row) => (
        <Text style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{summarize(row)}</Text>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        styles={{ body: { padding: 18 } }}
        style={{ borderRadius: 10 }}
      >
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }} wrap>
            <Title level={4} style={{ margin: 0 }}>
              事件中心
            </Title>
            <Tag color={connState === 'open' ? 'success' : connState === 'connecting' ? 'warning' : 'error'}>
              {connState === 'open' ? '实时流接通' : connState === 'connecting' ? '连接中…' : '已断开'}
            </Tag>
          </Space>
          <Text type="secondary" style={{ fontSize: 13 }}>
            订阅来自后端 EventBus 的实时事件，最多缓存 {MAX_BUFFER} 条，支持类型过滤、关键字搜索和导出。
          </Text>
        </Space>
      </Card>

      <Row gutter={16}>
        {TYPE_OPTIONS.map((opt) => (
          <Col key={opt.value} xs={12} sm={8} md={6} lg={6} xl={3}>
            <Card size="small" styles={{ body: { padding: 12 } }} style={{ borderRadius: 8 }}>
              <Statistic
                title={<Tag color={opt.color} bordered={false}>{opt.label}</Tag>}
                value={stats[opt.value] ?? 0}
                valueStyle={{ fontSize: 18, color: token.colorText }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card styles={{ body: { padding: 14 } }} style={{ borderRadius: 10 }}>
        <Space wrap size="middle" style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap size="middle">
            <Select
              mode="multiple"
              allowClear
              style={{ minWidth: 240 }}
              placeholder="按类型筛选"
              value={typeFilter}
              onChange={setTypeFilter}
              options={TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              maxTagCount="responsive"
            />
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索 config_id / 内容…"
              style={{ width: 280 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </Space>
          <Space>
            <Switch
              checkedChildren={<><PauseCircleOutlined /> 暂停</>}
              unCheckedChildren={<><PlayCircleOutlined /> 实时</>}
              checked={paused}
              onChange={setPaused}
            />
            <Button icon={<ClearOutlined />} onClick={() => setEvents([])}>
              清空
            </Button>
            <Button icon={<ExportOutlined />} onClick={handleExport} disabled={filtered.length === 0}>
              导出
            </Button>
          </Space>
        </Space>
      </Card>

      <Card styles={{ body: { padding: 0 } }} style={{ borderRadius: 10 }}>
        <Table<BusEvent>
          size="small"
          rowKey="seq"
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200] }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={paused ? '已暂停接收' : '暂无事件，等待中…'}
              />
            ),
          }}
          onRow={(row) => ({
            onClick: () => setDetail(row),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>

      <Drawer
        title={detail ? <Tag color={TYPE_META[detail.type]?.color}>{TYPE_META[detail.type]?.label}</Tag> : '事件详情'}
        placement="right"
        width={560}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="seq">#{detail.seq}</Descriptions.Item>
              <Descriptions.Item label="类型">{detail.type}</Descriptions.Item>
              <Descriptions.Item label="时间">{new Date(detail.ts).toLocaleString()}</Descriptions.Item>
              {detail.config_id && (
                <Descriptions.Item label="实例">{detail.config_id}</Descriptions.Item>
              )}
            </Descriptions>
            <Card size="small" title="data" styles={{ body: { padding: 0 } }}>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  fontSize: 12,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  maxHeight: 480,
                  overflow: 'auto',
                  background: token.colorFillQuaternary,
                  borderRadius: 6,
                }}
              >
                {JSON.stringify(detail.data, null, 2)}
              </pre>
            </Card>
          </Space>
        )}
      </Drawer>
    </Space>
  );
};

export default Events;
