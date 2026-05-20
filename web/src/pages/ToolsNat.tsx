import { useState } from 'react';
import {
  Card,
  Space,
  Typography,
  Input,
  Button,
  Alert,
  Tag,
  Descriptions,
  Select,
  App,
  Result,
} from 'antd';
import { ApiOutlined, RocketOutlined, GlobalOutlined } from '@ant-design/icons';
import client from '../api/client';

const { Title, Text, Paragraph } = Typography;

interface NatResult {
  stun_server: string;
  public_addrs: string[];
  local_addr: string;
}

const STUN_PRESETS = [
  { value: 'stun.easyvoip.com:3478', label: 'EasyVoIP (推荐)' },
  { value: 'stun.miwifi.com:3478', label: '小米 (国内)' },
  { value: 'stun.qq.com:3478', label: 'QQ (国内)' },
  { value: 'stun.l.google.com:19302', label: 'Google (海外)' },
  { value: 'stun.cloudflare.com:3478', label: 'Cloudflare (海外)' },
];

function inferNatType(addrs: string[]): { type: string; color: string; tip: string } {
  if (!addrs || addrs.length === 0) {
    return { type: '未知', color: 'default', tip: '未拿到公网映射' };
  }
  const unique = new Set(addrs);
  if (unique.size === 1) {
    return {
      type: 'Cone NAT',
      color: 'green',
      tip: '映射端口固定，适合大多数 xtcp / stcp 穿透方案',
    };
  }
  return {
    type: 'Symmetric NAT',
    color: 'orange',
    tip: '不同目标的映射端口不同，xtcp 打洞成功率低，建议改走中转',
  };
}

const ToolsNat: React.FC = () => {
  const { message } = App.useApp();
  const [stunServer, setStunServer] = useState('stun.easyvoip.com:3478');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NatResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const discover = async () => {
    setLoading(true);
    setResult(null);
    setErr(null);
    try {
      const resp = await client.post<NatResult>('/api/v1/nathole/discover', {
        stun_server: stunServer.trim(),
      });
      setResult(resp.data);
      message.success('NAT 探测完成');
    } catch (e: unknown) {
      const errObj = e as { response?: { data?: { error?: { message?: string } } } };
      const msg = errObj.response?.data?.error?.message || '探测请求失败';
      setErr(msg);
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const natType = result ? inferNatType(result.public_addrs) : null;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card styles={{ body: { padding: 18 } }} style={{ borderRadius: 10 }}>
        <Space direction="vertical" size={4}>
          <Title level={4} style={{ margin: 0 }}>
            <GlobalOutlined /> NAT 类型探测
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            通过 STUN 服务器交换数据包，用于判断本机是否处于对称 NAT 后面，从而帮助决定 xtcp / stcp 是否可行。
          </Text>
        </Space>
      </Card>

      <Card title="STUN 服务器" styles={{ body: { padding: 18 } }} style={{ borderRadius: 10 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space.Compact style={{ width: '100%' }}>
            <Select
              style={{ width: 280 }}
              value={stunServer}
              options={STUN_PRESETS}
              onChange={setStunServer}
            />
            <Input
              value={stunServer}
              onChange={(e) => setStunServer(e.target.value)}
              placeholder="host:port"
            />
          </Space.Compact>
          <Button
            type="primary"
            icon={<RocketOutlined />}
            loading={loading}
            onClick={discover}
            disabled={!stunServer.trim()}
          >
            开始探测
          </Button>
        </Space>
      </Card>

      {err && (
        <Alert type="error" showIcon message="探测失败" description={err} style={{ borderRadius: 10 }} />
      )}

      {result && natType && (
        <Card styles={{ body: { padding: 18 } }} style={{ borderRadius: 10 }}>
          <Result
            status={natType.color === 'green' ? 'success' : 'warning'}
            icon={<ApiOutlined />}
            title={
              <Space>
                NAT 类型推断：<Tag color={natType.color}>{natType.type}</Tag>
              </Space>
            }
            subTitle={natType.tip}
            extra={
              <Descriptions column={1} bordered size="small" style={{ textAlign: 'left' }}>
                <Descriptions.Item label="使用的 STUN">{result.stun_server}</Descriptions.Item>
                <Descriptions.Item label="本地地址">
                  <Paragraph copyable style={{ margin: 0, fontFamily: 'ui-monospace, monospace' }}>
                    {result.local_addr || '—'}
                  </Paragraph>
                </Descriptions.Item>
                <Descriptions.Item label="公网映射">
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    {(result.public_addrs ?? []).map((a) => (
                      <Paragraph
                        key={a}
                        copyable
                        style={{ margin: 0, fontFamily: 'ui-monospace, monospace' }}
                      >
                        {a}
                      </Paragraph>
                    ))}
                    {(!result.public_addrs || result.public_addrs.length === 0) && (
                      <Text type="secondary">无</Text>
                    )}
                  </Space>
                </Descriptions.Item>
              </Descriptions>
            }
          />
        </Card>
      )}
    </Space>
  );
};

export default ToolsNat;
