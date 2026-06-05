import { useState } from 'react';
import {
  Card,
  Space,
  Typography,
  Button,
  Collapse,
  Row,
  Col,
  Tag,
  App,
  theme as antdTheme,
} from 'antd';
import {
  ReadOutlined,
  GithubOutlined,
  CopyOutlined,
  CheckOutlined,
  CloudDownloadOutlined,
  DockerOutlined,
  CodeOutlined,
  RocketOutlined,
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

const REPO_FRPC = 'https://github.com/mia-clark/frpc-manager';
const REPO_FRPS = 'https://github.com/mia-clark/frps-manager';

interface CmdBlockProps {
  code: string;
  caption?: string;
}

const CmdBlock: React.FC<CmdBlockProps> = ({ code, caption }) => {
  const { token } = antdTheme.useToken();
  const { message } = App.useApp();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const ta = document.createElement('textarea');
        ta.value = code;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      message.success('已复制');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      message.error('复制失败，请手动选中复制');
    }
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {caption && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
          {caption}
        </Text>
      )}
      <div
        style={{
          position: 'relative',
          background: token.colorFillTertiary,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 8,
          padding: '12px 14px',
          paddingRight: 80,
        }}
      >
        <pre
          style={{
            margin: 0,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
            fontSize: 12.5,
            lineHeight: 1.6,
            color: token.colorText,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {code}
        </pre>
        <Button
          size="small"
          type={copied ? 'primary' : 'default'}
          icon={copied ? <CheckOutlined /> : <CopyOutlined />}
          onClick={onCopy}
          style={{ position: 'absolute', top: 8, right: 8 }}
        >
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
    </div>
  );
};

