import type { CategoryMetric, InvestmentRecord, TemplateItem, TimeAccount, TimeCategory, WeeklyTemplate } from './models';
import { CATEGORIES, CATEGORY_META } from './models';

export function totalInvested(records: InvestmentRecord[]): number {
  return records.reduce((sum, item) => sum + item.hours, 0);
}

export function metricsFor(records: InvestmentRecord[]): CategoryMetric[] {
  const total = totalInvested(records);
  return CATEGORIES.map((category) => {
    const hours = records.filter((item) => item.category === category).reduce((sum, item) => sum + item.hours, 0);
    const meta = CATEGORY_META[category];
    return { category, hours, share: total ? hours / total : 0, roi: meta.roi, color: meta.color, icon: meta.icon };
  });
}

export function portfolioScore(metrics: CategoryMetric[], account: TimeAccount): number {
  const invested = metrics.reduce((sum, item) => sum + item.hours * item.roi, 0);
  const available = Math.max(account.weeklyHours, 1);
  return Math.round((invested / available) * 10) / 10;
}

export function balanceSheet(metrics: CategoryMetric[], account: TimeAccount) {
  const assets = metrics.reduce((sum, item) => sum + item.hours * item.roi, 0);
  const invested = metrics.reduce((sum, item) => sum + item.hours, 0);
  return { assets: Math.round(assets * 10) / 10, liabilities: Math.max(0, Math.round((account.weeklyHours - invested) * 10) / 10), equity: Math.round((assets - Math.max(0, account.weeklyHours - invested)) * 10) / 10 };
}

export function suggestions(metrics: CategoryMetric[], account: TimeAccount): string[] {
  const total = Math.max(metrics.reduce((sum, item) => sum + item.hours, 0), 1);
  const lowest = [...metrics].sort((a, b) => a.hours - b.hours)[0];
  const highest = [...metrics].sort((a, b) => b.hours - a.hours)[0];
  const result: string[] = [];
  if (highest.share > 0.35) result.push(`「${highest.category}」占比 ${Math.round(highest.share * 100)}%，建议每周拿出 2 小时投向低配资产。`);
  if (lowest.share < 0.1) result.push(`「${lowest.category}」只有 ${Math.round(lowest.share * 100)}%，这是当前最值得补仓的长期资产。`);
  if (account.weeklyHours - total > 4) result.push(`还有 ${Math.round(account.weeklyHours - total)} 小时未被配置，可以先建立一笔“探索基金”。`);
  if (!result.length) result.push('你的时间组合分布稳定，继续用每周复盘保持动态平衡。');
  return result;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const TICKS_PER_HOUR = 2;
// 模板按 0.5 小时为最小粒度，不足半小格的零头向下取整（1.3 -> 1.0，1.8 -> 1.5）；无效或 0 返回 0 以便过滤
export function snapHalf(hours: number): number {
  const value = Number(hours);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value * TICKS_PER_HOUR) / TICKS_PER_HOUR;
}

export function templateTotal(items: TemplateItem[]): number {
  return round1(items.reduce((sum, item) => sum + item.hours, 0));
}

export function remainingHours(records: InvestmentRecord[], account: TimeAccount): number {
  return round1(Math.max(0, account.weeklyHours - totalInvested(records)));
}

export function normalizeTemplate(name: string, items: TemplateItem[]): { name: string; items: TemplateItem[] } {
  return {
    name: name.trim() || '未命名周度模板',
    items: items
      .map((item) => ({ category: item.category, hours: snapHalf(item.hours), note: item.note.trim() }))
      .filter((item) => Number.isFinite(item.hours) && item.hours >= 0.5),
  };
}

export function createTemplate(name: string, items: TemplateItem[], now = new Date().toISOString()): WeeklyTemplate {
  return { id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...normalizeTemplate(name, items), updatedAt: now };
}

export type PlanEntryStatus = 'full' | 'partial' | 'skipped';

