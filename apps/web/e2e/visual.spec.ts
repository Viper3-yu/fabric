import { expect, test, type Page } from '@playwright/test';

/**
 * 视觉回归基线。数据来自 e2e/fixtures/demo-ledger.json（时间戳已冻结）。
 * 更新夹具：DEMO_LEDGER_PATH=tmp/visual-seed.json NODE_ENV=test
 *   go run ./apps/api/cmd/seed && node e2e/freeze-ledger.mjs
 * 更新基线：pnpm visual:update（有意的设计变更后）。
 */

const TRANSIT = 'JX202607200001';

// 认证走 httpOnly cookie：context.request 与浏览器共享 cookie 存储，
// 经应用源（同源代理）登录后，页面导航即带上会话。
async function loginAs(page: Page, username: string) {
  const response = await page.context().request.post('/api/auth/login', {
    data: { username, password: `${username}123` },
  });
  if (!response.ok()) throw new Error(`login failed for ${username}`);
}

// Chromium 移动仿真下 context 级 reducedMotion 不生效（matchMedia 为 false），
// 显式按页模拟：gsap 与 CSS 动画直接呈现终态，截图才可复现。
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

// 等字体全部就绪、背景摄影图解码完成再截图，避免 woff2 分批加载与
// CSS 背景图晚到造成的差异（fonts.ready 不覆盖 background-image）。
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const urls: string[] = [];
    const candidates = [
      document.querySelector<HTMLElement>('.public-hero'),
      document.querySelector<HTMLElement>('.manifest-timeline'),
      document.querySelector<HTMLElement>('.login-intro'),
    ];
    for (const el of candidates) {
      if (!el) continue;
      const images = [
        getComputedStyle(el, '::before').backgroundImage,
        getComputedStyle(el).backgroundImage,
      ];
      for (const image of images) {
        const match = image.match(/url\("?([^")]+)"?\)/);
        if (match && !match[1].startsWith('data:')) {
          urls.push(new URL(match[1], location.href).href);
          break;
        }
      }
    }
    await Promise.all(
      urls.map(
        (src) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = img.onerror = () => {
              // onload 只代表传输完成，强制解码落地再放行截图。
              img
                .decode()
                .catch(() => {})
                .then(() => resolve());
            };
            img.src = src;
          }),
      ),
    );
  });
}

test.describe('公开页面', () => {
  test('查询落地页', async ({ page }) => {
    await page.goto('/track');
    await expect(page.locator('.public-hero')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot({ fullPage: true });
  });

  test('查询结果页', async ({ page }) => {
    await page.goto(`/track?trackingNumber=${TRANSIT}`);
    await expect(page.locator('.public-result')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot({ fullPage: true });
  });

  test('记录核对落地页', async ({ page }) => {
    await page.goto('/verify');
    await expect(page.locator('.verify-layout')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot();
  });

  test('记录核对结果页', async ({ page }) => {
    await page.goto(`/verify?trackingNumber=${TRANSIT}`);
    await expect(page.locator('.verify-result')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot({
      fullPage: true,
      // 检查时间为运行时钟，遮罩。
      mask: [page.locator('.verify-metrics dd, .verify-metrics strong')],
    });
  });

  test('登录页', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: '进入工作台' })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot({ fullPage: true });
  });
});

test.describe('业务工作台（shipper）', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'shipper');
  });

  test('工作台概览', async ({ page }) => {
    await page.goto('/app');
    await expect(page.locator('.dashboard-page')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot({
      fullPage: true,
      // 问候语随时段变化、检查时间为运行时钟，遮罩。
      mask: [
        page.locator('.dashboard-header > div > p'),
        page.locator('.dashboard-network-strip__facts dd').last(),
      ],
    });
  });

  test('运单列表', async ({ page }) => {
    await page.goto('/app/shipments');
    // 桌面渲染表格、移动端渲染卡片（表格仍在其 DOM 中但被隐藏），取可见者。
    await expect(page.getByText('JX202607200001').filter({ visible: true }).first()).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot({ fullPage: true });
  });

  test('创建运单表单', async ({ page }) => {
    await page.goto('/app/shipments/new');
    await expect(page.locator('form')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot({ fullPage: true });
  });

  test('运单详情', async ({ page }) => {
    await page.goto('/app/shipments/shipment-demo-transit');
    await expect(page.locator('.shipment-detail-page')).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot({
      fullPage: true,
      // 地图瓦片来自外网且异步加载，遮罩。
      mask: [page.locator('.shipment-route-map')],
    });
  });
});
