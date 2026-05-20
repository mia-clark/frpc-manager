import { useEffect, useState, useRef } from 'react';
import {
  Card, Row, Col, Button, Badge, Space, Typography, Popconfirm,
  Tabs, Form, Input, InputNumber, Switch, Table, Drawer, Modal,
  message, Tag, Tooltip, Empty, List, Skeleton, Radio, Select
} from 'antd';
import {
  PlayCircleOutlined,
  StopOutlined,
  ReloadOutlined,
  DeleteOutlined,
  CopyOutlined,
  EditOutlined,
  CodeOutlined,
  PlusOutlined,
  CheckCircleOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import client from '../api/client';

const { Title, Text } = Typography;

interface ConfigItem {
  id: string;
  name?: string;
  serverAddr?: string;
  serverPort?: number;
  state?: string; // started, stopped, starting, stopping, error
  manualStart?: boolean;
}

const Configs: React.FC = () => {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [activeConfigId, setActiveConfigId] = useState<string>('');
  const [statusLoading, setStatusLoading] = useState<Record<string, boolean>>({});

  // 选项卡状态
  const [activeTab, setActiveTab] = useState<string>('proxies');

  // 配置详情表单状态与数据
  const [detailConfig, setDetailConfig] = useState<any>(null);
  const [rawToml, setRawToml] = useState<string>('');
  const [tomlLoading, setTomlLoading] = useState<boolean>(false);

  // 代理列表状态
  const [proxies, setProxies] = useState<any[]>([]);
  const [proxiesLoading, setProxiesLoading] = useState<boolean>(false);
  const [proxyDrawerOpen, setProxyDrawerOpen] = useState<boolean>(false);
  const [editingProxy, setEditingProxy] = useState<any>(null);

  // 迷你日志状态
  const [miniLogs, setMiniLogs] = useState<string>('');
  const [logsLoading, setLogsLoading] = useState<boolean>(false);

  // 新建配置 Modal
  const [newConfigModalOpen, setNewConfigModalOpen] = useState<boolean>(false);

  const [form] = Form.useForm();
  const [proxyForm] = Form.useForm();
  const [newConfigForm] = Form.useForm();

  useEffect(() => {
    fetchConfigs();
  }, []);

  useEffect(() => {
    if (activeConfigId) {
      handleLoadConfigDetails(activeConfigId);
    }
  }, [activeConfigId, activeTab]);

  const fetchConfigs = async () => {
    try {
      const resp = await client.get('/api/v1/configs');
      if (resp.status === 200) {
        const items = resp.data?.items || resp.data || [];
        setConfigs(items);
        if (items.length > 0 && !activeConfigId) {
          setActiveConfigId(items[0].id);
        }
      }
    } catch (err) {
      message.error('无法获取配置列表');
    }
  };

  const fetchStatus = async (id: string) => {
    try {
      const resp = await client.get(`/api/v1/configs/${id}/status`);
      if (resp.status === 200) {
        const state = resp.data?.state || 'stopped';
        setConfigs(prev => prev.map(c => c.id === id ? { ...c, state: state } : c));
      }
    } catch (err) {
      // 忽略状态请求错误
    }
  };

  // 实时同步配置引用，规避 React 经典闭包陷阱
  const configsRef = useRef(configs);
  useEffect(() => {
    configsRef.current = configs;
  }, [configs]);

  // 轮询状态
  useEffect(() => {
    // 首次载入时，如果已有配置，立即刷新一次状态
    if (configsRef.current && configsRef.current.length > 0) {
      configsRef.current.forEach(c => {
        fetchStatus(c.id);
      });
    }

    // 启动定时器，每 4 秒轮询一次当前所有的实例状态
    const timer = setInterval(() => {
      if (configsRef.current && configsRef.current.length > 0) {
        configsRef.current.forEach(c => {
          fetchStatus(c.id);
        });
      }
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const handleStartInstance = async (id: string) => {
    setStatusLoading(prev => ({ ...prev, [id]: true }));
    try {
      await client.post(`/api/v1/configs/${id}/start`);
      message.success('启动指令已发送');
      fetchStatus(id);
    } catch (err: any) {
      message.error('启动失败: ' + (err.response?.data?.message || err.message));
    } finally {
      setStatusLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleStopInstance = async (id: string) => {
    setStatusLoading(prev => ({ ...prev, [id]: true }));
    try {
      await client.post(`/api/v1/configs/${id}/stop`);
      message.success('停止指令已发送');
      fetchStatus(id);
    } catch (err: any) {
      message.error('停止失败: ' + (err.response?.data?.message || err.message));
    } finally {
      setStatusLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleReloadInstance = async (id: string) => {
    setStatusLoading(prev => ({ ...prev, [id]: true }));
    try {
      await client.post(`/api/v1/configs/${id}/reload`);
      message.success('配置已重载');
    } catch (err: any) {
      message.error('重载失败: ' + (err.response?.data?.message || err.message));
    } finally {
      setStatusLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleDeleteConfig = async (id: string) => {
    try {
      await client.delete(`/api/v1/configs/${id}`);
      message.success('配置已删除');
      if (activeConfigId === id) {
        setActiveConfigId('');
      }
      fetchConfigs();
    } catch (err) {
      message.error('删除配置失败');
    }
  };

  const handleDuplicateConfig = async (id: string) => {
    const newId = `${id}_copy`;
    try {
      await client.post(`/api/v1/configs/${id}/duplicate`, { new_id: newId });
      message.success(`已复制为新配置: ${newId}`);
      fetchConfigs();
    } catch (err: any) {
      message.error('复制失败: ' + (err.response?.data?.message || err.message));
    }
  };

  // 根据当前 Tab 加载对应数据
  const handleLoadConfigDetails = async (id: string) => {
    if (activeTab === 'proxies') {
      loadProxies(id);
    } else if (activeTab === 'visual') {
      loadVisualConfig(id);
    } else if (activeTab === 'toml') {
      loadRawToml(id);
    } else if (activeTab === 'logs') {
      loadMiniLogs(id);
    }
  };

  // 加载代理列表
  const loadProxies = async (id: string) => {
    setProxiesLoading(true);
    try {
      const resp = await client.get(`/api/v1/configs/${id}/proxies`);
      if (resp.status === 200) {
        setProxies(resp.data?.items || resp.data || []);
      }
    } catch (err) {
      setProxies([]);
    } finally {
      setProxiesLoading(false);
    }
  };

  // 切换代理开关
  const handleToggleProxy = async (proxyName: string, enabled: boolean) => {
    try {
      await client.post(`/api/v1/configs/${activeConfigId}/proxies/${proxyName}/toggle`, { enabled });
      message.success(`${proxyName} 状态已更新`);
      loadProxies(activeConfigId);
    } catch (err) {
      message.error('修改代理状态失败');
    }
  };

  // 删除代理
  const handleDeleteProxy = async (proxyName: string) => {
    try {
      await client.delete(`/api/v1/configs/${activeConfigId}/proxies/${proxyName}`);
      message.success('代理规则已删除');
      loadProxies(activeConfigId);
    } catch (err) {
      message.error('删除代理失败');
    }
  };

  // 加载常规属性
  const loadVisualConfig = async (id: string) => {
    try {
      const resp = await client.get(`/api/v1/configs/${id}`);
      if (resp.status === 200) {
        const envelope = resp.data || {};
        setDetailConfig(envelope);
        const configData = envelope.config || {};
        // 回填表单
        form.setFieldsValue({
          name: configData.frpmgr?.name || '',
          user: configData.user || '',
          serverAddr: configData.serverAddr || '',
          serverPort: configData.serverPort || 7000,
          natHoleSTUNServer: configData.natHoleSTUNServer || '',
          manualStart: configData.frpmgr?.manualStart ?? false,
          autoDelete: configData.frpmgr?.autoDelete ?? false,
          // 认证
          authMethod: configData.auth?.method || 'token',
          authToken: configData.auth?.token || '',
          oidcClientId: configData.auth?.oidc?.clientId || '',
          oidcClientSecret: configData.auth?.oidc?.clientSecret || '',
          oidcAudience: configData.auth?.oidc?.audience || '',
          oidcScope: configData.auth?.oidc?.scope || '',
          oidcTokenEndpoint: configData.auth?.oidc?.tokenEndpointUrl || '',
          // 日志
          logLevel: configData.log?.level || 'info',
          logMaxDays: configData.log?.maxDays || 3,
          // 管理
          adminAddr: configData.webServer?.addr || '',
          adminPort: configData.webServer?.port || undefined,
          adminUser: configData.webServer?.user || '',
          adminPwd: configData.webServer?.password || '',
          assetsDir: configData.webServer?.assetsDir || '',
          pprofEnable: configData.webServer?.pprofEnable ?? false,
          // 连接与TLS
          protocol: configData.transport?.protocol || 'tcp',
          dialServerTimeout: configData.transport?.dialServerTimeout || undefined,
          dialServerKeepAlive: configData.transport?.dialServerKeepAlive || undefined,
          poolCount: configData.transport?.poolCount || undefined,
          tcpMux: configData.transport?.tcpMux ?? true,
          heartbeatInterval: configData.transport?.heartbeatInterval || undefined,
          heartbeatTimeout: configData.transport?.heartbeatTimeout || undefined,
          tlsEnable: configData.transport?.tls?.enable ?? false,
          disableCustomTLSFirstByte: configData.transport?.tls?.disableCustomTLSFirstByte ?? false,
          tlsCertFile: configData.transport?.tls?.certFile || '',
          tlsKeyFile: configData.transport?.tls?.keyFile || '',
          tlsTrustedCaFile: configData.transport?.tls?.trustedCaFile || '',
          tlsServerName: configData.transport?.tls?.serverName || '',
        });
      }
    } catch (err) {
      message.error('获取配置详情失败');
    }
  };

  // 加载 TOML 源码
  const loadRawToml = async (id: string) => {
    setTomlLoading(true);
    try {
      const resp = await client.get(`/api/v1/configs/${id}/raw`);
      if (resp.status === 200) {
        setRawToml(resp.data || '');
      }
    } catch (err) {
      setRawToml('');
    } finally {
      setTomlLoading(false);
    }
  };

  // 加载近 200 行日志
  const loadMiniLogs = async (id: string) => {
    setLogsLoading(true);
    try {
      const resp = await client.get(`/api/v1/configs/${id}/logs?lines=200`);
      if (resp.status === 200) {
        // 部分接口返回对象，部分直接返回 text 数组。后端 /logs 返回 JSON
        const logsData = resp.data;
        if (logsData && Array.isArray(logsData.lines)) {
          setMiniLogs(logsData.lines.join('\n'));
        } else if (Array.isArray(logsData)) {
          setMiniLogs(logsData.join('\n'));
        } else {
          setMiniLogs(JSON.stringify(logsData));
        }
      }
    } catch (err) {
      setMiniLogs('无法加载日志，可能实例尚未启动过。');
    } finally {
      setLogsLoading(false);
    }
  };

  // 保存可视化配置
  const handleSaveVisualConfig = async (values: any) => {
    try {
      const payload = {
        config: {
          ...detailConfig?.config,
          user: values.user || undefined,
          serverAddr: values.serverAddr,
          serverPort: values.serverPort,
          natHoleSTUNServer: values.natHoleSTUNServer || undefined,
          auth: {
            method: values.authMethod,
            token: values.authMethod === 'token' ? values.authToken : undefined,
            oidc: values.authMethod === 'oidc' ? {
              clientId: values.oidcClientId || undefined,
              clientSecret: values.oidcClientSecret || undefined,
              audience: values.oidcAudience || undefined,
              scope: values.oidcScope || undefined,
              tokenEndpointUrl: values.oidcTokenEndpoint || undefined,
            } : undefined,
          },
          log: {
            level: values.logLevel,
            maxDays: values.logMaxDays || 3,
          },
          webServer: {
            addr: values.adminAddr || undefined,
            port: values.adminPort || undefined,
            user: values.adminUser || undefined,
            password: values.adminPwd || undefined,
            assetsDir: values.assetsDir || undefined,
            pprofEnable: values.pprofEnable ?? false,
          },
          transport: {
            protocol: values.protocol,
            dialServerTimeout: values.dialServerTimeout || undefined,
            dialServerKeepAlive: values.dialServerKeepAlive || undefined,
            poolCount: values.poolCount || undefined,
            tcpMux: values.tcpMux ?? true,
            heartbeatInterval: values.heartbeatInterval || undefined,
            heartbeatTimeout: values.heartbeatTimeout || undefined,
            tls: {
              enable: values.tlsEnable ?? false,
              disableCustomTLSFirstByte: values.disableCustomTLSFirstByte ?? false,
              certFile: values.tlsCertFile || undefined,
              keyFile: values.tlsKeyFile || undefined,
              trustedCaFile: values.tlsTrustedCaFile || undefined,
              serverName: values.tlsServerName || undefined,
            }
          },
          frpmgr: {
            name: values.name,
            manualStart: values.manualStart,
            autoDelete: values.autoDelete,
          }
        }
      };
      await client.put(`/api/v1/configs/${activeConfigId}`, payload);
      message.success('配置保存成功！');
      fetchConfigs();
    } catch (err) {
      message.error('保存失败');
    }
  };

  // 校验并保存 Raw TOML
  const handleSaveRawToml = async () => {
    setTomlLoading(true);
    try {
      // 语法校验
      const valResp = await client.post('/api/v1/validate', rawToml, {
        headers: { 'Content-Type': 'application/toml' }
      });
      if (valResp.status === 200) {
        // 校验通过，直接保存
        await client.put(`/api/v1/configs/${activeConfigId}/raw`, rawToml, {
          headers: { 'Content-Type': 'application/toml' }
        });
        message.success('TOML 校验并保存成功！');
        fetchConfigs();
      }
    } catch (err: any) {
      message.error('保存失败: ' + (err.response?.data?.message || 'TOML 语法校验未通过'));
    } finally {
      setTomlLoading(false);
    }
  };

  // 新建配置
  const handleCreateConfig = async (values: any) => {
    try {
      const payload = {
        id: values.id,
        config: {
          serverAddr: values.serverAddr || '127.0.0.1',
          serverPort: values.serverPort || 7000,
          auth: {
            method: 'token',
            token: values.token || '',
          },
          frpmgr: {
            name: values.name || values.id,
            manualStart: false,
          }
        }
      };
      await client.post('/api/v1/configs', payload);
      message.success('配置创建成功');
      setNewConfigModalOpen(false);
      newConfigForm.resetFields();
      setActiveConfigId(values.id);
      fetchConfigs();
    } catch (err: any) {
      message.error('创建失败: ' + (err.response?.data?.message || err.message));
    }
  };

  // 提交代理配置 Drawer 表单
  const handleSaveProxy = async (values: any) => {
    try {
      const splitCSV = (v?: string): string[] | undefined =>
        v ? v.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
      const payload: Record<string, unknown> = {
        name: values.name,
        type: values.type,
        localIP: values.localIP || '127.0.0.1',
        localPort: values.localPort,
      };
      const t = values.type as string;
      // 通用 / TCP / UDP
      if (t === 'tcp' || t === 'udp') {
        payload.remotePort = values.remotePort;
      }
      // tcpmux：基于域名复用
      if (t === 'tcpmux') {
        payload.multiplexer = values.multiplexer || 'httpconnect';
        payload.customDomains = splitCSV(values.customDomains);
        if (values.routeByHTTPUser) payload.routeByHTTPUser = values.routeByHTTPUser;
      }
      // HTTP / HTTPS
      if (t === 'http' || t === 'https') {
        payload.customDomains = splitCSV(values.customDomains);
        if (values.subdomain) payload.subdomain = values.subdomain;
        if (values.locations) payload.locations = splitCSV(values.locations);
        if (values.hostHeaderRewrite) payload.hostHeaderRewrite = values.hostHeaderRewrite;
        if (values.httpUser) payload.httpUser = values.httpUser;
        if (values.httpPassword) payload.httpPassword = values.httpPassword;
      }
      // STCP / SUDP / XTCP：安全/直连模式
      if (t === 'stcp' || t === 'sudp' || t === 'xtcp') {
        payload.secretKey = values.secretKey;
        if (values.allowUsers) payload.allowUsers = splitCSV(values.allowUsers);
      }
      // 插件透传
      if (values.pluginName) {
        const plugin: Record<string, unknown> = { type: values.pluginName };
        if (values.pluginLocalAddr) plugin.localAddr = values.pluginLocalAddr;
        if (values.pluginLocalPath) plugin.localPath = values.pluginLocalPath;
        if (values.pluginHTTPUser) plugin.httpUser = values.pluginHTTPUser;
        if (values.pluginHTTPPassword) plugin.httpPassword = values.pluginHTTPPassword;
        payload.plugin = plugin;
      }
      if (editingProxy) {
        // 修改代理
        await client.put(`/api/v1/configs/${activeConfigId}/proxies/${editingProxy.name}`, payload);
        message.success('代理规则修改成功');
      } else {
        // 新建代理
        await client.post(`/api/v1/configs/${activeConfigId}/proxies`, payload);
        message.success('代理规则创建成功');
      }
      setProxyDrawerOpen(false);
      loadProxies(activeConfigId);
    } catch (err: any) {
      message.error('操作失败: ' + (err.response?.data?.message || err.message));
    }
  };

  // 开启代理 Drawer
  const openProxyDrawer = (proxyItem?: any) => {
    setEditingProxy(proxyItem);
    if (proxyItem) {
      const pl = proxyItem.plugin || {};
      proxyForm.setFieldsValue({
        name: proxyItem.name,
        type: proxyItem.type || 'tcp',
        localIP: proxyItem.localIP || '127.0.0.1',
        localPort: proxyItem.localPort,
        remotePort: proxyItem.remotePort,
        customDomains: proxyItem.customDomains ? proxyItem.customDomains.join(',') : '',
        subdomain: proxyItem.subdomain,
        locations: proxyItem.locations ? proxyItem.locations.join(',') : '',
        hostHeaderRewrite: proxyItem.hostHeaderRewrite,
        httpUser: proxyItem.httpUser,
        httpPassword: proxyItem.httpPassword,
        multiplexer: proxyItem.multiplexer,
        routeByHTTPUser: proxyItem.routeByHTTPUser,
        secretKey: proxyItem.secretKey,
        allowUsers: proxyItem.allowUsers ? proxyItem.allowUsers.join(',') : '',
        pluginName: pl.type,
        pluginLocalAddr: pl.localAddr,
        pluginLocalPath: pl.localPath,
        pluginHTTPUser: pl.httpUser,
        pluginHTTPPassword: pl.httpPassword,
      });
    } else {
      proxyForm.resetFields();
      proxyForm.setFieldsValue({ type: 'tcp', localIP: '127.0.0.1' });
    }
    setProxyDrawerOpen(true);
  };

  const getStatusBadge = (state?: string) => {
    switch (state) {
      case 'started':
        return <Badge status="success" text={<span style={{ color: '#52c41a' }}>正在运行</span>} />;
      case 'error':
        return <Badge status="error" text={<span style={{ color: '#ff4d4f' }}>错误异常</span>} />;
      case 'starting':
        return <Badge status="processing" text={<span style={{ color: '#1677ff' }}>启动中</span>} />;
      case 'stopping':
        return <Badge status="processing" text={<span style={{ color: '#faad14' }}>停止中</span>} />;
      default:
        return <Badge status="default" text={<span style={{ color: 'rgba(255,255,255,0.45)' }}>未启动</span>} />;
    }
  };

  return (
    <div style={{ height: '100%' }}>
      <Row gutter={16} style={{ height: '100%', minHeight: '580px' }}>
        {/* 左栏：实例卡片列表 */}
        <Col xs={24} md={8} style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: '16px' }}>
            <Title level={4} style={{ color: '#fff', margin: 0 }}>配置列表</Title>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setNewConfigModalOpen(true)}
              style={{
                background: 'linear-gradient(135deg, #1677ff 0%, #0050b3 100%)',
                border: 'none',
                marginLeft: 'auto'
              }}
            >
              新建配置
            </Button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
            {configs.length === 0 ? (
              <Card className="glass-card" bordered={false} style={{ textAlign: 'center', padding: '40px 0' }}>
                <Empty description={<span style={{ color: 'rgba(255,255,255,0.45)' }}>暂无配置文件，点击右上角创建。</span>} />
              </Card>
            ) : (
              <List
                dataSource={configs}
                renderItem={(item) => {
                  const isActive = item.id === activeConfigId;
                  const isRunning = item.state === 'started';
                  return (
                    <Card
                      className="glass-card"
                      bordered={false}
                      style={{
                        marginBottom: '12px',
                        cursor: 'pointer',
                        border: isActive ? '1px solid #1677ff' : '1px solid rgba(255, 255, 255, 0.05)',
                        background: isActive ? 'rgba(22, 119, 255, 0.08)' : 'rgba(20, 24, 30, 0.65)',
                        boxShadow: isActive ? '0 0 15px rgba(22,119,255,0.15)' : 'none',
                      }}
                      onClick={() => setActiveConfigId(item.id)}
                      bodyStyle={{ padding: '16px' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                        <div>
                          <Text strong style={{ color: '#fff', fontSize: '15px' }}>{item.name || item.id}</Text>
                          <div><Text type="secondary" style={{ fontSize: '12px' }}>ID: {item.id}</Text></div>
                        </div>
                        {getStatusBadge(item.state)}
                      </div>

                      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', margin: '8px 0' }} />

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Space>
                          {isRunning ? (
                            <Button
                              type="primary"
                              danger
                              size="small"
                              icon={<StopOutlined />}
                              onClick={(e) => { e.stopPropagation(); handleStopInstance(item.id); }}
                              loading={statusLoading[item.id]}
                            >
                              停止
                            </Button>
                          ) : (
                            <Button
                              type="primary"
                              size="small"
                              icon={<PlayCircleOutlined />}
                              onClick={(e) => { e.stopPropagation(); handleStartInstance(item.id); }}
                              loading={statusLoading[item.id]}
                              style={{ background: '#52c41a', borderColor: '#52c41a' }}
                            >
                              启动
                            </Button>
                          )}
                          {isRunning && (
                            <Button
                              size="small"
                              icon={<ReloadOutlined />}
                              onClick={(e) => { e.stopPropagation(); handleReloadInstance(item.id); }}
                              loading={statusLoading[item.id]}
                            />
                          )}
                        </Space>

                        <Space>
                          <Tooltip title="克隆配置">
                            <Button
                              size="small"
                              type="text"
                              style={{ color: 'rgba(255,255,255,0.45)' }}
                              icon={<CopyOutlined />}
                              onClick={(e) => { e.stopPropagation(); handleDuplicateConfig(item.id); }}
                            />
                          </Tooltip>
                          <Popconfirm
                            title="确定要删除这个配置文件吗？"
                            description="删除后相关代理设置将一并抹去且无法恢复。"
                            onConfirm={() => handleDeleteConfig(item.id)}
                            onPopupClick={(e) => e.stopPropagation()}
                            okText="确定"
                            cancelText="取消"
                          >
                            <Button
                              size="small"
                              type="text"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </Popconfirm>
                        </Space>
                      </div>
                    </Card>
                  );
                }}
              />
            )}
          </div>
        </Col>

        {/* 右栏：工作台面板 */}
        <Col xs={24} md={16}>
          {activeConfigId ? (
            <Card
              className="glass-card"
              bordered={false}
              bodyStyle={{ padding: '20px' }}
              style={{ height: '100%', minHeight: '520px', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Text type="secondary" style={{ fontSize: '12px' }}>当前操作实例</Text>
                  <Title level={4} style={{ color: '#fff', margin: '4px 0 0 0' }}>
                    {configs.find(c => c.id === activeConfigId)?.name || activeConfigId}
                  </Title>
                </div>
                <div>
                  {getStatusBadge(configs.find(c => c.id === activeConfigId)?.state)}
                </div>
              </div>

              <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                  {
                    key: 'proxies',
                    label: <Space><ThunderboltOutlined />代理穿透规则</Space>,
                    children: (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                          <Text type="secondary">内网代理配置规则，用于将本地端口穿透至公网服务器。</Text>
                          <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            size="small"
                            onClick={() => openProxyDrawer()}
                          >
                            添加规则
                          </Button>
                        </div>
                        <Table
                          dataSource={proxies}
                          loading={proxiesLoading}
                          rowKey="name"
                          size="small"
                          pagination={false}
                          style={{ background: 'transparent' }}
                          className="custom-table"
                          columns={[
                            {
                              title: '代理名称',
                              dataIndex: 'name',
                              render: (_, record) => <Text style={{ color: '#fff' }}>{record.name}</Text>
                            },
                            {
                              title: '类型',
                              dataIndex: 'type',
                              render: (type) => <Tag color={type === 'http' || type === 'https' ? 'blue' : 'orange'}>{type?.toUpperCase()}</Tag>
                            },
                            {
                              title: '本地地址',
                              render: (_, record) => <Text style={{ color: 'rgba(255,255,255,0.65)' }}>{record.localIP}:{record.localPort}</Text>
                            },
                            {
                              title: '公网代理端口',
                              dataIndex: 'remotePort',
                              render: (port, record) => {
                                if (record.type === 'http' || record.type === 'https') {
                                  return <Text type="secondary">{record.customDomains?.join(', ') || '自定义域名'}</Text>;
                                }
                                return <Text style={{ color: '#fff' }}>{port || '-'}</Text>;
                              }
                            },
                            {
                              title: '状态',
                              dataIndex: 'status',
                              render: (_, record) => {
                                return (
                                  <Switch
                                    checked={record.status !== 'disabled'}
                                    size="small"
                                    onChange={(checked) => handleToggleProxy(record.name, checked)}
                                  />
                                );
                              }
                            },
                            {
                              title: '操作',
                              render: (_, record) => (
                                <Space>
                                  <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openProxyDrawer(record)} />
                                  <Popconfirm
                                    title="确定删除此代理规则？"
                                    onConfirm={() => handleDeleteProxy(record.name)}
                                    okText="删除"
                                    cancelText="取消"
                                  >
                                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                                  </Popconfirm>
                                </Space>
                              )
                            }
                          ]}
                        />
                      </div>
                    )
                  },
                  {
                    key: 'visual',
                    label: <Space><EditOutlined />常规配置 (可视化)</Space>,
                    children: (
                      <Form
                        form={form}
                        layout="vertical"
                        onFinish={handleSaveVisualConfig}
                        style={{ maxWidth: '800px', marginTop: '12px' }}
                      >
                        <Tabs
                          type="line"
                          size="small"
                          tabBarStyle={{ marginBottom: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}
                          items={[
                            {
                              key: 'basic',
                              label: '基本',
                              children: (
                                <div>
                                  <Row gutter={16}>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>实例备注名</span>} name="name">
                                        <Input placeholder="例如: 杭州云服务器" />
                                      </Form.Item>
                                    </Col>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>用户名 (User)</span>} name="user">
                                        <Input placeholder="可作为代理名前缀标识，例如: hlj-win-221" />
                                      </Form.Item>
                                    </Col>
                                  </Row>
                                  <Row gutter={16}>
                                    <Col span={16}>
                                      <Form.Item
                                        label={<span style={{ color: '#fff' }}>FRP 服务端公网地址 (server_addr)</span>}
                                        name="serverAddr"
                                        rules={[{ required: true, message: '请输入 FRP 服务端地址' }]}
                                      >
                                        <Input placeholder="x.x.x.x 或 domain.com" />
                                      </Form.Item>
                                    </Col>
                                    <Col span={8}>
                                      <Form.Item
                                        label={<span style={{ color: '#fff' }}>服务端端口 (server_port)</span>}
                                        name="serverPort"
                                        rules={[{ required: true, message: '必填' }]}
                                      >
                                        <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                                      </Form.Item>
                                    </Col>
                                  </Row>
                                  <Row gutter={16}>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>随系统服务自动启动</span>} name="manualStart" valuePropName="checked">
                                        <Switch checkedChildren="随服务启动" unCheckedChildren="手动启动" />
                                      </Form.Item>
                                    </Col>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>STUN 服务地址</span>} name="natHoleSTUNServer">
                                        <Input placeholder="用于 Nat 穿透，例如: stun.easyvoip.com:3478" />
                                      </Form.Item>
                                    </Col>
                                  </Row>
                                </div>
                              )
                            },
                            {
                              key: 'auth',
                              label: '认证',
                              children: (
                                <div>
                                  <Form.Item label={<span style={{ color: '#fff' }}>认证方式</span>} name="authMethod">
                                    <Radio.Group buttonStyle="solid">
                                      <Radio.Button value="token">Token 认证</Radio.Button>
                                      <Radio.Button value="oidc">OIDC 认证</Radio.Button>
                                      <Radio.Button value="">无</Radio.Button>
                                    </Radio.Group>
                                  </Form.Item>

                                  <Form.Item
                                    noStyle
                                    shouldUpdate={(prevValues, currentValues) => prevValues.authMethod !== currentValues.authMethod}
                                  >
                                    {({ getFieldValue }) => {
                                      const authMethod = getFieldValue('authMethod');
                                      if (authMethod === 'token') {
                                        return (
                                          <Form.Item
                                            label={<span style={{ color: '#fff' }}>Token 密钥 (auth.token)</span>}
                                            name="authToken"
                                            rules={[{ required: true, message: '请输入 Token 密钥' }]}
                                          >
                                            <Input.Password placeholder="FRP Server 对应的连接密钥" />
                                          </Form.Item>
                                        );
                                      }
                                      if (authMethod === 'oidc') {
                                        return (
                                          <div>
                                            <Row gutter={16}>
                                              <Col span={12}>
                                                <Form.Item label={<span style={{ color: '#fff' }}>OIDC 客户端 ID</span>} name="oidcClientId">
                                                  <Input placeholder="clientId" />
                                                </Form.Item>
                                              </Col>
                                              <Col span={12}>
                                                <Form.Item label={<span style={{ color: '#fff' }}>OIDC 客户端密钥</span>} name="oidcClientSecret">
                                                  <Input.Password placeholder="clientSecret" />
                                                </Form.Item>
                                              </Col>
                                            </Row>
                                            <Row gutter={16}>
                                              <Col span={12}>
                                                <Form.Item label={<span style={{ color: '#fff' }}>受众 (Audience)</span>} name="oidcAudience">
                                                  <Input placeholder="audience" />
                                                </Form.Item>
                                              </Col>
                                              <Col span={12}>
                                                <Form.Item label={<span style={{ color: '#fff' }}>作用域 (Scope)</span>} name="oidcScope">
                                                  <Input placeholder="scope" />
                                                </Form.Item>
                                              </Col>
                                            </Row>
                                            <Form.Item label={<span style={{ color: '#fff' }}>Token 端点 URL</span>} name="oidcTokenEndpoint">
                                              <Input placeholder="https://oauth2.example.com/token" />
                                            </Form.Item>
                                          </div>
                                        );
                                      }
                                      return null;
                                    }}
                                  </Form.Item>
                                </div>
                              )
                            },
                            {
                              key: 'log',
                              label: '日志',
                              children: (
                                <Row gutter={16}>
                                  <Col span={12}>
                                    <Form.Item label={<span style={{ color: '#fff' }}>日志级别 (log.level)</span>} name="logLevel">
                                      <Select dropdownStyle={{ background: '#1f1f1f' }}>
                                        <Select.Option value="trace">trace (最详细)</Select.Option>
                                        <Select.Option value="debug">debug (调试)</Select.Option>
                                        <Select.Option value="info">info (常规信息)</Select.Option>
                                        <Select.Option value="warn">warn (警告)</Select.Option>
                                        <Select.Option value="error">error (错误)</Select.Option>
                                      </Select>
                                    </Form.Item>
                                  </Col>
                                  <Col span={12}>
                                    <Form.Item label={<span style={{ color: '#fff' }}>日志保留天数 (log.max_days)</span>} name="logMaxDays">
                                      <InputNumber min={1} max={90} style={{ width: '100%' }} />
                                    </Form.Item>
                                  </Col>
                                </Row>
                              )
                            },
                            {
                              key: 'admin',
                              label: '管理',
                              children: (
                                <div>
                                  <Row gutter={16}>
                                    <Col span={16}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>管理 HTTP 监听地址 (webServer.addr)</span>} name="adminAddr">
                                        <Input placeholder="127.0.0.1" />
                                      </Form.Item>
                                    </Col>
                                    <Col span={8}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>管理端口</span>} name="adminPort">
                                        <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="7400" />
                                      </Form.Item>
                                    </Col>
                                  </Row>
                                  <Row gutter={16}>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>管理用户名</span>} name="adminUser">
                                        <Input placeholder="admin" />
                                      </Form.Item>
                                    </Col>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>管理密码</span>} name="adminPwd">
                                        <Input.Password placeholder="admin" />
                                      </Form.Item>
                                    </Col>
                                  </Row>
                                  <Row gutter={16}>
                                    <Col span={16}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>管理后台静态资源目录</span>} name="assetsDir">
                                        <Input placeholder="填入本地静态网页路径可托管仪表盘" />
                                      </Form.Item>
                                    </Col>
                                    <Col span={8}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>Pprof 调试服务</span>} name="pprofEnable" valuePropName="checked">
                                        <Switch checkedChildren="已开启" unCheckedChildren="关闭" />
                                      </Form.Item>
                                    </Col>
                                  </Row>
                                </div>
                              )
                            },
                            {
                              key: 'transport',
                              label: '连接/TLS',
                              children: (
                                <div>
                                  <Row gutter={16}>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>传输层协议 (transport.protocol)</span>} name="protocol">
                                        <Select dropdownStyle={{ background: '#1f1f1f' }}>
                                          <Select.Option value="tcp">TCP 协议 (默认)</Select.Option>
                                          <Select.Option value="kcp">KCP 协议 (UDP加速)</Select.Option>
                                          <Select.Option value="quic">QUIC 协议</Select.Option>
                                          <Select.Option value="websocket">Websocket 协议</Select.Option>
                                          <Select.Option value="wss">WSS 安全网页套接字</Select.Option>
                                        </Select>
                                      </Form.Item>
                                    </Col>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>连接超时时间 (秒)</span>} name="dialServerTimeout">
                                        <InputNumber min={1} style={{ width: '100%' }} />
                                      </Form.Item>
                                    </Col>
                                  </Row>
                                  <Row gutter={16}>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>保活心跳间隔 (秒)</span>} name="heartbeatInterval">
                                        <InputNumber min={1} style={{ width: '100%' }} />
                                      </Form.Item>
                                    </Col>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>心跳超时阈值 (秒)</span>} name="heartbeatTimeout">
                                        <InputNumber min={1} style={{ width: '100%' }} />
                                      </Form.Item>
                                    </Col>
                                  </Row>
                                  <Row gutter={16}>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>连接池初始数量 (pool_count)</span>} name="poolCount">
                                        <InputNumber min={0} max={100} style={{ width: '100%' }} />
                                      </Form.Item>
                                    </Col>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>多路复用 (TCP Mux)</span>} name="tcpMux" valuePropName="checked">
                                        <Switch checkedChildren="已启用" unCheckedChildren="禁用" />
                                      </Form.Item>
                                    </Col>
                                  </Row>

                                  <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', margin: '16px 0 12px 0', paddingTop: '12px' }}>
                                    <Text strong style={{ color: '#fff', fontSize: '13px' }}>FRP TLS 安全通讯</Text>
                                  </div>

                                  <Row gutter={16}>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>强制启用 TLS 传输加密</span>} name="tlsEnable" valuePropName="checked">
                                        <Switch checkedChildren="已开启" unCheckedChildren="未启用" />
                                      </Form.Item>
                                    </Col>
                                    <Col span={12}>
                                      <Form.Item label={<span style={{ color: '#fff' }}>禁用 TLS 首字节校验</span>} name="disableCustomTLSFirstByte" valuePropName="checked">
                                        <Switch checkedChildren="已禁用" unCheckedChildren="校验首字节" />
                                      </Form.Item>
                                    </Col>
                                  </Row>

                                  <Form.Item
                                    noStyle
                                    shouldUpdate={(prevValues, currentValues) => prevValues.tlsEnable !== currentValues.tlsEnable}
                                  >
                                    {({ getFieldValue }) => {
                                      if (getFieldValue('tlsEnable')) {
                                        return (
                                          <div>
                                            <Row gutter={16}>
                                              <Col span={12}>
                                                <Form.Item label={<span style={{ color: '#fff' }}>客户端证书文件路径</span>} name="tlsCertFile">
                                                  <Input placeholder="C:\certs\client.crt" />
                                                </Form.Item>
                                              </Col>
                                              <Col span={12}>
                                                <Form.Item label={<span style={{ color: '#fff' }}>客户端私钥文件路径</span>} name="tlsKeyFile">
                                                  <Input placeholder="C:\certs\client.key" />
                                                </Form.Item>
                                              </Col>
                                            </Row>
                                            <Row gutter={16}>
                                              <Col span={12}>
                                                <Form.Item label={<span style={{ color: '#fff' }}>受信任 CA 证书</span>} name="tlsTrustedCaFile">
                                                  <Input placeholder="C:\certs\ca.crt" />
                                                </Form.Item>
                                              </Col>
                                              <Col span={12}>
                                                <Form.Item label={<span style={{ color: '#fff' }}>TLS 校验域名 (ServerName)</span>} name="tlsServerName">
                                                  <Input placeholder="frp.yourdomain.com" />
                                                </Form.Item>
                                              </Col>
                                            </Row>
                                          </div>
                                        );
                                      }
                                      return null;
                                    }}
                                  </Form.Item>
                                </div>
                              )
                            }
                          ]}
                        />

                        <Form.Item style={{ marginTop: '20px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '16px', textAlign: 'right' }}>
                          <Button type="primary" htmlType="submit">保存全部客户端配置</Button>
                        </Form.Item>
                      </Form>
                    )
                  },
                  {
                    key: 'toml',
                    label: <Space><CodeOutlined />高级 TOML 配置</Space>,
                    children: (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                          <Text type="secondary">直接编辑 TOML 代码以修改配置文件（保存时将自动调用语法校验）。</Text>
                          <Button
                            type="primary"
                            icon={<CheckCircleOutlined />}
                            onClick={handleSaveRawToml}
                            loading={tomlLoading}
                            style={{ background: '#52c41a', borderColor: '#52c41a' }}
                          >
                            校验并保存
                          </Button>
                        </div>
                        <Input.TextArea
                          value={rawToml}
                          onChange={(e) => setRawToml(e.target.value)}
                          rows={15}
                          style={{
                            fontFamily: 'Fira Code, monospace',
                            fontSize: '13px',
                            background: '#08090a',
                            color: '#e6ebf1',
                            borderColor: 'rgba(255,255,255,0.08)'
                          }}
                        />
                      </div>
                    )
                  },
                  {
                    key: 'logs',
                    label: <Space><FileTextOutlined />运行日志速览</Space>,
                    children: (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                          <Text type="secondary">近 200 行实例日志（若要看实时流请前往侧边栏"实时日志流"）。</Text>
                          <Button size="small" icon={<ReloadOutlined />} onClick={() => loadMiniLogs(activeConfigId)}>刷新</Button>
                        </div>
                        {logsLoading ? (
                          <Skeleton active />
                        ) : (
                          <pre className="terminal-container" style={{ height: '320px', margin: 0 }}>
                            {miniLogs || '没有日志。'}
                          </pre>
                        )}
                      </div>
                    )
                  }
                ]}
              />
            </Card>
          ) : (
            <Card className="glass-card" bordered={false} style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '100px 0' }}>
              <Empty description={<span style={{ color: 'rgba(255,255,255,0.45)' }}>请在左侧选择或创建一个配置文件。</span>} />
            </Card>
          )}
        </Col>
      </Row>

      {/* 新建配置 Modal */}
      <Modal
        title="新建配置文件"
        open={newConfigModalOpen}
        onCancel={() => setNewConfigModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={newConfigForm} layout="vertical" onFinish={handleCreateConfig}>
          <Form.Item
            label="唯一ID标识 (必须为纯英文/数字/下划线)"
            name="id"
            rules={[
              { required: true, message: '请输入配置ID' },
              { pattern: /^[a-zA-Z0-9_-]+$/, message: '仅支持英文字母、数字、下划线及中划线' }
            ]}
          >
            <Input placeholder="例如: web_proxy" />
          </Form.Item>
          <Form.Item label="显示名称备注" name="name">
            <Input placeholder="例如: 公司内网测试" />
          </Form.Item>
          <Form.Item label="FRP 服务端地址" name="serverAddr" initialValue="127.0.0.1">
            <Input placeholder="例如: 8.8.8.8" />
          </Form.Item>
          <Form.Item label="服务端端口" name="serverPort" initialValue={7000}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="密钥 Token" name="token">
            <Input.Password placeholder="可空" />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => setNewConfigModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit">创建</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 新建/编辑代理 Drawer */}
      <Drawer
        title={editingProxy ? '编辑代理规则' : '添加代理规则'}
        width={520}
        onClose={() => setProxyDrawerOpen(false)}
        open={proxyDrawerOpen}
        bodyStyle={{ paddingBottom: 80 }}
        footer={
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setProxyDrawerOpen(false)}>取消</Button>
              <Button onClick={() => proxyForm.submit()} type="primary">提交保存</Button>
            </Space>
          </div>
        }
      >
        <Form form={proxyForm} layout="vertical" onFinish={handleSaveProxy}>
          <Form.Item
            label="代理规则名称 (唯一，如 ssh, web-test)"
            name="name"
            rules={[{ required: true, message: '请输入代理名称' }]}
          >
            <Input placeholder="ssh" disabled={!!editingProxy} />
          </Form.Item>

          <Form.Item label="穿透协议类型" name="type" rules={[{ required: true }]} initialValue="tcp">
            <Select
              options={[
                { value: 'tcp', label: 'TCP — 通用端口转发' },
                { value: 'udp', label: 'UDP — 通用 UDP 转发' },
                { value: 'http', label: 'HTTP — 网站/API' },
                { value: 'https', label: 'HTTPS — 直通 TLS' },
                { value: 'tcpmux', label: 'TCPMUX — 端口复用 (httpconnect)' },
                { value: 'stcp', label: 'STCP — 安全 P2P (需共享密钥)' },
                { value: 'sudp', label: 'SUDP — 安全 P2P UDP' },
                { value: 'xtcp', label: 'XTCP — NAT 穿透 P2P' },
              ]}
            />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.type !== cur.type || prev.pluginName !== cur.pluginName}
          >
            {({ getFieldValue }) => {
              const usingPlugin = !!getFieldValue('pluginName');
              return (
                <>
                  <Form.Item label="本地监听 IP" name="localIP" initialValue="127.0.0.1">
                    <Input placeholder="127.0.0.1" disabled={usingPlugin} />
                  </Form.Item>
                  <Form.Item
                    label="本地映射端口"
                    name="localPort"
                    rules={usingPlugin ? [] : [{ required: true, message: '请输入本地端口' }]}
                  >
                    <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="22" disabled={usingPlugin} />
                  </Form.Item>
                </>
              );
            }}
          </Form.Item>

          {/* 类型相关字段 */}
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.type !== cur.type}
          >
            {({ getFieldValue }) => {
              const type = getFieldValue('type');
              if (type === 'http' || type === 'https') {
                return (
                  <>
                    <Form.Item
                      label="自定义域名 customDomains (逗号分隔)"
                      name="customDomains"
                      tooltip="HTTP/HTTPS 至少指定 customDomains 或 subdomain 其一"
                    >
                      <Input placeholder="app.example.com" />
                    </Form.Item>
                    <Form.Item label="子域名 subdomain" name="subdomain">
                      <Input placeholder="myapp" />
                    </Form.Item>
                    {type === 'http' && (
                      <>
                        <Form.Item label="路径前缀 locations (逗号分隔)" name="locations">
                          <Input placeholder="/api,/static" />
                        </Form.Item>
                        <Form.Item label="HostHeaderRewrite" name="hostHeaderRewrite">
                          <Input placeholder="internal.example.com" />
                        </Form.Item>
                        <Form.Item label="HTTP 用户名" name="httpUser">
                          <Input placeholder="为 Basic Auth 添加用户名" />
                        </Form.Item>
                        <Form.Item label="HTTP 密码" name="httpPassword">
                          <Input.Password placeholder="为 Basic Auth 添加密码" />
                        </Form.Item>
                      </>
                    )}
                  </>
                );
              }
              if (type === 'tcpmux') {
                return (
                  <>
                    <Form.Item label="复用器 multiplexer" name="multiplexer" initialValue="httpconnect">
                      <Select options={[{ value: 'httpconnect', label: 'httpconnect (默认)' }]} />
                    </Form.Item>
                    <Form.Item label="自定义域名 customDomains (逗号分隔)" name="customDomains" rules={[{ required: true }]}>
                      <Input placeholder="proxy.example.com" />
                    </Form.Item>
                    <Form.Item label="路由 HTTP 用户名 routeByHTTPUser" name="routeByHTTPUser">
                      <Input placeholder="可选：按 Basic 用户名路由" />
                    </Form.Item>
                  </>
                );
              }
              if (type === 'stcp' || type === 'sudp' || type === 'xtcp') {
                return (
                  <>
                    <Form.Item label="共享密钥 secretKey" name="secretKey" rules={[{ required: true, message: '安全代理必须设置 secretKey' }]}>
                      <Input.Password placeholder="访客端与服务端共享密钥" />
                    </Form.Item>
                    <Form.Item label="允许访问的用户 allowUsers (逗号分隔，可选)" name="allowUsers">
                      <Input placeholder="alice,bob 或 *" />
                    </Form.Item>
                  </>
                );
              }
              // tcp / udp
              return (
                <Form.Item
                  label="公网暴露端口 remotePort"
                  name="remotePort"
                  rules={[{ required: true, message: '请输入公网暴露端口' }]}
                >
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="6000" />
                </Form.Item>
              );
            }}
          </Form.Item>

          {/* 插件透传（高级） */}
          <Form.Item
            label="高级：使用本地插件代替 local 端口"
            name="pluginName"
            tooltip="选择后将由 frpc 内置插件提供后端服务，可不填本地 IP/端口"
          >
            <Select
              allowClear
              placeholder="可选：选择插件以替代 local 端口"
              options={[
                { value: 'http_proxy', label: 'http_proxy — HTTP 代理' },
                { value: 'socks5', label: 'socks5 — SOCKS5 代理' },
                { value: 'static_file', label: 'static_file — 静态文件服务' },
                { value: 'unix_domain_socket', label: 'unix_domain_socket' },
                { value: 'http2http', label: 'http2http' },
                { value: 'http2https', label: 'http2https' },
                { value: 'https2http', label: 'https2http' },
                { value: 'https2https', label: 'https2https' },
                { value: 'tls2raw', label: 'tls2raw' },
              ]}
            />
          </Form.Item>

          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.pluginName !== cur.pluginName}
          >
            {({ getFieldValue }) => {
              const p = getFieldValue('pluginName');
              if (!p) return null;
              const needsLocalAddr = ['http2http', 'http2https', 'https2http', 'https2https', 'tls2raw'].includes(p);
              const needsLocalPath = p === 'static_file' || p === 'unix_domain_socket';
              const needsAuth = p === 'http_proxy' || p === 'socks5' || p === 'static_file';
              return (
                <>
                  {needsLocalAddr && (
                    <Form.Item label="插件 localAddr" name="pluginLocalAddr" rules={[{ required: true }]}>
                      <Input placeholder="127.0.0.1:8080" />
                    </Form.Item>
                  )}
                  {needsLocalPath && (
                    <Form.Item label={p === 'static_file' ? '静态目录 localPath' : 'Socket 路径 localPath'} name="pluginLocalPath" rules={[{ required: true }]}>
                      <Input placeholder={p === 'static_file' ? '/var/www' : '/var/run/app.sock'} />
                    </Form.Item>
                  )}
                  {needsAuth && (
                    <>
                      <Form.Item label="插件用户名" name="pluginHTTPUser">
                        <Input placeholder="可选" />
                      </Form.Item>
                      <Form.Item label="插件密码" name="pluginHTTPPassword">
                        <Input.Password placeholder="可选" />
                      </Form.Item>
                    </>
                  )}
                </>
              );
            }}
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
};

export default Configs;