const Help: React.FC = () => {
  const { token } = antdTheme.useToken();

  const dockerRun = `docker run -d --name frpcmgrd --network host \\
  -e FRPCMGR_API_TOKEN="$(openssl rand -hex 32)" \\
  -v $(pwd)/data:/data \\
  ghcr.io/mia-clark/frpc-manager:latest`;

  const dockerCompose = `curl -O https://raw.githubusercontent.com/mia-clark/frpc-manager/main/deploy/docker-compose.standalone.yml
curl -O https://raw.githubusercontent.com/mia-clark/frpc-manager/main/deploy/.env.example
mv .env.example .env
# 编辑 .env，至少把 FRPCMGR_API_TOKEN 设成一个真实令牌
docker compose -f docker-compose.standalone.yml up -d`;

  const fmcCmds = `fmc start            # 启动服务
fmc stop             # 停止服务
fmc restart          # 重启服务
fmc status           # 查看状态
fmc logs -f          # 实时日志
fmc info             # 完整信息（访问地址 / API 令牌 / 路径）
fmc update           # 更新到最新版（保留端口/令牌/数据）
fmc upgrade-legacy   # 一键迁移旧版 frpmgrd 部署到 frpcmgrd
fmc uninstall        # 卸载`;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 顶部简介 */}
      <Card styles={{ body: { padding: 18 } }} style={{ borderRadius: 10 }}>
        <Space direction="vertical" size={4}>
          <Title level={4} style={{ margin: 0 }}>
            <ReadOutlined /> 帮助 / 文档
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            FRPC 是 frp <Tag color="blue" style={{ marginInline: 4 }}>客户端</Tag>
            管理器；如需服务端，请使用配套的 FRPS 管理器。
            <br />
            装好守护进程后，浏览器打开 <Text code>http://你的IP:端口/</Text>{' '}
            填入 API Token 即可登录，所有隧道在网页上点鼠标管理。
          </Text>
        </Space>
      </Card>

      {/* 仓库链接 */}
      <Card
        title={
          <Space>
            <GithubOutlined /> 项目仓库
          </Space>
        }
        styles={{ body: { padding: 18 } }}
        style={{ borderRadius: 10 }}
      >
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          两个仓库相互独立、互不依赖：FRPC 装在内网机器，FRPS 装在公网服务器。
        </Paragraph>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12}>
            <Card
              size="small"
              hoverable
              onClick={() => window.open(REPO_FRPC, '_blank', 'noopener')}
              style={{
                borderRadius: 10,
                borderColor: token.colorPrimaryBorder,
                background: token.colorPrimaryBg,
                cursor: 'pointer',
              }}
            >
              <Space>
                <GithubOutlined style={{ fontSize: 20, color: token.colorPrimary }} />
                <Space direction="vertical" size={0}>
                  <Text strong>FRPC · 客户端管理器</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    mia-clark/frpc-manager（本仓库）
                  </Text>
                </Space>
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card
              size="small"
              hoverable
              onClick={() => window.open(REPO_FRPS, '_blank', 'noopener')}
              style={{ borderRadius: 10, cursor: 'pointer' }}
            >
              <Space>
                <GithubOutlined style={{ fontSize: 20 }} />
                <Space direction="vertical" size={0}>
                  <Text strong>FRPS · 服务端管理器</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    mia-clark/frps-manager
                  </Text>
                </Space>
              </Space>
            </Card>
          </Col>
        </Row>
      </Card>

      {/* 折叠：安装/Docker/命令 */}
      <Card styles={{ body: { padding: 8 } }} style={{ borderRadius: 10 }}>
        <Collapse
          defaultActiveKey={['install']}
          ghost
          size="large"
          items={[
            {
              key: 'install',
              label: (
                <Space>
                  <CloudDownloadOutlined />
                  <Text strong>一键安装</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Linux / macOS / Windows
                  </Text>
                </Space>
              ),
              children: (
                <>
                  <CmdBlock
                    caption="① Linux / macOS — 国内镜像（推荐，加速下载）"
                    code="curl -fsSL https://gh-raw.966788.xyz/frpc-mgr/install.sh | sh"
                  />
                  <CmdBlock
                    caption="② Linux / macOS — GitHub 官方（海外或直连可用）"
                    code={'sh -c "$(curl -fsSL https://raw.githubusercontent.com/mia-clark/frpc-manager/main/scripts/install.sh)"'}
                  />
                  <CmdBlock
                    caption="③ Windows — 管理员 PowerShell 中执行"
                    code="irm https://raw.githubusercontent.com/mia-clark/frpc-manager/main/scripts/install.ps1 | iex"
                  />
                  <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                    安装脚本会自动识别系统/架构、下载二进制、注册系统服务（systemd / OpenRC / launchd / Windows
                    服务）并开机自启。装完终端会打印访问地址与 API 令牌。
                  </Paragraph>
                </>
              ),
            },
            {
              key: 'docker',
              label: (
                <Space>
                  <DockerOutlined />
                  <Text strong>Docker 部署</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    服务器推荐
                  </Text>
                </Space>
              ),
              children: (
                <>
                  <CmdBlock
                    caption="方式一 — docker run（一行起容器，token 随机生成）"
                    code={dockerRun}
                  />
                  <CmdBlock
                    caption="方式二 — docker compose（免拉源码，可保留 .env 配置）"
                    code={dockerCompose}
                  />
                  <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                    镜像 <Text code>ghcr.io/mia-clark/frpc-manager:latest</Text>{' '}
                    自动构建并支持 amd64 + arm64 + armv7。
                  </Paragraph>
                </>
              ),
            },
            {
              key: 'fmc',
              label: (
                <Space>
                  <CodeOutlined />
                  <Text strong>常用管理命令 (fmc)</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    跨平台运维速查
                  </Text>
                </Space>
              ),
              children: (
                <>
                  <CmdBlock
                    caption="装完即可在任意终端使用，自动适配 systemd / OpenRC / launchd / Windows 服务"
                    code={fmcCmds}
                  />
                  <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
                    <RocketOutlined /> 从旧版 <Text code>frpmgrd</Text> 升级而来？跑一次{' '}
                    <Text code>fmc upgrade-legacy</Text>{' '}
                    自动迁移服务/数据/配置（FRPMGR_ → FRPCMGR_），幂等可随时执行。
                  </Paragraph>
                </>
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );
};

export default Help;
