<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { LocalTimeRepository } from '../adapters/local-time.repository';
import { CATEGORIES, CATEGORY_META, type TemplateItem, type TimeCategory, type WeeklyTemplate } from '../core/models';
import { balanceSheet, createTemplate, metricsFor, normalizeTemplate, planTemplateApply, portfolioScore, record, recordsFromPlan, remainingHours, sampleSnapshot, suggestions, templateTotal, totalInvested, type TemplateApplyPlan } from '../core/time-engine';

const repo = new LocalTimeRepository();
const tab = ref<'总览' | '记录' | '模板' | '组合' | '分析'>('总览');
const notice = ref('');
const state = reactive(repo.load());
if (!state.templates) state.templates = [];
const accountDraft = reactive({ dailyHours: state.account.dailyHours, weeklyHours: state.account.weeklyHours });
const draft = reactive({ category: '事业' as TimeCategory, hours: 2, note: '' });
const metrics = computed(() => metricsFor(state.records));
const invested = computed(() => totalInvested(state.records));
const remaining = computed(() => remainingHours(state.records, state.account));
const score = computed(() => portfolioScore(metrics.value, state.account));
const sheet = computed(() => balanceSheet(metrics.value, state.account));
const tips = computed(() => suggestions(metrics.value, state.account));
const recent = computed(() => [...state.records].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5));
const ledger = computed(() => [...state.records].sort((a, b) => b.date.localeCompare(a.date)));

function save() { repo.save({ account: state.account, records: state.records, templates: state.templates }); }
function updateAccount() { state.account.dailyHours = Math.max(1, Number(accountDraft.dailyHours) || 1); state.account.weeklyHours = Math.max(1, Number(accountDraft.weeklyHours) || 1); state.account.updatedAt = new Date().toISOString(); save(); notice.value = '时间账户已更新'; }
function addRecord() { state.records.unshift(record(draft.category, draft.hours, draft.note)); save(); draft.note = ''; notice.value = '一笔时间投资已入账'; tab.value = '记录'; }
function saveDraftAsTemplate() {
  const note = draft.note.trim() || `${draft.category}周投入`;
  const template = createTemplate(`${draft.category} · 周投入`, [{ category: draft.category, hours: Math.max(0.5, Number(draft.hours) || 0.5), note }]);
  state.templates!.unshift(template);
  save();
  startEdit(template);
  notice.value = '已把这笔投入存为周度模板，可继续补充其他类别';
  tab.value = '模板';
}
function removeRecord(id: string) { state.records = state.records.filter((item) => item.id !== id); save(); }
function resetDemo() { const fresh = sampleSnapshot(); state.account = fresh.account; state.records = fresh.records; state.templates = fresh.templates; save(); notice.value = '已恢复初始示例组合'; }

/* ---------- 周度模板 ---------- */
interface EditorRow { uid: number; category: TimeCategory; hours: number | null; note: string }
let rowSeq = 0;
function newRow(): EditorRow { return { uid: ++rowSeq, category: '事业', hours: 1, note: '' }; }

const editingId = ref<string | null>(null);
const editor = reactive<{ name: string; rows: EditorRow[] }>({ name: '', rows: [] });
const editorTotal = computed(() => templateTotal(editor.rows
  .filter((row) => row.hours !== null && Number(row.hours) > 0)
  .map((row) => ({ category: row.category, hours: Number(row.hours), note: row.note }))));
const editorOverflow = computed(() => editorTotal.value > remaining.value + 0.001);
const editingTemplate = computed(() => state.templates!.find((item) => item.id === editingId.value) ?? null);

