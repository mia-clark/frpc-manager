import { test, expect } from './fixtures/daemon';
import { api } from './helpers/api';
import {
  login,
  sidebar,
  configList,
  detailTabs,
  visualConfig,
} from './helpers/selectors';

test.describe('STUN 字段回填回归', () => {
  test('保存 STUN 后刷新页面, 输入框仍应显示填入的值', async ({ page, daemon }) => {
    // Create config with explicit auth token so the visual config form passes validation
    const h = { Authorization: `Bearer ${daemon.token}`, 'Content-Type': 'application/json' };
    const r = await fetch(`${daemon.baseURL}/api/v1/configs`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        id: 'inst_stun',
        config: {
          serverAddr: '127.0.0.1',
          serverPort: 65530,
          loginFailExit: false,
          auth: { method: 'token', token: 'test-auth-token' },
          log: { level: 'info', maxDays: 1 },
          frpmgr: { name: 'inst_stun' },
        },
      }),
    });
    if (!r.ok) throw new Error(`createConfig failed: ${r.status} ${await r.text()}`);

    await page.goto(daemon.baseURL);
    await login.tokenInput(page).fill(daemon.token);
    await login.submitBtn(page).click();
    await sidebar.frpcInstancesItem(page).click();

    await configList.configCard(page, 'inst_stun').click();
    await detailTabs.visualConfig(page).click();

    // Wait for form to load: serverAddr is required and must be filled before we can save.
    // The form is populated asynchronously by loadVisualConfig() after the tab switch.
    const serverAddrInput = page.getByLabel(/FRP 服务端公网地址/i);
    await expect(serverAddrInput).toHaveValue(/\S+/, { timeout: 5000 });

    const stunValue = 'stun.cloudflare.com:3478';
    await visualConfig.stunInput(page).fill(stunValue);
    await visualConfig.saveBtn(page).click();
    await expect(visualConfig.saveOkToast(page)).toBeVisible({ timeout: 5000 });

    // 关键回归点：刷新页面后字段必须仍是 stunValue
    await page.reload();
    // localStorage 的 token 应该保留，sidebar 应该直接可见
    await sidebar.frpcInstancesItem(page).click();
    await configList.configCard(page, 'inst_stun').click();
    await detailTabs.visualConfig(page).click();

    await expect(visualConfig.stunInput(page)).toHaveValue(stunValue);
  });
});
