import { test, expect } from './fixtures/daemon';
import { api } from './helpers/api';
import { login, sidebar, configList, detailTabs, logsView } from './helpers/selectors';

test.describe('多实例日志严格分流', () => {
  test('inst_a 的日志视图只显示 [inst=inst_a] 行, inst_b 同理', async ({ page, daemon }) => {
    const a = api(daemon);

    // setup: 创建 2 实例 + 启动 + 等积累日志
    await a.createConfig('inst_a');
    await a.createConfig('inst_b');
    await a.start('inst_a');
    await a.start('inst_b');
    await a.waitForLogLines('inst_a', 3, 30000);
    await a.waitForLogLines('inst_b', 3, 30000);

    // 通过 UI 验证分流
    await page.goto(daemon.baseURL);
    await login.tokenInput(page).fill(daemon.token);
    await login.submitBtn(page).click();
    await sidebar.frpcInstancesItem(page).click();

    // 选 inst_a
    await configList.configCard(page, 'inst_a').click();
    await detailTabs.logs(page).click();
    await expect(logsView.lines(page).first()).toBeVisible({ timeout: 10000 });

    const linesA = await logsView.lines(page).allTextContents();
    expect(linesA.length).toBeGreaterThan(0);
    for (const line of linesA) {
      expect(line, `inst_a view leaked inst_b line: ${line}`).toContain('[inst=inst_a]');
      expect(line, `inst_a view leaked inst_b line: ${line}`).not.toContain('[inst=inst_b]');
    }

    // 切到 inst_b
    await configList.configCard(page, 'inst_b').click();
    await detailTabs.logs(page).click();
    await expect(logsView.lines(page).first()).toBeVisible({ timeout: 10000 });

    const linesB = await logsView.lines(page).allTextContents();
    expect(linesB.length).toBeGreaterThan(0);
    for (const line of linesB) {
      expect(line, `inst_b view leaked inst_a line: ${line}`).toContain('[inst=inst_b]');
      expect(line, `inst_b view leaked inst_a line: ${line}`).not.toContain('[inst=inst_a]');
    }
  });
});