function startCreate() {
  editingId.value = null;
  editor.name = '';
  editor.rows = [
    { uid: ++rowSeq, category: '健康', hours: 3, note: '' },
    { uid: ++rowSeq, category: '学习', hours: 2, note: '' },
    newRow(),
  ];
}
function startEdit(template: WeeklyTemplate) {
  editingId.value = template.id;
  editor.name = template.name;
  editor.rows = template.items.map((item) => ({ uid: ++rowSeq, category: item.category, hours: item.hours, note: item.note }));
}
function addEditorRow() { editor.rows.push(newRow()); }
function removeEditorRow(uid: number) { editor.rows = editor.rows.filter((row) => row.uid !== uid); }
function closeEditor() { editingId.value = null; editor.name = ''; editor.rows = []; }
function saveTemplate() {
  const items: TemplateItem[] = editor.rows
    .map((row) => ({ category: row.category, hours: Number(row.hours) || 0, note: row.note }));
  const normalized = normalizeTemplate(editor.name, items);
  if (!normalized.items.length) { notice.value = '请至少填写一项不小于 0.5 小时的投入'; return; }
  if (editingId.value) {
    const target = state.templates!.find((item) => item.id === editingId.value);
    if (target) { target.name = normalized.name; target.items = normalized.items; target.updatedAt = new Date().toISOString(); }
    notice.value = '周度模板已更新';
  } else {
    state.templates!.unshift(createTemplate(normalized.name, normalized.items));
    notice.value = '周度模板已保存';
  }
  save();
  closeEditor();
}
function removeTemplate(id: string) {
  state.templates = state.templates!.filter((item) => item.id !== id);
  if (editingId.value === id) closeEditor();
  save();
  notice.value = '模板已删除';
}

/* ---------- 套用模板：溢出时当场选择 ---------- */
const pendingPlan = ref<TemplateApplyPlan | null>(null);
function applyTemplate(template: WeeklyTemplate) {
  const plan = planTemplateApply(template, state.records, state.account);
  if (!plan.overflow) {
    state.records.unshift(...recordsFromPlan(plan));
    save();
    notice.value = `已按「${template.name}」一次性入账 ${plan.plannedHours.toFixed(1)} 小时`;
    tab.value = '记录';
    return;
  }
  pendingPlan.value = plan;
}
function cancelApply() { pendingPlan.value = null; }
function confirmApplyWithRemaining() {
  const plan = pendingPlan.value;
  if (!plan) return;
  state.records.unshift(...recordsFromPlan(plan));
  save();
  const skipped = plan.entries.filter((entry) => entry.status === 'skipped').length;
  notice.value = skipped
    ? `已按剩余预算从「${plan.template.name}」入账 ${plan.plannedHours.toFixed(1)} 小时，${skipped} 项未生成`
    : `已按剩余预算从「${plan.template.name}」入账 ${plan.plannedHours.toFixed(1)} 小时`;
  pendingPlan.value = null;
  tab.value = '记录';
}

