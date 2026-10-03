<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { LocalTimeRepository } from '../adapters/local-time.repository';
import { CATEGORIES, CATEGORY_META, type TimeCategory, type WeeklyTemplate } from '../core/models';
import { balanceSheet, metricsFor, portfolioScore, record, sampleSnapshot, suggestions, templateRecords, templateTotal, totalInvested } from '../core/time-engine';

const repo = new LocalTimeRepository();
const tab = ref<'总览' | '记录' | '模板' | '组合' | '分析'>('总览');
const notice = ref('');
const state = reactive(repo.load());
const accountDraft = reactive({ dailyHours: state.account.dailyHours, weeklyHours: state.account.weeklyHours });
const draft = reactive({ category: '事业' as TimeCategory, hours: 2, note: '' });
const templateDraft = reactive({ name: '', items: [{ category: '健康' as TimeCategory, hours: 2, note: '' }] });
const pendingTemplate = ref<WeeklyTemplate | null>(null);
const metrics = computed(() => metricsFor(state.records));
const invested = computed(() => totalInvested(state.records));
const score = computed(() => portfolioScore(metrics.value, state.account));
const sheet = computed(() => balanceSheet(metrics.value, state.account));
const tips = computed(() => suggestions(metrics.value, state.account));
const recent = computed(() => [...state.records].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5));
const ledger = computed(() => [...state.records].sort((a, b) => b.date.localeCompare(a.date)));
const remainingHours = computed(() => Math.max(0, Math.round((state.account.weeklyHours - invested.value) * 10) / 10));
const templateDraftTotal = computed(() => templateDraft.items.reduce((sum, item) => sum + (Number(item.hours) || 0), 0));

function save() { repo.save({ account: state.account, records: state.records, templates: state.templates }); }
function updateAccount() { state.account.dailyHours = Math.max(1, Number(accountDraft.dailyHours) || 1); state.account.weeklyHours = Math.max(1, Number(accountDraft.weeklyHours) || 1); state.account.updatedAt = new Date().toISOString(); save(); notice.value = '时间账户已更新'; }
function addRecord() { state.records.unshift(record(draft.category, draft.hours, draft.note)); save(); draft.note = ''; notice.value = '一笔时间投资已入账'; tab.value = '记录'; }
function removeRecord(id: string) { state.records = state.records.filter((item) => item.id !== id); save(); }
function resetDemo() { const fresh = sampleSnapshot(); state.account = fresh.account; state.records = fresh.records; state.templates = fresh.templates; save(); notice.value = '已恢复初始示例组合'; }

function addTemplateItem() { templateDraft.items.push({ category: '学习', hours: 2, note: '' }); }
function removeTemplateItem(index: number) { if (templateDraft.items.length > 1) templateDraft.items.splice(index, 1); }
function saveTemplate() {
  const items = templateDraft.items.map((item) => ({ category: item.category, hours: Math.max(0.5, Number(item.hours) || 0.5), note: item.note.trim() || '未命名投资' }));
  const tpl: WeeklyTemplate = { id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: templateDraft.name.trim() || `周度模板 ${state.templates.length + 1}`, items, createdAt: new Date().toISOString() };
  state.templates = [...state.templates, tpl];
  save();
  templateDraft.name = '';
  templateDraft.items = [{ category: '健康', hours: 2, note: '' }];
  notice.value = `模板「${tpl.name}」已保存，可一键套用`;
}
function removeTemplate(id: string) { state.templates = state.templates.filter((item) => item.id !== id); save(); notice.value = '模板已删除'; }
function requestApply(tpl: WeeklyTemplate) {
  if (templateTotal(tpl) > state.account.weeklyHours) { pendingTemplate.value = tpl; return; }
  runApply(tpl, 'full');
}
function runApply(tpl: WeeklyTemplate, mode: 'full' | 'fit') {
  const created = templateRecords(tpl, mode, remainingHours.value);
  pendingTemplate.value = null;
  if (!created.length) { notice.value = '本周剩余时间不足，未生成任何记录'; return; }
  state.records = [...created, ...state.records];
  save();
  notice.value = `模板「${tpl.name}」已套用，生成 ${created.length} 笔当周记录`;
  tab.value = '记录';
}
function confirmFitApply() { if (pendingTemplate.value) runApply(pendingTemplate.value, 'fit'); }
function cancelApply() { pendingTemplate.value = null; notice.value = '已取消套用该模板'; }
</script>

