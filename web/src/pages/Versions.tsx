import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Row,
  Col,
  Space,
  Typography,
  Button,
  Tag,
  Table,
  Tooltip,
  Select,
  Input,
  App,
  Alert,
  Empty,
  Skeleton,
  theme as antdTheme,
  Radio,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ReloadOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons';
import client from '../api/client';

const { Title, Text, Paragraph } = Typography;

interface MirrorPreset {
  name: string;
  url: string;
  note?: string;
}

interface PingItem {
  mirror: MirrorPreset;
  ok: boolean;
  latency_ms: number;
  status_code?: number;
  error?: string;
}

interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  content_type?: string;
}

interface Release {
  tag: string;
  name?: string;
  published_at: string;
  prerelease: boolean;
  asset: ReleaseAsset;
}

interface Installed {
  version: string;
  tag: string;
  path: string;
  size: number;
  installed_at: string;
}

const fmtBytes = (n: number): string => {
  if (!n || n <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
};

const fmtTime = (iso: string): string => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
};

const Versions: React.FC = () => {
  const { message, modal } = App.useApp();
  const { token } = antdTheme.useToken();

  // mirror state
  const [mirrors, setMirrors] = useState<MirrorPreset[]>([]);
  const [currentMirror, setCurrentMirror] = useState<string>('');
  const [customMirror, setCustomMirror] = useState<string>('');
  const [pingResults, setPingResults] = useState<PingItem[]>([]);
  const [pinging, setPinging] = useState(false);

  // version state
  const [available, setAvailable] = useState<Release[]>([]);
  const [availLoading, setAvailLoading] = useState(false);
  const [installed, setInstalled] = useState<Installed[]>([]);
  const [defaultVersion, setDefaultVersion] = useState<string>('');
  const [installedLoading, setInstalledLoading] = useState(false);
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});

  const installedSet = useMemo(() => new Set(installed.map((i) => i.version)), [installed]);

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = async () => {
    await Promise.all([loadMirrors(), loadAvailable(), loadInstalled()]);
  };

  const loadMirrors = async () => {
    try {
      const resp = await client.get('/api/v1/versions/mirror');
      setMirrors(resp.data?.presets ?? []);
      setCurrentMirror(resp.data?.current ?? '');
    } catch (err: any) {
      message.error('加载镜像列表失败: ' + (err.response?.data?.error?.message || err.message));
    }
  };

  const loadAvailable = async () => {
    setAvailLoading(true);
    try {
      const resp = await client.get('/api/v1/versions/available');
      setAvailable(resp.data?.items ?? []);
    } catch (err: any) {
      message.error('拉取 GitHub 版本列表失败，可能需要切换镜像: ' + (err.response?.data?.error?.message || err.message));
    } finally {
      setAvailLoading(false);
    }
  };

  const loadInstalled = async () => {
    setInstalledLoading(true);
    try {
      const resp = await client.get('/api/v1/versions/installed');
      setInstalled(resp.data?.items ?? []);
      setDefaultVersion(resp.data?.default ?? '');
    } catch (err: any) {
      message.error('加载已安装版本失败: ' + (err.response?.data?.error?.message || err.message));
    } finally {
      setInstalledLoading(false);
    }
  };

  const handlePing = async () => {
    setPinging(true);
    setPingResults([]);
    try {
      const resp = await client.post('/api/v1/versions/mirror/ping');
      setPingResults(resp.data?.items ?? []);
      const okCount = (resp.data?.items ?? []).filter((x: PingItem) => x.ok).length;
      message.success(`完成 ${resp.data?.items?.length ?? 0} 项联通性测试 · 成功 ${okCount} 项`);
    } catch (err: any) {
      message.error('测速失败: ' + (err.response?.data?.error?.message || err.message));
    } finally {
      setPinging(false);
    }
  };

  const handleMirrorChange = async (url: string) => {
    try {
      await client.put('/api/v1/versions/mirror', { url });
      setCurrentMirror(url);
      message.success('GitHub 镜像已切换');
    } catch (err: any) {
      message.error('切换失败: ' + (err.response?.data?.error?.message || err.message));
    }
  };

  const handleDownload = async (rel: Release) => {
    setDownloading((prev) => ({ ...prev, [rel.tag]: true }));
    try {
      await client.post('/api/v1/versions/download', { tag: rel.tag });
      message.success(`版本 ${rel.tag} 下载完成`);
      await loadInstalled();
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message;
      if (err.response?.status === 409) {
        message.warning(`${rel.tag} 已经安装`);
      } else {
        message.error('下载失败: ' + msg);
      }
    } finally {
      setDownloading((prev) => ({ ...prev, [rel.tag]: false }));
    }
  };

  const handleSetDefault = async (version: string) => {
    try {
      await client.put('/api/v1/versions/default', { version });
      setDefaultVersion(version);
      message.success(version ? `已切换默认版本：${version}` : '已恢复使用内置 frp 库');
    } catch (err: any) {
      message.error('切换失败: ' + (err.response?.data?.error?.message || err.message));
    }
  };

  const handleDelete = (inst: Installed) => {
    modal.confirm({
      title: `删除 frpc ${inst.version}？`,
      content: '删除后引用该版本的实例下次启动将报错。请先切换或清除引用。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await client.delete(`/api/v1/versions/${encodeURIComponent(inst.version)}`);
          message.success(`已删除 ${inst.version}`);
          await loadInstalled();
        } catch (err: any) {
          message.error('删除失败: ' + (err.response?.data?.error?.message || err.message));
        }
      },
    });
  };

  const availableColumns: ColumnsType<Release> = [
    {
      title: '版本',
      dataIndex: 'tag',
      width: 140,
      render: (tag: string, row) => (
        <Space size={6}>
          <Text strong>{tag}</Text>
          {row.prerelease && <Tag color="warning" bordered={false}>预发</Tag>}
          {installedSet.has(tag.replace(/^v/, '')) && <Tag color="success" bordered={false}>已下载</Tag>}
        </Space>
      ),
    },
    {
      title: '发布时间',
      dataIndex: 'published_at',
      width: 170,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{fmtTime(v)}</Text>,
    },
    {
      title: '适配本机的资源',
      render: (_, row) => row.asset?.name
        ? <Text type="secondary" style={{ fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{row.asset.name} · {fmtBytes(row.asset.size)}</Text>
        : <Tag color="default">本机平台无匹配资源</Tag>,
    },
    {
      title: '操作',
      width: 110,
      render: (_, row) => {
        const ver = row.tag.replace(/^v/, '');
        if (installedSet.has(ver)) {
          return <Tag icon={<CheckCircleOutlined />} color="success">已下载</Tag>;
        }
        return (
          <Button
            type="primary"
            size="small"
            icon={<CloudDownloadOutlined />}
            loading={!!downloading[row.tag]}
            disabled={!row.asset?.url}
            onClick={() => handleDownload(row)}
          >
            下载
          </Button>
        );
      },
    },
  ];

  const installedColumns: ColumnsType<Installed> = [
    {
      title: '版本',
      dataIndex: 'version',
      width: 140,
      render: (v: string) => {
        const isDefault = v === defaultVersion;
        return (
          <Space>
            <Text strong>{v}</Text>
            {isDefault && <Tag color="success" icon={<StarFilled />} bordered={false}>默认</Tag>}
          </Space>
        );
      },
    },
    {
      title: '上游 Tag',
      dataIndex: 'tag',
      width: 110,
      render: (t: string) => <Text type="secondary" style={{ fontSize: 12 }}>{t || '-'}</Text>,
    },
    {
      title: '安装时间',
      dataIndex: 'installed_at',
      width: 170,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{fmtTime(v)}</Text>,
    },
    {
      title: '体积',
      dataIndex: 'size',
      width: 90,
      render: (n: number) => <Text type="secondary" style={{ fontSize: 12 }}>{fmtBytes(n)}</Text>,
    },
    {
      title: '路径',
      dataIndex: 'path',
      ellipsis: true,
      render: (p: string) => <Text type="secondary" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }} title={p}>{p}</Text>,
    },
    {
      title: '操作',
      width: 200,
      render: (_, row) => (
        <Space size={4}>
          <Tooltip title="设为默认版本（新启动的实例会用它）">
            <Button
              size="small"
              type="text"
              icon={row.version === defaultVersion ? <StarFilled style={{ color: token.colorWarning }} /> : <StarOutlined />}
              onClick={() => handleSetDefault(row.version)}
              disabled={row.version === defaultVersion}
            >
              设为默认
            </Button>
          </Tooltip>
          <Tooltip title="从磁盘删除该版本">
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(row)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  const sortedPing = useMemo(() => {
    if (!pingResults.length) return [];
    return pingResults;
  }, [pingResults]);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card styles={{ body: { padding: 18 } }} style={{ borderRadius: 10 }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0 }}>
            <ThunderboltOutlined /> frpc 版本管理
          </Title>
          <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
            从 GitHub 下载多个 frpc 二进制版本，本地多版本共存；可切换默认版本，新启动的实例将使用它。
            空 / "in-process" 表示用内置嵌入的 frp 库（默认行为）。
          </Paragraph>
        </Space>
      </Card>

      {/* 镜像配置 + 测速 */}
      <Card
        title={<Space><GlobalOutlined /> GitHub 下载镜像</Space>}
        styles={{ body: { padding: 18 } }}
        style={{ borderRadius: 10 }}
        extra={
          <Button icon={<ThunderboltOutlined />} loading={pinging} onClick={handlePing}>
            一键测速
          </Button>
        }
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Radio.Group
            value={currentMirror}
            onChange={(e) => handleMirrorChange(e.target.value)}
            style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
          >
            {mirrors.map((m) => {
              const ping = pingResults.find((p) => p.mirror.url === m.url);
              return (
                <Radio.Button key={m.url || 'direct'} value={m.url} style={{ minWidth: 220 }}>
                  <Space>
                    <Text strong style={{ fontSize: 12 }}>{m.name}</Text>
                    {ping && (
                      ping.ok
                        ? <Tag color="success" bordered={false}>{ping.latency_ms}ms</Tag>
                        : <Tag color="error" bordered={false}>失败</Tag>
                    )}
                  </Space>
                  {m.note && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 11 }}>{m.note}</Text>
                    </div>
                  )}
                </Radio.Button>
              );
            })}
          </Radio.Group>

          <Space.Compact style={{ width: '100%' }}>
            <Input
              prefix={<GlobalOutlined />}
              placeholder="自定义镜像前缀，如 https://my-proxy.example.com/"
              value={customMirror}
              onChange={(e) => setCustomMirror(e.target.value)}
              onPressEnter={() => customMirror.trim() && handleMirrorChange(customMirror.trim())}
            />
            <Button
              type="primary"
              onClick={() => customMirror.trim() && handleMirrorChange(customMirror.trim())}
              disabled={!customMirror.trim()}
            >
              使用此自定义镜像
            </Button>
          </Space.Compact>

          {pingResults.length > 0 && (
            <Alert
              type="info"
              showIcon
              message={
                <Text style={{ fontSize: 12 }}>
                  最快可用：{sortedPing.find((p) => p.ok)?.mirror.name ?? '无'} · 已按延迟排序
                </Text>
              }
              style={{ marginTop: 4 }}
            />
          )}

          <Text type="secondary" style={{ fontSize: 12 }}>
            当前激活：<Text code>{currentMirror || '直连 GitHub'}</Text>
          </Text>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        {/* 已下载版本 */}
        <Col xs={24} xl={12}>
          <Card
            title={<Space><StarFilled style={{ color: token.colorWarning }} />已安装版本</Space>}
            styles={{ body: { padding: 0 } }}
            style={{ borderRadius: 10 }}
            extra={
              <Space>
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={loadInstalled}
                  loading={installedLoading}
                />
                <Select
                  size="small"
                  style={{ minWidth: 180 }}
                  value={defaultVersion || ''}
                  onChange={handleSetDefault}
                  options={[
                    { value: '', label: '内置嵌入版本 (默认)' },
                    ...installed.map((i) => ({ value: i.version, label: `frpc ${i.version}` })),
                  ]}
                />
              </Space>
            }
          >
            {installedLoading && installed.length === 0 ? (
              <div style={{ padding: 16 }}><Skeleton active /></div>
            ) : installed.length === 0 ? (
              <div style={{ padding: 24 }}>
                <Empty description="本地还没有 frpc 二进制。从右侧选一个版本下载吧。" />
              </div>
            ) : (
              <Table
                dataSource={installed}
                columns={installedColumns}
                rowKey="version"
                size="small"
                pagination={false}
              />
            )}
          </Card>
        </Col>

        {/* 可下载版本 */}
        <Col xs={24} xl={12}>
          <Card
            title={<Space><CloudDownloadOutlined />可下载版本（来自 GitHub）</Space>}
            styles={{ body: { padding: 0 } }}
            style={{ borderRadius: 10 }}
            extra={
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={loadAvailable}
                loading={availLoading}
              />
            }
          >
            {availLoading && available.length === 0 ? (
              <div style={{ padding: 16 }}><Skeleton active /></div>
            ) : (
              <Table
                dataSource={available}
                columns={availableColumns}
                rowKey="tag"
                size="small"
                pagination={{ pageSize: 20, showSizeChanger: false }}
              />
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  );
};

export default Versions;