onMounted(startCreate);
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
      <nav class="tabs" aria-label="功能模块"><button v-for="item in ['总览', '记录', '模板', '组合', '分析']" :key="item" type="button" :class="{ active: tab === item }" @click="tab = item as typeof tab">{{ item }}<span v-if="item === '记录'" class="tab-count">{{ state.records.length }}</span><span v-else-if="item === '模板'" class="tab-count">{{ state.templates?.length ?? 0 }}</span></button></nav>

      <section v-if="tab === '总览'" class="content-grid overview-grid">
        <article class="panel account-panel"><div class="panel-heading"><div><span class="eyebrow">TIME ACCOUNT</span><h3>时间账户</h3></div><span class="panel-index">01 / 06</span></div><div class="account-number"><strong>{{ state.account.weeklyHours }}</strong><span>可配置小时 / 周</span></div><div class="meter"><span :style="{ width: `${Math.min(100, invested / state.account.weeklyHours * 100)}%` }"></span></div><div class="split-line"><span>已配置 <b>{{ invested.toFixed(1) }}h</b></span><span>剩余 <b>{{ Math.max(0, state.account.weeklyHours - invested).toFixed(1) }}h</b></span></div><div class="account-form"><label>每日可支配<input v-model.number="accountDraft.dailyHours" type="number" min="1" step="0.5" />小时</label><label>每周可配置<input v-model.number="accountDraft.weeklyHours" type="number" min="1" step="1" />小时</label><button class="primary-button" type="button" @click="updateAccount">更新账户 →</button></div></article>
        <article class="panel score-panel"><div class="panel-heading"><div><span class="eyebrow">PORTFOLIO HEALTH</span><h3>组合健康度</h3></div><span class="panel-index">02 / 06</span></div><div class="score-layout"><div class="score-ring" :style="{ '--score': `${Math.min(100, score * 20)}%` }"><div><strong>{{ score }}</strong><span>/ 10</span></div></div><div><p class="score-label">复利潜力良好</p><p class="muted">基于 {{ state.records.length }} 笔投资记录与各资产类别的历史回报估算。</p><div class="legend-list"><span><i class="dot green"></i>配置平衡</span><span><i class="dot yellow"></i>可继续优化</span></div></div></div></article>
        <article class="panel chart-panel"><div class="panel-heading"><div><span class="eyebrow">ALLOCATION MAP</span><h3>时间资产配置</h3></div><button class="text-button" type="button" @click="tab = '组合'">查看组合 →</button></div><div class="allocation-layout"><div class="donut" :style="{ background: `conic-gradient(${metrics.map((item) => `${item.color} ${item.share * 100}%`).join(', ')})` }"><div><strong>{{ Math.round(invested) }}</strong><span>hours</span></div></div><div class="metric-list"><div v-for="item in metrics" :key="item.category" class="metric-row"><i class="category-symbol" :style="{ color: item.color }">{{ item.icon }}</i><span>{{ item.category }}</span><strong>{{ item.hours.toFixed(1) }}h</strong><small>{{ Math.round(item.share * 100) }}%</small></div></div></div></article>
        <article class="panel ledger-panel"><div class="panel-heading"><div><span class="eyebrow">RECENT ACTIVITY</span><h3>最近投资</h3></div><button class="text-button" type="button" @click="tab = '记录'">全部记录 →</button></div><div class="activity-list"><div v-for="item in recent" :key="item.id" class="activity-row"><span class="activity-icon" :style="{ background: CATEGORY_META[item.category].color }">{{ CATEGORY_META[item.category].icon }}</span><div><strong>{{ item.note }}</strong><small>{{ item.category }} · {{ new Date(item.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) }}</small></div><b>+{{ item.hours }}h</b></div></div></article>
      </section>

      <section v-else-if="tab === '记录'" class="content-grid record-grid"><article class="panel form-panel"><div class="panel-heading"><div><span class="eyebrow">NEW INVESTMENT</span><h3>记录一笔时间</h3></div><span class="panel-index">02 / 06</span></div><p class="muted intro">每一次记录，都是在告诉未来的自己：这段时间值得。</p><div class="ledger-budget"><span>本周预算 <b>{{ state.account.weeklyHours }}h</b></span><span>已配置 <b>{{ invested.toFixed(1) }}h</b></span><span class="remain">剩余 <b>{{ remaining.toFixed(1) }}h</b></span></div><label>投资到<select v-model="draft.category"><option v-for="item in CATEGORIES" :key="item" :value="item">{{ item }} · {{ CATEGORY_META[item].label }}</option></select></label><label>投入小时<input v-model.number="draft.hours" type="number" min="0.5" step="0.5" /></label><label>这段时间做了什么<textarea v-model="draft.note" rows="4" placeholder="例如：完成了季度复盘"></textarea></label><button class="primary-button full-button" type="button" @click="addRecord">确认入账 →</button><button class="ghost-line-button full-button" type="button" @click="saveDraftAsTemplate">＋ 把这笔投入存为周度模板</button><p class="notice">{{ notice }}</p></article><article class="panel table-panel"><div class="panel-heading"><div><span class="eyebrow">INVESTMENT LEDGER</span><h3>投资流水</h3></div><span class="total-pill">{{ state.records.length }} 笔记录</span></div><div class="ledger-table"><div class="table-head"><span>资产类别</span><span>备注</span><span>小时</span><span>日期</span><span></span></div><div v-for="item in ledger" :key="item.id" class="table-row"><span class="category-cell"><i :style="{ color: CATEGORY_META[item.category].color }">{{ CATEGORY_META[item.category].icon }}</i>{{ item.category }}</span><span>{{ item.note }}</span><strong>{{ item.hours }}h</strong><span>{{ new Date(item.date).toLocaleDateString('zh-CN') }}</span><button class="delete-button" type="button" title="删除记录" @click="removeRecord(item.id)">×</button></div></div></article></section>

      <section v-else-if="tab === '模板'" class="content-grid template-grid">
        <article class="panel template-editor-panel">
          <div class="panel-heading"><div><span class="eyebrow">{{ editingTemplate ? 'EDIT TEMPLATE' : 'NEW TEMPLATE' }}</span><h3>{{ editingTemplate ? '编辑周度模板' : '新建周度模板' }}</h3></div><button v-if="editingTemplate" class="text-button" type="button" @click="startCreate">＋ 另建新模板</button></div>
          <p class="muted intro">把每周固定要做的投入存成模板，下周一键套用，当周记录一次生成。</p>
          <label class="template-name-label">模板名称<input v-model="editor.name" type="text" placeholder="例如：稳健基础周" /></label>
          <div class="editor-items">
            <div v-for="row in editor.rows" :key="row.uid" class="editor-item">
              <select v-model="row.category"><option v-for="item in CATEGORIES" :key="item" :value="item">{{ item }}</option></select>
              <input v-model.number="row.hours" type="number" min="0" step="0.5" class="editor-hours" />
              <span class="editor-unit">h</span>
              <input v-model="row.note" type="text" class="editor-note" placeholder="备注，如：力量训练" />
              <button class="delete-button" type="button" title="删除该项" @click="removeEditorRow(row.uid)">×</button>
            </div>
          </div>
          <button class="text-button add-item-button" type="button" @click="addEditorRow">＋ 增加一类投入</button>
          <div class="editor-foot">
            <div class="editor-summary"><span>合计 <b :class="{ over: editorOverflow }">{{ editorTotal.toFixed(1) }}h</b></span><span>本周剩余 <b>{{ remaining.toFixed(1) }}h</b></span><small v-if="editorOverflow" class="over-text">合计已超过当周剩余预算，套用时会先与你确认。</small></div>
            <div class="editor-actions"><button v-if="editingTemplate" class="ghost-line-button" type="button" @click="startCreate">取消编辑</button><button class="primary-button" type="button" @click="saveTemplate">{{ editingTemplate ? '保存修改 →' : '保存模板 →' }}</button></div>
          </div>
        </article>
        <article class="panel template-list-panel">
          <div class="panel-heading"><div><span class="eyebrow">WEEKLY TEMPLATES</span><h3>我的周度模板</h3></div><span class="total-pill">{{ state.templates?.length ?? 0 }} 个模板</span></div>
          <div v-if="!state.templates?.length" class="template-empty">还没有模板，在左侧把固定投入组合保存下来吧。</div>
          <p v-if="notice" class="notice template-notice">{{ notice }}</p>
          <div v-else class="template-cards">
            <div v-for="tpl in state.templates" :key="tpl.id" class="template-card" :class="{ active: editingId === tpl.id }">
              <div class="template-card-head"><strong>{{ tpl.name }}</strong><span class="template-sum">{{ templateTotal(tpl.items).toFixed(1) }}h</span></div>
              <div class="template-items"><span v-for="(item, index) in tpl.items" :key="index"><i :style="{ color: CATEGORY_META[item.category].color }">{{ CATEGORY_META[item.category].icon }}</i>{{ item.category }} {{ item.hours }}h</span></div>
              <div class="template-card-actions"><button class="primary-button" type="button" @click="applyTemplate(tpl)">一键套用 →</button><button class="ghost-line-button" type="button" @click="startEdit(tpl)">编辑</button><button class="ghost-button danger" type="button" @click="removeTemplate(tpl.id)">删除</button></div>
            </div>
          </div>
        </article>
      </section>

      <section v-else-if="tab === '组合'" class="content-grid portfolio-grid"><article class="panel wide-panel"><div class="panel-heading"><div><span class="eyebrow">ASSET ALLOCATION</span><h3>投资组合</h3></div><span class="panel-index">04 / 06</span></div><div class="portfolio-cards"><div v-for="item in metrics" :key="item.category" class="portfolio-card" :style="{ '--category-color': item.color }"><div class="portfolio-card-top"><span class="portfolio-icon">{{ item.icon }}</span><span>{{ Math.round(item.share * 100) }}%</span></div><h4>{{ item.category }}</h4><p>{{ CATEGORY_META[item.category].label }}</p><div class="mini-meter"><i :style="{ width: `${Math.min(100, item.share * 200)}%` }"></i></div><div class="portfolio-card-foot"><strong>{{ item.hours.toFixed(1) }}h</strong><span>ROI {{ item.roi.toFixed(2) }}x</span></div></div></div></article><article class="panel balance-panel"><div class="panel-heading"><div><span class="eyebrow">LIFE BALANCE SHEET</span><h3>人生资产负债表</h3></div><span class="panel-index">05 / 06</span></div><div class="balance-figure"><div><span>时间资产</span><strong>{{ sheet.assets }} <small>价值点</small></strong></div><div><span>未配置负债</span><strong class="liability">{{ sheet.liabilities }} <small>小时</small></strong></div><div class="balance-total"><span>净人生资产</span><strong>{{ sheet.equity }}</strong></div></div></article></section>

      <section v-else class="content-grid analysis-grid"><article class="panel suggestions-panel"><div class="panel-heading"><div><span class="eyebrow">REBALANCE SIGNALS</span><h3>配置优化建议</h3></div><span class="panel-index">06 / 06</span></div><div class="suggestion-list"><div v-for="(tip, index) in tips" :key="tip" class="suggestion"><span>0{{ index + 1 }}</span><p>{{ tip }}</p><b>→</b></div></div></article><article class="panel roi-panel"><div class="panel-heading"><div><span class="eyebrow">RETURN ON INVESTMENT</span><h3>时间 ROI 分析</h3></div></div><div class="roi-list"><div v-for="item in metrics" :key="item.category" class="roi-row"><div class="roi-name"><i :style="{ background: item.color }"></i><span>{{ item.category }}</span></div><div class="roi-bar"><span :style="{ width: `${item.roi / 2.5 * 100}%`, background: item.color }"></span></div><strong>{{ item.roi.toFixed(2) }}x</strong></div></div><p class="footnote">ROI 是基于精力恢复、能力复利、关系质量与长期机会成本的个人化估算，不代表财务回报。</p></article></section>
      <p v-if="notice && tab !== '记录' && tab !== '模板' && !pendingPlan" class="toast">{{ notice }}</p>

      <div v-if="pendingPlan" class="modal-overlay" @click.self="cancelApply">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="overflow-title">
          <div class="modal-head"><span class="eyebrow">BUDGET OVERFLOW</span><h3 id="overflow-title">模板小时超出本周预算</h3></div>
          <p class="muted">「{{ pendingPlan.template.name }}」合计 <b class="warn-text">{{ pendingPlan.totalHours.toFixed(1) }}h</b>，本周仅剩 <b class="warn-text">{{ pendingPlan.remaining.toFixed(1) }}h</b>（已配置 {{ pendingPlan.alreadyInvested.toFixed(1) }}h / 预算 {{ pendingPlan.weeklyHours }}h）。请选择处理方式：</p>
          <div class="plan-list">
            <div v-for="(entry, index) in pendingPlan.entries" :key="index" class="plan-row" :class="entry.status">
              <span class="plan-cat"><i :style="{ color: CATEGORY_META[entry.category].color }">{{ CATEGORY_META[entry.category].icon }}</i>{{ entry.category }}</span>
              <span class="plan-note">{{ entry.note || '未命名投资' }}</span>
              <span class="plan-hours"><template v-if="entry.status === 'full'">{{ entry.hours }}h 足额</template><template v-else-if="entry.status === 'partial'"><s>{{ entry.hours }}h</s> → {{ entry.plannedHours.toFixed(1) }}h 截断</template><template v-else><s>{{ entry.hours }}h</s> 跳过</template></span>
            </div>
          </div>
          <p class="plan-tip">按实际剩余生成：将依模板顺序填满剩余 {{ pendingPlan.remaining.toFixed(1) }}h，超出的条目截断或跳过，预计生成 {{ pendingPlan.plannedHours.toFixed(1) }}h；整单取消则不产生任何记录。<template v-if="pendingPlan.plannedHours === 0">本周剩余预算为 0，选择“按实际剩余生成”不会新增记录，建议整单取消。</template></p>
          <div class="modal-actions">
            <button class="ghost-line-button" type="button" @click="cancelApply">整单取消</button>
            <button class="primary-button" type="button" @click="confirmApplyWithRemaining">按实际剩余生成（{{ pendingPlan.plannedHours.toFixed(1) }}h）→</button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