<template>
  <div class="app-shell investment-app">
    <header class="topbar">
      <div class="brand"><div class="brand-mark">时</div><div><span class="eyebrow">LIFE CAPITAL / 01</span><h1>人生时间投资所</h1></div></div>
      <div class="top-actions"><span class="live-dot">本周账期进行中</span><button class="ghost-button" type="button" @click="resetDemo">↻ 重置演示</button></div>
    </header>
    <main class="page-wrap">
      <section class="hero-row">
        <div><p class="eyebrow accent-text">个人时间资产管理台</p><h2>把今天的小时，<em>配置成明天的底气。</em></h2><p class="hero-copy">你的时间不是被消耗的余额，而是一支每天都在重新开盘的投资组合。</p></div>
        <div class="hero-date"><span>当前周期</span><strong>WEEK 40</strong><small>2026 · 10 / 01 — 10 / 07</small></div>
      </section>
      <nav class="tabs" aria-label="功能模块"><button v-for="item in ['总览', '记录', '模板', '组合', '分析']" :key="item" type="button" :class="{ active: tab === item }" @click="tab = item as typeof tab">{{ item }}<span v-if="item === '记录'" class="tab-count">{{ state.records.length }}</span><span v-if="item === '模板'" class="tab-count">{{ state.templates.length }}</span></button></nav>

      <section v-if="tab === '总览'" class="content-grid overview-grid">
        <article class="panel account-panel"><div class="panel-heading"><div><span class="eyebrow">TIME ACCOUNT</span><h3>时间账户</h3></div><span class="panel-index">01 / 05</span></div><div class="account-number"><strong>{{ state.account.weeklyHours }}</strong><span>可配置小时 / 周</span></div><div class="meter"><span :style="{ width: `${Math.min(100, invested / state.account.weeklyHours * 100)}%` }"></span></div><div class="split-line"><span>已配置 <b>{{ invested.toFixed(1) }}h</b></span><span>剩余 <b>{{ Math.max(0, state.account.weeklyHours - invested).toFixed(1) }}h</b></span></div><div class="account-form"><label>每日可支配<input v-model.number="accountDraft.dailyHours" type="number" min="1" step="0.5" />小时</label><label>每周可配置<input v-model.number="accountDraft.weeklyHours" type="number" min="1" step="1" />小时</label><button class="primary-button" type="button" @click="updateAccount">更新账户 →</button></div></article>
        <article class="panel score-panel"><div class="panel-heading"><div><span class="eyebrow">PORTFOLIO HEALTH</span><h3>组合健康度</h3></div><span class="panel-index">02 / 05</span></div><div class="score-layout"><div class="score-ring" :style="{ '--score': `${Math.min(100, score * 20)}%` }"><div><strong>{{ score }}</strong><span>/ 10</span></div></div><div><p class="score-label">复利潜力良好</p><p class="muted">基于 {{ state.records.length }} 笔投资记录与各资产类别的历史回报估算。</p><div class="legend-list"><span><i class="dot green"></i>配置平衡</span><span><i class="dot yellow"></i>可继续优化</span></div></div></div></article>
        <article class="panel chart-panel"><div class="panel-heading"><div><span class="eyebrow">ALLOCATION MAP</span><h3>时间资产配置</h3></div><button class="text-button" type="button" @click="tab = '组合'">查看组合 →</button></div><div class="allocation-layout"><div class="donut" :style="{ background: `conic-gradient(${metrics.map((item) => `${item.color} ${item.share * 100}%`).join(', ')})` }"><div><strong>{{ Math.round(invested) }}</strong><span>hours</span></div></div><div class="metric-list"><div v-for="item in metrics" :key="item.category" class="metric-row"><i class="category-symbol" :style="{ color: item.color }">{{ item.icon }}</i><span>{{ item.category }}</span><strong>{{ item.hours.toFixed(1) }}h</strong><small>{{ Math.round(item.share * 100) }}%</small></div></div></div></article>
        <article class="panel ledger-panel"><div class="panel-heading"><div><span class="eyebrow">RECENT ACTIVITY</span><h3>最近投资</h3></div><button class="text-button" type="button" @click="tab = '记录'">全部记录 →</button></div><div class="activity-list"><div v-for="item in recent" :key="item.id" class="activity-row"><span class="activity-icon" :style="{ background: CATEGORY_META[item.category].color }">{{ CATEGORY_META[item.category].icon }}</span><div><strong>{{ item.note }}</strong><small>{{ item.category }} · {{ new Date(item.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) }}</small></div><b>+{{ item.hours }}h</b></div></div></article>
      </section>

      <section v-else-if="tab === '记录'" class="content-grid record-grid"><article class="panel form-panel"><div class="panel-heading"><div><span class="eyebrow">NEW INVESTMENT</span><h3>记录一笔时间</h3></div><span class="panel-index">02 / 05</span></div><p class="muted intro">每一次记录，都是在告诉未来的自己：这段时间值得。</p><label>投资到<select v-model="draft.category"><option v-for="item in CATEGORIES" :key="item" :value="item">{{ item }} · {{ CATEGORY_META[item].label }}</option></select></label><label>投入小时<input v-model.number="draft.hours" type="number" min="0.5" step="0.5" /></label><label>这段时间做了什么<textarea v-model="draft.note" rows="4" placeholder="例如：完成了季度复盘"></textarea></label><button class="primary-button full-button" type="button" @click="addRecord">确认入账 →</button><p class="notice">{{ notice }}</p></article><article class="panel table-panel"><div class="panel-heading"><div><span class="eyebrow">INVESTMENT LEDGER</span><h3>投资流水</h3></div><span class="total-pill">{{ state.records.length }} 笔记录</span></div><div class="ledger-table"><div class="table-head"><span>资产类别</span><span>备注</span><span>小时</span><span>日期</span><span></span></div><div v-for="item in ledger" :key="item.id" class="table-row"><span class="category-cell"><i :style="{ color: CATEGORY_META[item.category].color }">{{ CATEGORY_META[item.category].icon }}</i>{{ item.category }}</span><span>{{ item.note }}</span><strong>{{ item.hours }}h</strong><span>{{ new Date(item.date).toLocaleDateString('zh-CN') }}</span><button class="delete-button" type="button" title="删除记录" @click="removeRecord(item.id)">×</button></div></div></article></section>

      <section v-else-if="tab === '模板'" class="content-grid template-grid"><article class="panel form-panel template-builder"><div class="panel-heading"><div><span class="eyebrow">WEEKLY TEMPLATE</span><h3>新建周度模板</h3></div><span class="panel-index">TPL / 01</span></div><p class="muted intro">把每周重复的时间投入组合存成模板，新一周一键入账。</p><label>模板名称<input v-model="templateDraft.name" type="text" placeholder="例如：标准工作周" /></label><div class="template-items"><div class="template-item-head"><span>资产类别</span><span>小时</span><span>备注</span><span></span></div><div v-for="(item, index) in templateDraft.items" :key="index" class="template-item-row"><select v-model="item.category"><option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option></select><input v-model.number="item.hours" type="number" min="0.5" step="0.5" /><input v-model="item.note" type="text" placeholder="这段时间做什么" /><button class="delete-button" type="button" title="移除这一类" :disabled="templateDraft.items.length <= 1" @click="removeTemplateItem(index)">×</button></div></div><button class="add-item-button" type="button" @click="addTemplateItem">＋ 添加一类投入</button><div class="template-builder-foot"><span class="template-total">合计 <b>{{ templateDraftTotal.toFixed(1) }}h</b> / 周预算 {{ state.account.weeklyHours }}h</span><button class="primary-button" type="button" @click="saveTemplate">保存模板 →</button></div><p class="notice">{{ notice }}</p></article><article class="panel template-list-panel"><div class="panel-heading"><div><span class="eyebrow">SAVED TEMPLATES</span><h3>已存模板</h3></div><span class="total-pill">{{ state.templates.length }} 套模板</span></div><p v-if="!state.templates.length" class="empty-tip">还没有保存任何模板。在左侧组合常用的每周投入，保存后即可一键套用。</p><div class="template-list"><div v-for="tpl in state.templates" :key="tpl.id" class="template-card"><div class="template-card-head"><strong>{{ tpl.name }}</strong><span>{{ templateTotal(tpl).toFixed(1) }}h / 周</span></div><div class="template-chips"><span v-for="(item, i) in tpl.items" :key="i" class="template-chip"><i :style="{ color: CATEGORY_META[item.category].color }">{{ CATEGORY_META[item.category].icon }}</i>{{ item.category }} · {{ item.hours }}h</span></div><div class="template-card-foot"><small>{{ tpl.items.length }} 类投入 · 超出周预算时套用会先提示</small><div class="template-card-actions"><button class="text-button" type="button" @click="requestApply(tpl)">套用 →</button><button class="delete-button" type="button" title="删除模板" @click="removeTemplate(tpl.id)">×</button></div></div></div></div></article></section>

      <section v-else-if="tab === '组合'" class="content-grid portfolio-grid"><article class="panel wide-panel"><div class="panel-heading"><div><span class="eyebrow">ASSET ALLOCATION</span><h3>投资组合</h3></div><span class="panel-index">03 / 05</span></div><div class="portfolio-cards"><div v-for="item in metrics" :key="item.category" class="portfolio-card" :style="{ '--category-color': item.color }"><div class="portfolio-card-top"><span class="portfolio-icon">{{ item.icon }}</span><span>{{ Math.round(item.share * 100) }}%</span></div><h4>{{ item.category }}</h4><p>{{ CATEGORY_META[item.category].label }}</p><div class="mini-meter"><i :style="{ width: `${Math.min(100, item.share * 200)}%` }"></i></div><div class="portfolio-card-foot"><strong>{{ item.hours.toFixed(1) }}h</strong><span>ROI {{ item.roi.toFixed(2) }}x</span></div></div></div></article><article class="panel balance-panel"><div class="panel-heading"><div><span class="eyebrow">LIFE BALANCE SHEET</span><h3>人生资产负债表</h3></div><span class="panel-index">04 / 05</span></div><div class="balance-figure"><div><span>时间资产</span><strong>{{ sheet.assets }} <small>价值点</small></strong></div><div><span>未配置负债</span><strong class="liability">{{ sheet.liabilities }} <small>小时</small></strong></div><div class="balance-total"><span>净人生资产</span><strong>{{ sheet.equity }}</strong></div></div></article></section>

      <section v-else class="content-grid analysis-grid"><article class="panel suggestions-panel"><div class="panel-heading"><div><span class="eyebrow">REBALANCE SIGNALS</span><h3>配置优化建议</h3></div><span class="panel-index">05 / 05</span></div><div class="suggestion-list"><div v-for="(tip, index) in tips" :key="tip" class="suggestion"><span>0{{ index + 1 }}</span><p>{{ tip }}</p><b>→</b></div></div></article><article class="panel roi-panel"><div class="panel-heading"><div><span class="eyebrow">RETURN ON INVESTMENT</span><h3>时间 ROI 分析</h3></div></div><div class="roi-list"><div v-for="item in metrics" :key="item.category" class="roi-row"><div class="roi-name"><i :style="{ background: item.color }"></i><span>{{ item.category }}</span></div><div class="roi-bar"><span :style="{ width: `${item.roi / 2.5 * 100}%`, background: item.color }"></span></div><strong>{{ item.roi.toFixed(2) }}x</strong></div></div><p class="footnote">ROI 是基于精力恢复、能力复利、关系质量与长期机会成本的个人化估算，不代表财务回报。</p></article></section>
      <p v-if="notice && tab !== '记录' && tab !== '模板'" class="toast">{{ notice }}</p>
    </main>
    <div v-if="pendingTemplate" class="dialog-mask" @click.self="cancelApply">
      <div class="dialog" role="dialog" aria-modal="true" aria-label="套用确认">
        <span class="eyebrow">OVER BUDGET / 套用确认</span>
        <h3>模板超出本周预算</h3>
        <p>「{{ pendingTemplate.name }}」合计 <b>{{ templateTotal(pendingTemplate).toFixed(1) }}h</b>，超过本周预算 {{ state.account.weeklyHours }}h；当前实际剩余 <b>{{ remainingHours.toFixed(1) }}h</b>。</p>
        <p class="muted">按实际剩余生成：各类投入等比压缩（最小单位 0.5h），合计不超过 {{ remainingHours.toFixed(1) }}h；或整单取消，不生成任何记录。</p>
        <p v-if="remainingHours < 0.5" class="dialog-warning">本周已无剩余可配置时间，只能整单取消。</p>
        <div class="dialog-actions"><button class="ghost-button dialog-cancel" type="button" @click="cancelApply">整单取消</button><button class="primary-button" type="button" :disabled="remainingHours < 0.5" @click="confirmFitApply">按实际剩余生成 →</button></div>
      </div>
    </div>
  </div>
</template>