export interface TemplatePlanEntry extends TemplateItem {
  status: PlanEntryStatus;
  plannedHours: number;
}

export interface TemplateApplyPlan {
  template: WeeklyTemplate;
  totalHours: number;
  alreadyInvested: number;
  weeklyHours: number;
  remaining: number;
  overflow: boolean;
  entries: TemplatePlanEntry[];
  plannedHours: number;
}

// 按模板条目顺序填满当周剩余预算：整笔装入、装不下则截断到 0.5h、之后的条目跳过
export function planTemplateApply(template: WeeklyTemplate, records: InvestmentRecord[], account: TimeAccount): TemplateApplyPlan {
  const totalHours = templateTotal(template.items);
  const alreadyInvested = totalInvested(records);
  const remaining = round1(Math.max(0, account.weeklyHours - alreadyInvested));
  let capacityTicks = Math.floor(remaining * TICKS_PER_HOUR);
  const entries: TemplatePlanEntry[] = template.items.map((item) => {
    const itemTicks = Math.round(item.hours * TICKS_PER_HOUR);
    if (itemTicks <= capacityTicks) {
      capacityTicks -= itemTicks;
      return { ...item, status: 'full', plannedHours: item.hours };
    }
    if (capacityTicks > 0) {
      const planned = round1(capacityTicks / TICKS_PER_HOUR);
      capacityTicks = 0;
      return { ...item, status: 'partial', plannedHours: planned };
    }
    return { ...item, status: 'skipped', plannedHours: 0 };
  });
  return {
    template,
    totalHours,
    alreadyInvested: round1(alreadyInvested),
    weeklyHours: account.weeklyHours,
    remaining,
    overflow: totalHours > remaining + 0.001,
    entries,
    plannedHours: round1(entries.reduce((sum, entry) => sum + entry.plannedHours, 0)),
  };
}

export function recordsFromPlan(plan: TemplateApplyPlan, now = new Date().toISOString()): InvestmentRecord[] {
  return plan.entries
    .filter((entry) => entry.plannedHours >= 0.5)
    .map((entry) => record(entry.category, entry.plannedHours, entry.note, now));
}

export function record(category: TimeCategory, hours: number, note: string, date = new Date().toISOString()): InvestmentRecord {
  return { id: `time-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, category, hours: Math.max(0.5, Number(hours) || 0.5), note: note.trim() || '未命名投资', date };
}

export function sampleSnapshot() {
  const account: TimeAccount = { dailyHours: 8, weeklyHours: 56, updatedAt: new Date().toISOString() };
  const seed: Array<[TimeCategory, number, string]> = [
    ['事业', 16, '产品策略与交付'], ['学习', 10, '阅读与课程'], ['健康', 7, '力量训练与散步'],
    ['关系', 8, '家人和朋友'], ['休息', 9, '睡眠与留白'], ['娱乐', 4, '电影与游戏'],
  ];
  const records = seed.map(([category, hours, note], index) => record(category, hours, note, new Date(Date.now() - index * 86400000).toISOString()));
  const templates: WeeklyTemplate[] = [
    createTemplate('稳健基础周', [
      { category: '健康', hours: 3, note: '力量训练与散步' },
      { category: '学习', hours: 4, note: '阅读与课程' },
      { category: '关系', hours: 3, note: '陪伴家人' },
      { category: '事业', hours: 6, note: '深度工作' },
      { category: '休息', hours: 2, note: '留白与睡眠' },
    ]),
    createTemplate('深度冲刺周', [
      { category: '事业', hours: 18, note: '项目攻坚' },
      { category: '学习', hours: 8, note: '专项突破' },
      { category: '健康', hours: 6, note: '保持训练' },
      { category: '关系', hours: 4, note: '家人和朋友' },
      { category: '休息', hours: 4, note: '恢复' },
    ]),
  ];
  return { account, records, templates };
}
