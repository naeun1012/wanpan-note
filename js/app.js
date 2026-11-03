'use strict';

/* ===== 상품 데이터 =====
 * data/wanpan-products.json의 대표 상품 목록을 불러옵니다.
 * productCodes·scriptStatus: 원본 정보로 보존하며 화면에는 표시하지 않습니다. (scriptStatus는 호환성 유지용)
 * 보장내용·약관 내용은 이 앱에서 생성하지 않습니다.
 */
const PRODUCTS_URL = 'data/wanpan-products.json';
const LOAD_FAILED_TEXT = '상품 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침해 주세요.';
let products = [];
let productsLoadFailed = false;

/* ===== 고객 설명 체크리스트 (승인 자료 전용) =====
 * 승인된 고객 설명자료만 연결합니다. 승인 자료가 제공되기 전까지 비워 둡니다.
 * 연결 형식: {
 *   productId, productCode, approvalId, approvalStatus, effectiveDate, suspended, version,
 *   baseDate, source, requiredNotices: [문구],
 *   items: [{ id, title, summary, detail, images: [{ src, alt, source }] }]   (이전 형식 { id, text }도 지원)
 * }
 *   - productId: 상품 id, productCode: 해당 판매버전 코드(productCodes 중 하나)
 *   - approvalId: 승인 이력 식별값, approvalStatus: 'approved'일 때만 노출 대상
 *   - effectiveDate: 적용일(YYYY-MM-DD). 미래이면 비노출, suspended: true면 비노출
 *   - baseDate / source: 자료 기준일·출처 (있으면 이미지에 함께 표시)
 */
const approvedChecklists = [];

function todayStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// 운영 노출 조건: 승인 완료 + 적용일 도래 + 사용 중지 아님 + 항목 존재
function isChecklistActive(entry) {
  return Boolean(entry)
    && entry.approvalStatus === 'approved'
    && !entry.suspended
    && (!entry.effectiveDate || entry.effectiveDate <= todayStamp())
    && Array.isArray(entry.items) && entry.items.length > 0;
}

function getApprovedChecklistEntry(product) {
  return approvedChecklists.find((checklist) => checklist.productId === product.id && isChecklistActive(checklist)) || null;
}

function getApprovedChecklist(product) {
  const entry = getApprovedChecklistEntry(product);
  return entry ? entry.items : [];
}

/* ===== 개발 미리보기 판별 (시연용 데이터 자동 표시) =====
 * 아래 두 조건을 모두 만족하는 '개발 미리보기'에서만 시연 데이터를 자동으로 표시합니다.
 *   1) 주소: 이 PC(localhost·127.0.0.1) 또는 같은 Wi-Fi 사설 IP(10.x, 172.16~31.x, 192.168.x)
 *   2) 포트: 개발 미리보기 서버 포트(DEV_PREVIEW_PORTS — .claude/launch.json의 8080·8090)
 *   예: http://localhost:8080/#/product/product-011, http://(PC 사설 IP):8090/#/product/product-011
 * 도메인 주소나 기본 포트(80·443)로 배포된 운영 환경에서는 자동으로 꺼집니다.
 * 개발 미리보기에서 운영 화면처럼 보려면 주소에 ?dev=0 을 붙입니다.
 * 시연용 데이터는 data/demo-driver-checklist.json에서만 불러오며, 공식 승인자료가 아니므로
 * 운영 체크리스트(approvedChecklists)에 섞지 않고 이미지 저장·공유·다운로드 대상에서도 제외합니다.
 */
const DEV_HOST_PATTERN = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;
const DEV_PREVIEW_PORTS = ['8080', '8090'];

function isDevPreview(loc) {
  return DEV_HOST_PATTERN.test(loc.hostname)
    && DEV_PREVIEW_PORTS.includes(loc.port)
    && new URLSearchParams(loc.search).get('dev') !== '0';
}

const DEV_MODE = isDevPreview(location);
// 2026-10-30 사용자 결정(v1.0 GitHub Pages 배포, 회사 내부 사용·외부 호스팅 확인 전제):
// 검증 전 설명자료(상품별·담보별 안내, 학습용 이미지 저장)를 운영 화면에도 표시. false로 바꾸면 개발 미리보기 전용으로 복귀
// 시연(DEMO)·15종 색인·그룹 초안은 계속 개발 미리보기 전용
const PUBLISH_DRAFT_CONTENT = true;
const SHOW_DRAFT_CONTENT = DEV_MODE || PUBLISH_DRAFT_CONTENT;
// 2026-10-30 사용자 결정: 화면 배너·검증 전 표시와 저장 이미지의 사용 제한 표시를 숨김 (다시 표시하려면 true)
// 검증 전 자료를 개발 미리보기에서만 불러오는 동작은 그대로 유지
const SHOW_REVIEW_LABELS = false;
const DEMO_CHECKLISTS_URL = 'data/demo-driver-checklist.json';
// 시연 대상 상품 (뉴하이카운전자상해보험) — 이 목록 밖의 상품에는 시연 데이터가 있어도 표시하지 않음
const DEMO_TARGET_PRODUCT_IDS = ['product-011'];
let demoChecklists = [];

async function loadDemoChecklists() {
  if (!DEV_MODE) return;
  try {
    const response = await fetch(DEMO_CHECKLISTS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    demoChecklists = (Array.isArray(data.checklists) ? data.checklists : [])
      .filter((entry) => entry && entry.isDemo === true && entry.status === 'DEMO'
        && DEMO_TARGET_PRODUCT_IDS.includes(entry.productId) && Array.isArray(entry.items))
      .map((entry) => ({
        ...entry,
        items: [...entry.items].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)),
      }));
  } catch (error) {
    demoChecklists = [];
    console.warn('시연용 체크리스트를 불러오지 못했습니다.', error);
  }
}

function getDemoChecklistEntry(product) {
  if (!DEV_MODE) return null;
  return demoChecklists.find((entry) => entry.productId === product.id) || null;
}

/* ===== 15종 자료 설명 주제 색인 (검증 전 참고자료 · 개발 미리보기 전용) =====
 * data/wanpan-reference-topics-15.json은 승인되지 않은 '설명 주제 이름' 색인입니다.
 * 보장내용·조건을 담고 있지 않으며, 이 앱에서도 내용을 만들지 않습니다.
 * - 개발 미리보기(DEV_MODE)에서만 불러오고, 운영 환경에서는 요청하지 않습니다.
 * - 상품 연결은 상품코드 일치 또는 '띄어쓰기를 뺀 상품명'이 정확히 같을 때만 합니다.
 * - 승인 상태는 읽기만 하며 변경하지 않습니다. (모든 항목을 검증 전 자료로 표시)
 */
const REFERENCE_TOPICS_URL = 'data/wanpan-reference-topics-15.json';
const REFERENCE_PENDING_TEXT = '최신 약관 및 승인 설명자료 확인 필요';

const PENDING_SUMMARY_TEXT = '승인된 설명 문구를 준비 중입니다.';

let referenceRecords = [];

function isValidDate(text) {
  return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text);
}

// 구조가 예상과 다르면 전체를 쓰지 않음 (임의 보완하지 않음)
function validateReferenceData(data) {
  const errors = [];
  if (!data || data.dataset_type !== 'reference_topic_index') errors.push('dataset_type');
  const list = data && Array.isArray(data.products) ? data.products : null;
  if (!list) errors.push('products');
  if (list && data.record_count !== list.length) errors.push('record_count');
  (list || []).forEach((record, index) => {
    const ok = record && Number.isInteger(record.source_index) && typeof record.source_title === 'string'
      && record.source_title.trim() && isValidDate(record.source_date)
      && Array.isArray(record.topics) && record.topics.length > 0
      && record.topics.every((topic) => typeof topic === 'string' && topic.trim());
    if (!ok) errors.push(`products[${index}]`);
  });
  return errors;
}

async function loadReferenceTopics() {
  if (!DEV_MODE) return;
  try {
    const response = await fetch(REFERENCE_TOPICS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const errors = validateReferenceData(data);
    if (errors.length) throw new Error(`자료 구조 확인 필요: ${errors.join(', ')}`);
    referenceRecords = data.products;
  } catch (error) {
    referenceRecords = [];
    console.warn('설명 주제 색인을 불러오지 못했습니다.', error);
  }
}

function compactName(text) {
  return String(text).replace(/\s+/g, '');
}

// 상품코드 일치 또는 띄어쓰기를 뺀 상품명이 정확히 같은 상품만
function findMatchedProducts(record) {
  return allItems.filter((item) => item.type === 'product' && (
    (record.product_code && Array.isArray(item.productCodes) && item.productCodes.includes(record.product_code))
    || compactName(item.name) === compactName(record.source_title)
  ));
}

// 상품별 안내 전용: 이 상품의 설명 항목 (설명 주제 → 핵심 설명 → 추가 설명 펼치기)
// 통합 초안의 게시 가능한 연결만 사용, 초안을 쓸 수 없으면 기존 방식(주제만 · 문구 '준비 중')
function getReferenceChecklistItems(product) {
  if (!SHOW_DRAFT_CONTENT) return [];
  if (coreExplanations.size) {
    return postedExplanationLinks
      .filter((link) => link.productId === product.id)
      .map((link) => {
        const entry = coreExplanations.get(link.explanationId);
        return {
          id: `${product.id}-${entry.id}`,
          title: entry.topic,
          summary: entry.coreExplanation,
          emphasis: getExplanationEmphasis(entry.id),
          detail: typeof entry.extraExplanation === 'string' && entry.extraExplanation.trim() ? entry.extraExplanation : '',
          explanation: entry,
        };
      });
  }
  // 그룹 정의가 있으면 그 매핑(정확 일치·후보)을 사용, 없으면 기존 정확 일치 방식
  if (productGroups) {
    return productGroups.productItems
      .filter((entry) => entry.productId === product.id)
      .flatMap((entry) => entry.topicIds.map((topicId, index) => ({
        id: `ref-${entry.sourceIndex}-${index}`,
        title: productGroups.topics.get(topicId).name,
        summary: PENDING_SUMMARY_TEXT,
        detail: `${REFERENCE_PENDING_TEXT}. (참고 자료: ${getSourceLabel(entry.sourceIndex)}${entry.matchType === 'CANDIDATE' ? ' · 매칭 확인 필요' : ''})`,
        matchType: entry.matchType,
      })));
  }
  const items = [];
  referenceRecords.forEach((record) => {
    if (!findMatchedProducts(record).some((item) => item.id === product.id)) return;
    record.topics.forEach((label, index) => {
      items.push({
        id: `ref-${record.source_index}-${index}`,
        title: label,
        summary: PENDING_SUMMARY_TEXT,
        detail: `${REFERENCE_PENDING_TEXT}. (참고 자료: ${record.source_title}, 기준일 ${record.source_date})`,
      });
    });
  });
  return items;
}

/* ===== 담보별 안내 데이터 (상품별 안내와 독립 · 개발 미리보기 전용) =====
 * data/coverage-guides.json: 분류·주제 이름과 핵심/상세 설명 자리만 있고 상품 정보는 없습니다.
 * 설명 문구(summary·detail)는 승인 자료가 확보되면 이 파일에 넣으며, 비어 있으면 '준비 중'으로 표시합니다.
 */
const COVERAGE_GUIDES_URL = 'data/coverage-guides.json';
const COVERAGE_PENDING_TEXT = '공식 설명자료 확인 후 업데이트 예정';
let coverageCategories = [];
let coverageTopics = [];

function validateCoverageGuides(data) {
  const errors = [];
  if (!data || data.dataset_type !== 'coverage_guide') errors.push('dataset_type');
  const categories = data && Array.isArray(data.categories) ? data.categories : null;
  const topics = data && Array.isArray(data.topics) ? data.topics : null;
  if (!categories) errors.push('categories');
  if (!topics) errors.push('topics');
  const categoryIds = new Set((categories || []).map((category) => category.id));
  const topicIds = new Set();
  (topics || []).forEach((topic, index) => {
    const ok = topic && typeof topic.id === 'string' && !topicIds.has(topic.id)
      && typeof topic.name === 'string' && topic.name.trim() && categoryIds.has(topic.categoryId);
    if (!ok) errors.push(`topics[${index}]`);
    if (topic && topic.id) topicIds.add(topic.id);
  });
  return errors;
}

async function loadCoverageGuides() {
  if (!SHOW_DRAFT_CONTENT) return;
  try {
    const response = await fetch(COVERAGE_GUIDES_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const errors = validateCoverageGuides(data);
    if (errors.length) throw new Error(`자료 구조 확인 필요: ${errors.join(', ')}`);
    const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0);
    coverageCategories = [...data.categories].sort(byOrder);
    coverageTopics = [...data.topics].sort(byOrder);
  } catch (error) {
    coverageCategories = [];
    coverageTopics = [];
    console.warn('담보별 안내 데이터를 불러오지 못했습니다.', error);
  }
}

/* ===== 통합 초안: 핵심 설명 30개 + 상품 연결 (개발 미리보기 전용) =====
 * data/wanpan-integrated-draft.json(사용자 제공, 앱에서 수정하지 않음)이 핵심 설명 문구의 유일한 원본입니다.
 * - 핵심 설명은 고유 ID(core-NNN)로만 참조 (상품별 안내: productExplanationLinks, 담보별 안내: coverage-guides.json의 explanationId)
 * - 상품 연결은 PUBLISHABLE_LINK_STATUSES에 있는 상태만 표시 (PROVISIONAL_REVIEW_REQUIRED 등은 자동 게시하지 않음)
 * - 문구 확인·약관 검증·회사 승인은 서로 다른 상태로 표시하며, 운영 환경에는 게시하지 않습니다.
 * - 상품 마스터는 data/wanpan-products.json을 기준으로 하고, 초안의 productMaster는 일치 여부만 점검합니다.
 */
const INTEGRATED_DRAFT_URL = 'data/wanpan-integrated-draft.json';
const PUBLISHABLE_LINK_STATUSES = ['SOURCE_TOPIC_MATCH_NEEDS_POLICY_VALIDATION'];
const EXPLANATION_STATUS_LABELS = {
  wordingStatus: { USER_CONFIRMED: '문구 사용자 확인', USER_REVIEW_DRAFT: '문구 사용자 검토 초안', LEARNING_REVIEW_DRAFT: '학습 설명 검토 초안' },
  policyVerification: { VERIFIED: '약관 검증 완료' },
  companyApproval: { APPROVED: '회사 승인 완료', CONFIRMED: '회사 승인 완료' },
};
const EXPLANATION_STATUS_FALLBACK = {
  wordingStatus: '문구 확인 전',
  policyVerification: '약관 검증 전',
  companyApproval: '회사 승인 전',
};
let integratedDraftRaw = null;
let coreExplanations = new Map(); // core-NNN → 핵심 설명
let postedExplanationLinks = []; // 게시 가능한 상품 연결만
let draftMasterMismatches = [];

async function loadIntegratedDraft() {
  if (!SHOW_DRAFT_CONTENT) return;
  try {
    const response = await fetch(INTEGRATED_DRAFT_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    integratedDraftRaw = await response.json();
  } catch (error) {
    integratedDraftRaw = null;
    console.warn('통합 초안을 불러오지 못했습니다.', error);
  }
}

function validateIntegratedDraft(data) {
  const errors = [];
  if (!data || data.dataset !== 'wanpan-integrated-draft') return ['dataset'];
  const ids = new Set();
  if (!Array.isArray(data.coreExplanations)) errors.push('coreExplanations');
  (Array.isArray(data.coreExplanations) ? data.coreExplanations : []).forEach((entry, index) => {
    const ok = entry && typeof entry.id === 'string' && !ids.has(entry.id)
      && typeof entry.topic === 'string' && entry.topic.trim()
      && typeof entry.coreExplanation === 'string' && entry.coreExplanation.trim();
    if (!ok) errors.push(`coreExplanations[${index}]`);
    if (entry && entry.id) ids.add(entry.id);
  });
  (Array.isArray(data.productExplanationLinks) ? data.productExplanationLinks : []).forEach((link, index) => {
    if (!link || typeof link.productId !== 'string' || !ids.has(link.explanationId) || typeof link.mappingStatus !== 'string') {
      errors.push(`productExplanationLinks[${index}]`);
    }
  });
  return errors;
}

function buildIntegratedDraft() {
  coreExplanations = new Map();
  postedExplanationLinks = [];
  draftMasterMismatches = [];
  if (!SHOW_DRAFT_CONTENT || !integratedDraftRaw) return;
  const errors = validateIntegratedDraft(integratedDraftRaw);
  if (errors.length) {
    console.warn('통합 초안 구조 확인 필요:', errors.join(', '));
    return;
  }
  coreExplanations = new Map(integratedDraftRaw.coreExplanations.map((entry) => [entry.id, entry]));
  // 활성 상품(삭제 처리되지 않은 상품)에 대한 게시 가능 연결만, 같은 상품·설명 중복은 1회
  const activeIds = new Set(allItems.filter((item) => item.type === 'product').map((item) => item.id));
  const seen = new Set();
  postedExplanationLinks = (integratedDraftRaw.productExplanationLinks || []).filter((link) => {
    const key = `${link.productId}|${link.explanationId}`;
    if (!PUBLISHABLE_LINK_STATUSES.includes(link.mappingStatus) || !activeIds.has(link.productId) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // 공통 체크리스트(data/common-checklists.json): 상품마다 같은 항목 목록을 ID로만 참조 (문구 복사 없음)
  getCommonChecklistLinks().forEach((link) => {
    const key = `${link.productId}|${link.explanationId}`;
    if (!activeIds.has(link.productId) || seen.has(key)) return;
    seen.add(key);
    postedExplanationLinks.push(link);
  });
  // 다른 상품과 같은 체크리스트 (productSameAsLinks): 기준 상품의 현재 연결을 그대로 참조 (기준 상품이 바뀌면 함께 반영)
  getSameAsChecklistLinks().forEach(({ productId, sameAsProductId, mappingStatus }) => {
    if (!activeIds.has(productId)) return;
    postedExplanationLinks
      .filter((link) => link.productId === sameAsProductId)
      .forEach((link) => {
        const key = `${productId}|${link.explanationId}`;
        if (seen.has(key)) return;
        seen.add(key);
        postedExplanationLinks.push({ productId, explanationId: link.explanationId, mappingStatus, sameAsProductId });
      });
  });
  // 초안 productMaster와 상품 마스터 일치 점검 (불일치는 경고만, 상품 마스터 기준 유지)
  (integratedDraftRaw.productMaster || []).forEach((entry) => {
    const master = products.find((item) => item && item.id === entry.id);
    if (!master) draftMasterMismatches.push(`${entry.id}: 상품 마스터에 없음`);
    else if (master.name !== entry.name) draftMasterMismatches.push(`${entry.id}: 상품명 다름`);
    else if ((entry.active !== false) !== (master.isDeleted !== true)) draftMasterMismatches.push(`${entry.id}: 활성 상태 다름`);
  });
  if (draftMasterMismatches.length) console.warn('통합 초안 상품 목록 불일치:', draftMasterMismatches.join(', '));
}

/* ===== 공통 체크리스트 (여러 상품이 함께 쓰는 항목 목록 · 개발 미리보기 전용) =====
 * data/common-checklists.json: sets(공통 항목 목록, 핵심 설명 ID만) + productSetLinks(상품 → 공통 목록).
 * 게시 가능한 상태(PUBLISHABLE_LINK_STATUSES)의 연결만 쓰고, 없는 설명 ID가 있으면 그 목록 전체를 쓰지 않습니다.
 */
const COMMON_CHECKLISTS_URL = 'data/common-checklists.json';
let commonChecklistsRaw = null;

async function loadCommonChecklists() {
  if (!SHOW_DRAFT_CONTENT) return;
  try {
    const response = await fetch(COMMON_CHECKLISTS_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    commonChecklistsRaw = await response.json();
  } catch (error) {
    commonChecklistsRaw = null;
    console.warn('공통 체크리스트를 불러오지 못했습니다.', error);
  }
}

function getCommonChecklistLinks() {
  const data = commonChecklistsRaw;
  if (!data || data.dataset_type !== 'common_checklists') return [];
  const sets = new Map();
  (Array.isArray(data.sets) ? data.sets : []).forEach((set) => {
    const ids = set && Array.isArray(set.explanationIds) ? set.explanationIds : [];
    if (!set || !set.id || !ids.length || !ids.every((id) => coreExplanations.has(id))) {
      console.warn('공통 체크리스트 확인 필요:', set && set.id);
      return;
    }
    sets.set(set.id, set);
  });
  return (Array.isArray(data.productSetLinks) ? data.productSetLinks : [])
    .filter((link) => link && sets.has(link.setId) && PUBLISHABLE_LINK_STATUSES.includes(link.mappingStatus))
    .flatMap((link) => {
      // 상품마다 다른 항목(extraExplanationIds)은 그 상품에만, extraInsertAfter 뒤(없으면 맨 뒤)에 표시
      const ids = [...sets.get(link.setId).explanationIds];
      const extras = (Array.isArray(link.extraExplanationIds) ? link.extraExplanationIds : [])
        .filter((id) => coreExplanations.has(id) && !ids.includes(id));
      const anchor = ids.indexOf(link.extraInsertAfter);
      ids.splice(anchor >= 0 ? anchor + 1 : ids.length, 0, ...extras);
      return ids.map((explanationId) => ({
        productId: link.productId,
        explanationId,
        mappingStatus: link.mappingStatus,
        setId: link.setId,
      }));
    });
}

// 기준 상품과 같은 체크리스트를 쓰는 상품 (사용자가 지정한 표시 연결 · 게시 가능한 상태만, 기준 상품 자기 자신 지정 금지)
function getSameAsChecklistLinks() {
  const data = commonChecklistsRaw;
  if (!data || !Array.isArray(data.productSameAsLinks)) return [];
  return data.productSameAsLinks.filter((link) => link && link.productId && link.sameAsProductId
    && link.productId !== link.sameAsProductId && PUBLISHABLE_LINK_STATUSES.includes(link.mappingStatus));
}

/* ===== 상품 통합 표시 (data/product-display-merges.json · 운영·개발 공통) =====
 * 여러 상품을 상품별 안내에서 하나의 항목으로 표시. 원래 상품 ID는 데이터에 그대로 두고,
 * 즐겨찾기·최근 확인·상세 주소에 남은 구성 상품 ID는 통합 항목 ID로 연결합니다.
 */
const PRODUCT_MERGES_URL = 'data/product-display-merges.json';
let productMergesRaw = null;
let mergedProductIdMap = new Map(); // 구성 상품 ID → 통합 항목 ID

async function loadProductMerges() {
  try {
    const response = await fetch(PRODUCT_MERGES_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    productMergesRaw = await response.json();
  } catch (error) {
    productMergesRaw = null;
    console.warn('상품 통합 표시 설정을 불러오지 못했습니다.', error);
  }
}

// 구성 상품을 목록에서 빼고 통합 항목 하나로 대체 (구성 상품이 없거나 겹치면 그 통합 설정은 쓰지 않음)
function applyProductMerges(items) {
  mergedProductIdMap = new Map();
  const merges = productMergesRaw && productMergesRaw.dataset_type === 'product_display_merges'
    && Array.isArray(productMergesRaw.merges) ? productMergesRaw.merges : [];
  let result = items;
  merges.forEach((merge) => {
    const members = merge && Array.isArray(merge.memberProductIds)
      ? merge.memberProductIds.map((id) => result.find((item) => item.id === id)) : [];
    const valid = merge && typeof merge.id === 'string' && typeof merge.displayName === 'string'
      && members.length >= 2 && members.every(Boolean)
      && !result.some((item) => item.id === merge.id);
    if (!valid) {
      console.warn('상품 통합 표시 확인 필요:', merge && merge.id);
      return;
    }
    const merged = {
      id: merge.id,
      name: merge.displayName,
      type: 'product',
      productCodes: [...new Set(members.flatMap((item) => item.productCodes || []))],
      memberProductIds: members.map((item) => item.id),
      searchNames: members.map((item) => item.name),
    };
    const firstIndex = result.indexOf(members[0]);
    result = result.filter((item) => !members.includes(item));
    result.splice(Math.min(firstIndex, result.length), 0, merged);
    members.forEach((item) => mergedProductIdMap.set(item.id, merge.id));
  });
  return result;
}

function canonicalProductId(id) {
  return mergedProductIdMap.get(id) || id;
}

// 검색: 상품명 + (통합 항목이면) 구성 상품명
function matchesItem(item, keyword) {
  return matchesKeyword(item.name, keyword)
    || (Array.isArray(item.searchNames) && item.searchNames.some((name) => matchesKeyword(name, keyword)));
}

/* ===== 핵심 설명 강조 구절 (상품별·담보별 공통) =====
 * data/core-explanation-highlights.json: 원문은 그대로 두고 explanationId별 강조 구절(highlightSegments)만 관리.
 * 원문에 실제로 있는 구절만 빨간색 굵은 글씨로 표시하고, 일치하지 않거나 겹치는 구절은 강조하지 않고 검토 목록에 기록합니다.
 */
const CORE_HIGHLIGHTS_URL = 'data/core-explanation-highlights.json';
let coreHighlightsRaw = null;
let coreHighlights = new Map(); // core-NNN → [{ text, tone }] (검증된 구절만)
let highlightReviewList = []; // 검토 필요 항목 (개발자 도구에서 확인)

async function loadCoreHighlights() {
  if (!SHOW_DRAFT_CONTENT) return;
  try {
    const response = await fetch(CORE_HIGHLIGHTS_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    coreHighlightsRaw = await response.json();
  } catch (error) {
    coreHighlightsRaw = null;
    console.warn('핵심 설명 강조 구절을 불러오지 못했습니다.', error);
  }
}

function buildCoreHighlights() {
  coreHighlights = new Map();
  highlightReviewList = [];
  if (!coreHighlightsRaw || !coreExplanations.size) return;
  const tone = EMPHASIS_TONES.includes(coreHighlightsRaw.tone) ? coreHighlightsRaw.tone : 'danger';
  const items = Array.isArray(coreHighlightsRaw.items) ? coreHighlightsRaw.items : [];
  items.forEach((item) => {
    const entry = item && coreExplanations.get(item.explanationId);
    if (!entry) {
      highlightReviewList.push(`${item && item.explanationId}: 핵심 설명 없음`);
      return;
    }
    const text = entry.coreExplanation;
    const ranges = [];
    (Array.isArray(item.highlightSegments) ? item.highlightSegments : []).forEach((segment) => {
      const start = typeof segment === 'string' && segment ? text.indexOf(segment) : -1;
      if (start < 0) {
        highlightReviewList.push(`${entry.id}: 원문과 일치하지 않음 "${segment}"`);
        return;
      }
      const end = start + segment.length;
      if (ranges.some((range) => start < range.end && end > range.start)) {
        highlightReviewList.push(`${entry.id}: 다른 강조 구절과 겹침 "${segment}"`);
        return;
      }
      ranges.push({ start, end, text: segment });
    });
    if (ranges.length) coreHighlights.set(entry.id, ranges.map((range) => ({ text: range.text, tone })));
  });
  coreExplanations.forEach((entry, id) => {
    if (!items.some((item) => item && item.explanationId === id)) highlightReviewList.push(`${id}: 강조 구절 미등록`);
  });
  if (highlightReviewList.length) console.warn('강조 구절 검토 필요:', highlightReviewList);
}

function getExplanationEmphasis(explanationId) {
  return coreHighlights.get(explanationId) || [];
}

// '문구 사용자 확인 · 약관 검증 전 · 회사 승인 전' (세 상태를 각각 표시)
function getExplanationStatusText(entry) {
  return Object.keys(EXPLANATION_STATUS_FALLBACK)
    .map((key) => (EXPLANATION_STATUS_LABELS[key][entry[key]] || EXPLANATION_STATUS_FALLBACK[key]))
    .join(' · ');
}

/* ===== 상품별 안내 보험 유형 그룹 (사용 중지) =====
 * 2026-10-28 사용자 결정으로 그룹 보기를 해제함 → 상품별 안내는 개별 상품 목록.
 * data/product-groups.json과 아래 코드는 보존하며, USE_PRODUCT_GROUPS를 true로 바꾸면 다시 사용할 수 있습니다.
 */
const USE_PRODUCT_GROUPS = false;

/* ===== 상품별 안내 보험 유형 그룹 (개발 미리보기 전용) =====
 * data/product-groups.json: 설명 주제 원본(topics) 1벌 + 그룹 정의 + 자료-상품 매핑 + 상품별 고유 항목.
 * 같은 그룹이라도 보장내용·조건이 같다고 보지 않으며, 설명 문구는 승인 자료가 있을 때만 데이터에 입력합니다.
 * 구조가 맞지 않으면 그룹 화면을 쓰지 않고 기존 상품 목록을 그대로 표시합니다.
 */
const PRODUCT_GROUPS_URL = 'data/product-groups.json';
const UNASSIGNED_GROUP_ID = 'unassigned';
const MATCH_TYPE_LABELS = {
  EXACT_NAME: '자료명 일치',
  CONFIRMED: '매칭 확정',
  GROUP_SOURCE: '그룹 자료',
  CANDIDATE: '매칭 확인 필요',
  UNMATCHED: '상품 미확인',
};
let productGroupsRaw = null;
let productGroups = null; // { topics: Map, groups, productItems, unassignedItems, sourceLinks }

async function loadProductGroups() {
  if (!DEV_MODE || !USE_PRODUCT_GROUPS) return;
  try {
    const response = await fetch(PRODUCT_GROUPS_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    productGroupsRaw = await response.json();
  } catch (error) {
    productGroupsRaw = null;
    console.warn('상품 그룹 정의를 불러오지 못했습니다.', error);
  }
}

// 상품 목록을 불러온 뒤 검증 (없는 상품·주제를 가리키거나 한 상품이 두 그룹에 있으면 전체 미사용)
function validateProductGroups(data) {
  const errors = [];
  if (!data || data.dataset_type !== 'product_group_index') return ['dataset_type'];
  const productIds = new Set(allItems.filter((item) => item.type === 'product').map((item) => item.id));
  const topics = Array.isArray(data.topics) ? data.topics : [];
  const topicIds = new Set();
  topics.forEach((topic, index) => {
    if (!topic || typeof topic.id !== 'string' || topicIds.has(topic.id) || typeof topic.name !== 'string' || !topic.name.trim()) {
      errors.push(`topics[${index}]`);
    }
    if (topic && topic.id) topicIds.add(topic.id);
  });
  const hasTopics = (ids) => Array.isArray(ids) && ids.every((id) => topicIds.has(id));
  const grouped = new Set();
  const groupIds = new Set();
  if (!Array.isArray(data.groups)) errors.push('groups');
  (Array.isArray(data.groups) ? data.groups : []).forEach((group, index) => {
    const ok = group && typeof group.id === 'string' && group.id !== UNASSIGNED_GROUP_ID && !groupIds.has(group.id)
      && typeof group.name === 'string' && Array.isArray(group.productIds) && group.productIds.length > 0
      && group.productIds.every((id) => productIds.has(id) && !grouped.has(id))
      && hasTopics(group.commonTopicIds)
      && (!group.commonAppliesTo || group.commonAppliesTo.every((id) => group.productIds.includes(id)));
    if (!ok) errors.push(`groups[${index}]`);
    // 공통 항목 근거: 그룹 자료이거나, 확정 자료(정확 일치·사용자 확인)라면 그 자료에 실제로 있는 주제만 (후보 자료 사용 금지)
    (group && Array.isArray(group.commonSources) ? group.commonSources : []).forEach((sourceIndex) => {
      const link = (Array.isArray(data.sourceLinks) ? data.sourceLinks : []).find((entry) => entry.sourceIndex === sourceIndex);
      if (!link || link.matchType === 'CANDIDATE' || link.matchType === 'UNMATCHED') {
        errors.push(`groups[${index}].commonSources(${sourceIndex})`);
        return;
      }
      if (link.matchType === 'GROUP_SOURCE') return;
      const entry = (Array.isArray(data.productItems) ? data.productItems : []).find((item) => item.sourceIndex === sourceIndex);
      if (!entry || !group.commonTopicIds.every((id) => entry.topicIds.includes(id))) {
        errors.push(`groups[${index}].commonTopicIds(${sourceIndex})`);
      }
    });
    if (group && group.id) groupIds.add(group.id);
    (group && Array.isArray(group.productIds) ? group.productIds : []).forEach((id) => grouped.add(id));
  });
  (Array.isArray(data.productItems) ? data.productItems : []).forEach((entry, index) => {
    if (!entry || !productIds.has(entry.productId) || !hasTopics(entry.topicIds) || !MATCH_TYPE_LABELS[entry.matchType]) {
      errors.push(`productItems[${index}]`);
    }
  });
  (Array.isArray(data.unassignedItems) ? data.unassignedItems : []).forEach((entry, index) => {
    if (!entry || !hasTopics(entry.topicIds)) errors.push(`unassignedItems[${index}]`);
  });
  return errors;
}

function buildProductGroups() {
  productGroups = null;
  if (!DEV_MODE || !productGroupsRaw || productsLoadFailed) return;
  const errors = validateProductGroups(productGroupsRaw);
  if (errors.length) {
    console.warn('상품 그룹 정의 구조 확인 필요:', errors.join(', '));
    return;
  }
  const data = productGroupsRaw;
  productGroups = {
    topics: new Map(data.topics.map((topic) => [topic.id, topic])),
    groups: [...data.groups].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)),
    productItems: Array.isArray(data.productItems) ? data.productItems : [],
    unassignedItems: Array.isArray(data.unassignedItems) ? data.unassignedItems : [],
    sourceLinks: Array.isArray(data.sourceLinks) ? data.sourceLinks : [],
  };
}

function getProductName(id) {
  const product = allItems.find((item) => item.type === 'product' && item.id === id);
  return product ? product.name : id;
}

function getGroupOfProduct(productId) {
  return productGroups ? productGroups.groups.find((group) => group.productIds.includes(productId)) || null : null;
}

// 참고 자료 표시: 자료명 (기준일)
function getSourceLabel(sourceIndex) {
  const record = referenceRecords.find((entry) => entry.source_index === sourceIndex);
  if (record) return `${record.source_title} (기준일 ${record.source_date})`;
  const link = productGroups && productGroups.sourceLinks.find((entry) => entry.sourceIndex === sourceIndex);
  return link ? link.sourceTitle : `자료 ${sourceIndex}`;
}

// 그룹 화면용 정보: 공통 항목 + 상품별(또는 자료별) 추가 확인사항
function getGroupContext(groupId) {
  if (!productGroups) return null;
  if (groupId === UNASSIGNED_GROUP_ID) {
    if (!productGroups.unassignedItems.length) return null;
    return {
      id: UNASSIGNED_GROUP_ID,
      name: '상품 미확인 자료',
      productIds: [],
      commonTopicIds: [],
      commonSources: [],
      commonAppliesTo: [],
      extras: productGroups.unassignedItems.map((entry) => ({
        key: `source-${entry.sourceIndex}`,
        label: entry.label || getSourceLabel(entry.sourceIndex),
        matchType: 'UNMATCHED',
        productId: null,
        sourceIndex: entry.sourceIndex,
        topicIds: entry.topicIds,
      })),
    };
  }
  const group = productGroups.groups.find((entry) => entry.id === groupId);
  if (!group) return null;
  const commonSources = Array.isArray(group.commonSources) ? group.commonSources : [];
  return {
    ...group,
    commonSources,
    commonAppliesTo: group.commonAppliesTo || group.productIds,
    // 공통 항목의 근거가 된 자료는 공통에 없는 주제만 추가 확인사항으로 (중복 표시 방지, 상품 상세에는 전체 유지)
    extras: group.productIds.flatMap((productId) => productGroups.productItems
      .filter((entry) => entry.productId === productId)
      .map((entry) => ({
        key: productId,
        label: getProductName(productId),
        matchType: entry.matchType,
        productId,
        sourceIndex: entry.sourceIndex,
        topicIds: commonSources.includes(entry.sourceIndex)
          ? entry.topicIds.filter((topicId) => !group.commonTopicIds.includes(topicId))
          : entry.topicIds,
      }))
      .filter((extra) => extra.topicIds.length > 0)),
  };
}

function groupHref(groupId) {
  return `#/group/${encodeURIComponent(groupId)}`;
}

function guideItemHref(groupId, topicId, extraKey) {
  return extraKey
    ? `${groupHref(groupId)}/extra/${encodeURIComponent(extraKey)}/${encodeURIComponent(topicId)}`
    : `${groupHref(groupId)}/item/${encodeURIComponent(topicId)}`;
}

// #/group/<그룹> · #/group/<그룹>/item/<주제> · #/group/<그룹>/extra/<상품 또는 자료>/<주제>
function parseGroupRoute(route) {
  const match = route.match(/^group\/([^/]+)(?:\/item\/([^/]+)|\/extra\/([^/]+)\/([^/]+))?$/);
  if (!match || !DEV_MODE || !productGroups) return null;
  const context = getGroupContext(decodeURIComponent(match[1]));
  if (!context) return null;
  if (!match[2] && !match[3]) return { context, topic: null, extra: null };
  const topicId = decodeURIComponent(match[2] || match[4]);
  const topic = productGroups.topics.get(topicId);
  if (!topic) return null;
  if (match[2]) return context.commonTopicIds.includes(topicId) ? { context, topic, extra: null } : null;
  const extra = context.extras.find((entry) => entry.key === decodeURIComponent(match[3]) && entry.topicIds.includes(topicId));
  return extra ? { context, topic, extra } : null;
}

/* ===== 담보별 학습 설명 (상세 설명·그림 · 검토 초안 · 개발 미리보기 전용) =====
 * data/coverage-learning-guides.json: 주제 ID(appliesToTopicIds)별 학습 설명. 핵심 설명은 덮어쓰지 않습니다.
 * 그림은 데이터(timeline · breakdown)로 정의하고 DOM 요소로만 그립니다(HTML 문자열 삽입 없음).
 * 금액 예시가 맞지 않으면(합계 초과 등) 그림만 생략하고 검토 목록에 기록합니다.
 */
const LEARNING_GUIDES_URL = 'data/coverage-learning-guides.json';
const LEARNING_STATUS_LABELS = { REVIEW_DRAFT: '학습 설명 검토 초안' };
let learningGuideByTopic = new Map();
let learningGuideReviewList = [];

async function loadLearningGuides() {
  learningGuideByTopic = new Map();
  learningGuideReviewList = [];
  if (!SHOW_DRAFT_CONTENT) return;
  try {
    const response = await fetch(LEARNING_GUIDES_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || data.dataset_type !== 'coverage_learning_guides' || !Array.isArray(data.guides)) throw new Error('dataset_type');
    data.guides.forEach((guide) => {
      const ok = guide && typeof guide.id === 'string' && Array.isArray(guide.appliesToTopicIds)
        && Array.isArray(guide.detail) && guide.detail.length > 0;
      if (!ok) {
        learningGuideReviewList.push(`${guide && guide.id}: 구조 확인 필요`);
        return;
      }
      guide.appliesToTopicIds.forEach((topicId) => {
        if (learningGuideByTopic.has(topicId)) learningGuideReviewList.push(`${topicId}: 학습 설명 중복 (${guide.id})`);
        else learningGuideByTopic.set(topicId, guide);
      });
    });
  } catch (error) {
    learningGuideByTopic = new Map();
    console.warn('담보별 학습 설명을 불러오지 못했습니다.', error);
  }
  if (learningGuideReviewList.length) console.warn('학습 설명 검토 필요:', learningGuideReviewList);
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

const LEARNING_TONES = ['neutral', 'waiting', 'start', 'accent', 'primary'];
const toneClass = (tone) => (LEARNING_TONES.includes(tone) ? tone : 'neutral');

// 가로 타임라인: 단계마다 비중(weight)만큼 막대, 이름표는 막대 아래
function createTimelineVisual(visual) {
  const steps = Array.isArray(visual.steps) ? visual.steps.filter((step) => step && step.label) : [];
  if (steps.length < 2) return null;
  const wrap = document.createElement('div');
  wrap.className = 'viz viz--timeline';
  if (visual.title) wrap.append(createTextElement('p', 'viz__title', visual.title));
  const track = document.createElement('div');
  track.className = 'viz-timeline';
  steps.forEach((step) => {
    const item = document.createElement('div');
    item.className = `viz-timeline__step viz-timeline__step--${toneClass(step.tone)}`;
    const weight = Number(step.weight) || 0;
    if (weight > 0) item.style.flexGrow = String(weight);
    item.append(createTextElement('span', 'viz-timeline__bar', ''));
    item.append(createTextElement('span', 'viz-timeline__label', step.label));
    track.append(item);
  });
  wrap.append(track);
  if (visual.caption) wrap.append(createTextElement('p', 'viz__caption', visual.caption));
  return wrap;
}

// 금액 구성 막대: 전체(total) 안에서 각 부분(parts)의 비율
// '이해를 위한 예시'는 그림 카드 제목으로 모든 담보에 공통 표시 (2026-10-30 별도 배지 삭제)
function createBreakdownVisual(visual, guideId) {
  const total = visual.total && Number(visual.total.amount);
  const parts = Array.isArray(visual.parts) ? visual.parts : [];
  const sum = parts.reduce((acc, part) => acc + (Number(part && part.amount) || 0), 0);
  const valid = total > 0 && parts.length > 0 && parts.every((part) => part && part.label && Number(part.amount) > 0)
    && sum <= total;
  if (!valid) {
    learningGuideReviewList.push(`${guideId}: 그림 금액 확인 필요 (부분 합계 ${sum} / 전체 ${total})`);
    return null;
  }
  const unit = visual.unit || '';
  const wrap = document.createElement('div');
  wrap.className = 'viz viz--breakdown';
  if (visual.title) wrap.append(createTextElement('p', 'viz__title', visual.title));

  const totalRow = document.createElement('div');
  totalRow.className = 'viz-total';
  totalRow.append(createTextElement('span', 'viz-total__label', visual.total.label));
  totalRow.append(createTextElement('span', 'viz-total__amount', `${total}${unit}`));
  wrap.append(totalRow);

  const bar = document.createElement('div');
  bar.className = 'viz-bar';
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', parts.map((part) => `${part.label} ${part.amount}${unit}`).join(', '));
  parts.forEach((part) => {
    const segment = createTextElement('span', `viz-bar__seg viz-bar__seg--${toneClass(part.tone)}`, `${part.amount}${unit}`);
    segment.style.flexGrow = String(Number(part.amount));
    bar.append(segment);
  });
  if (sum < total) {
    const rest = createTextElement('span', 'viz-bar__seg viz-bar__seg--neutral', '');
    rest.style.flexGrow = String(total - sum);
    bar.append(rest);
  }
  wrap.append(bar);

  const legend = document.createElement('ul');
  legend.className = 'viz-legend';
  parts.forEach((part) => {
    const li = document.createElement('li');
    li.append(createTextElement('span', `viz-legend__dot viz-legend__dot--${toneClass(part.tone)}`, ''));
    li.append(createTextElement('span', 'viz-legend__label', part.label));
    li.append(createTextElement('span', 'viz-legend__amount', `${part.amount}${unit}`));
    legend.append(li);
  });
  wrap.append(legend);
  if (visual.resultLabel) wrap.append(createTextElement('p', 'viz__result', visual.resultLabel));
  if (visual.caption) wrap.append(createTextElement('p', 'viz__caption', visual.caption));
  return wrap;
}

function createVisualWrap(type, visual) {
  const wrap = document.createElement('div');
  wrap.className = `viz viz--${type}`;
  if (visual.title) wrap.append(createTextElement('p', 'viz__title', visual.title));
  return wrap;
}

function appendVisualCaption(wrap, visual) {
  if (visual.caption) wrap.append(createTextElement('p', 'viz__caption', visual.caption));
  return wrap;
}

// 흐름도: 번호가 붙은 단계를 위에서 아래로 (단계마다 짧은 설명 선택)
function createFlowVisual(visual) {
  const steps = Array.isArray(visual.steps) ? visual.steps.filter((step) => step && step.label) : [];
  if (steps.length < 2) return null;
  const wrap = createVisualWrap('flow', visual);
  const list = document.createElement('ol');
  list.className = 'viz-flow';
  steps.forEach((step, index) => {
    const li = document.createElement('li');
    li.className = 'viz-flow__step';
    li.append(createTextElement('span', 'viz-flow__num', String(index + 1)));
    const body = document.createElement('div');
    body.className = 'viz-flow__body';
    body.append(createTextElement('span', 'viz-flow__label', step.label));
    if (step.note) body.append(createTextElement('span', 'viz-flow__note', step.note));
    li.append(body);
    list.append(li);
  });
  wrap.append(list);
  return appendVisualCaption(wrap, visual);
}

// 비교: 2개 열(제목 + 항목 목록)을 나란히
function createCompareVisual(visual) {
  const columns = Array.isArray(visual.columns)
    ? visual.columns.filter((column) => column && column.title && Array.isArray(column.items) && column.items.length) : [];
  if (columns.length < 2) return null;
  const wrap = createVisualWrap('compare', visual);
  const grid = document.createElement('div');
  grid.className = 'viz-compare';
  columns.forEach((column) => {
    const box = document.createElement('div');
    box.className = `viz-compare__col viz-compare__col--${toneClass(column.tone)}`;
    box.append(createTextElement('p', 'viz-compare__title', column.title));
    const list = document.createElement('ul');
    list.className = 'viz-compare__list';
    column.items.forEach((item) => list.append(createTextElement('li', '', item)));
    box.append(list);
    grid.append(box);
  });
  wrap.append(grid);
  return appendVisualCaption(wrap, visual);
}

// 항목 구분 카드: 서로 다른 조건을 가진 항목을 따로 보여 줌
function createCardsVisual(visual) {
  const cards = Array.isArray(visual.cards) ? visual.cards.filter((card) => card && card.title) : [];
  if (cards.length < 2) return null;
  const wrap = createVisualWrap('cards', visual);
  const list = document.createElement('ul');
  list.className = 'viz-cards';
  cards.forEach((card) => {
    const li = document.createElement('li');
    li.className = 'viz-cards__item';
    li.append(createTextElement('span', 'viz-cards__title', card.title));
    if (card.text) li.append(createTextElement('span', 'viz-cards__text', card.text));
    list.append(li);
  });
  wrap.append(list);
  return appendVisualCaption(wrap, visual);
}

// 기간 길이 비교: 항목마다 상대적인 길이의 막대 (가장 긴 막대 기준)
function createPeriodsVisual(visual) {
  const rows = Array.isArray(visual.rows) ? visual.rows.filter((row) => row && row.label && Number(row.weight) > 0) : [];
  if (rows.length < 2) return null;
  const max = Math.max(...rows.map((row) => Number(row.weight)));
  const wrap = createVisualWrap('periods', visual);
  const list = document.createElement('ul');
  list.className = 'viz-periods';
  rows.forEach((row) => {
    const li = document.createElement('li');
    li.className = 'viz-periods__row';
    li.append(createTextElement('span', 'viz-periods__label', row.label));
    const track = document.createElement('span');
    track.className = 'viz-periods__track';
    const bar = createTextElement('span', `viz-periods__bar viz-periods__bar--${toneClass(row.tone)}`, '');
    bar.style.width = `${Math.round((Number(row.weight) / max) * 100)}%`;
    track.append(bar);
    li.append(track);
    list.append(li);
  });
  wrap.append(list);
  return appendVisualCaption(wrap, visual);
}

const LEARNING_VISUAL_BUILDERS = {
  flow: createFlowVisual,
  compare: createCompareVisual,
  cards: createCardsVisual,
  periods: createPeriodsVisual,
};

function createLearningVisual(guide) {
  const visual = guide.visual;
  if (!visual) return null;
  if (visual.type === 'timeline') return createTimelineVisual(visual);
  if (visual.type === 'breakdown') return createBreakdownVisual(visual, guide.id);
  if (LEARNING_VISUAL_BUILDERS[visual.type]) {
    const element = LEARNING_VISUAL_BUILDERS[visual.type](visual);
    if (!element) learningGuideReviewList.push(`${guide.id}: 그림 데이터 확인 필요 (${visual.type})`);
    return element;
  }
  learningGuideReviewList.push(`${guide.id}: 알 수 없는 그림 종류 ${visual.type}`);
  return null;
}

function getCoverageCategoryName(topic) {
  const category = coverageCategories.find((entry) => entry.id === topic.categoryId);
  return category ? category.name : '';
}

/* ===== 담보 샘플 데이터 (가상) =====
 * 실제 담보 데이터가 등록될 때까지 사용자 화면에 노출하지 않습니다.
 */
const coverages = [
  { id: 'coverage-cancer', name: '암 진단비' },
  { id: 'coverage-cerebrovascular', name: '뇌혈관질환 진단비' },
  { id: 'coverage-ischemic-heart', name: '허혈성심장질환 진단비' },
  { id: 'coverage-caregiver', name: '간병인 사용일당' },
  { id: 'coverage-medical-expense', name: '실손의료비' },
];

const ITEM_TYPE_LABELS = {
  product: '상품',
  coverage: '담보',
};

// 화면(목록·검색·즐겨찾기)에 노출되는 항목. 담보는 실제 데이터 등록 전까지 제외
let allItems = [];

/* ===== 즐겨찾기 (localStorage, 항목 id만 저장) =====
 * 저장된 id는 그대로 보존하고(상품 목록을 일시적으로 못 불러와도 유실 방지),
 * 화면에는 현재 상품 목록에 있는 항목만 표시합니다.
 */
const FAVORITES_KEY = 'wanpan-note:favorites';

function loadFavorites() {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    if (!Array.isArray(saved)) return new Set();
    return new Set(saved.filter((id) => typeof id === 'string'));
  } catch (error) {
    return new Set();
  }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch (error) {
    // 저장소를 사용할 수 없는 환경에서는 현재 화면에서만 유지
  }
}

let favorites = new Set();

/* ===== 최근 확인한 상품 (localStorage, 상품 id만 저장, 최신순 최대 5개) ===== */
const RECENT_PRODUCTS_KEY = 'wanpan-note:recent-products';
const RECENT_PRODUCTS_LIMIT = 5;

function loadRecentProducts() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_PRODUCTS_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    return [...new Set(saved.filter((id) => typeof id === 'string'))].slice(0, RECENT_PRODUCTS_LIMIT);
  } catch (error) {
    return [];
  }
}

let recentProductIds = [];

function recordRecentProduct(id) {
  // 데이터에서 삭제된 상품은 기록에서 정리 (목록을 못 불러온 경우는 보존)
  const kept = productsLoadFailed
    ? recentProductIds
    : recentProductIds.filter((entry) => allItems.some((item) => item.id === entry));
  recentProductIds = [id, ...kept.filter((entry) => entry !== id)].slice(0, RECENT_PRODUCTS_LIMIT);
  saveRecentProducts();
}

// 최근 확인 기록에서만 제거 (상품 데이터·즐겨찾기에는 영향 없음)
function removeRecentProduct(id) {
  recentProductIds = recentProductIds.filter((entry) => entry !== id);
  saveRecentProducts();
}

function saveRecentProducts() {
  try {
    localStorage.setItem(RECENT_PRODUCTS_KEY, JSON.stringify(recentProductIds));
  } catch (error) {
    // 저장소를 사용할 수 없는 환경에서는 현재 화면에서만 유지
  }
}

// 현재 상품 목록에 있는 상품만 (삭제된 상품 제외)
function getRecentProducts() {
  return recentProductIds
    .map((id) => allItems.find((item) => item.type === 'product' && item.id === id))
    .filter(Boolean);
}

/* ===== 정렬: 즐겨찾기 우선 + 지정 순서 + 가나다순 ===== */
// 2026-11-04 사용자 지정 순서 (상품 ID 기준): 퍼펙트플러스 → 간편 상품(내맘엔·내삶엔·간편한3.10.10) → 굿앤굿스타·굿앤굿어린이·굿앤굿1540
// 목록에 없는 상품은 이 순서 뒤에 가나다순으로 표시
const PRODUCT_DISPLAY_ORDER = [
  'product-001', // 퍼펙트플러스종합보험
  'product-002', // 내맘엔(N)맞춤간편건강보험
  'product-006', // 내삶엔(3N)맞춤간편건강보험
  'product-008', // 간편한3.10.10건강보험
  'product-009', // 굿앤굿스타종합보험
  'product-007', // 굿앤굿어린이종합보험
  'product-004', // 굿앤굿1540종합보험
];

function displayRank(item) {
  const index = PRODUCT_DISPLAY_ORDER.indexOf(item.id);
  return index === -1 ? PRODUCT_DISPLAY_ORDER.length : index;
}

function sortProducts(items) {
  return [...items].sort((a, b) => (
    Number(favorites.has(b.id)) - Number(favorites.has(a.id))
    || displayRank(a) - displayRank(b)
    || a.name.localeCompare(b.name, 'ko')
  ));
}

/* ===== 분류별 목록 정의 ===== */
const LIST_VIEWS = {
  products: {
    title: '상품별 안내',
    getItems: () => allItems.filter((item) => item.type === 'product'),
    get emptyText() {
      return productsLoadFailed ? LOAD_FAILED_TEXT : '등록된 상품이 없습니다.';
    },
  },
  coverages: {
    title: '담보별 안내',
    // 실제 담보 데이터 등록 전까지 빈 상태로 표시
    getItems: () => [],
    emptyText: '담보별 안내 준비 중',
  },
  guides: {
    title: '사전안내 가이드',
    // 승인된 안내자료만 추후 등록
    getItems: () => [],
    emptyText: '등록된 사전안내 가이드가 없습니다.',
  },
  favorites: {
    title: '즐겨찾기',
    // 실제 상품 데이터에 있는 즐겨찾기만 가나다순으로 표시 (Set이므로 중복 없음)
    getItems: () => sortProducts(allItems.filter((item) => favorites.has(item.id))),
    emptyText: '즐겨찾기한 항목이 없습니다.',
  },
};

/* ===== DOM ===== */
const homeView = document.getElementById('view-home');
const listView = document.getElementById('view-list');

const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const searchResults = document.getElementById('search-results');
const searchResultList = document.getElementById('search-result-list');
const searchEmpty = document.getElementById('search-empty');
const mainMenu = document.getElementById('main-menu');
const homeExtras = document.getElementById('home-extras');
const homeRecent = document.getElementById('home-recent');
const homeRecentList = document.getElementById('home-recent-list');

const listTitle = document.getElementById('list-title');
const listItems = document.getElementById('list-items');
const listEmpty = document.getElementById('list-empty');

const productTools = document.getElementById('product-tools');
const productCount = document.getElementById('product-count');
const productSearchForm = document.getElementById('product-search-form');
const productSearchInput = document.getElementById('product-search-input');
const productSearchClear = document.getElementById('product-search-clear');
const recentSection = document.getElementById('recent-products');
const recentList = document.getElementById('recent-list');

const groupArea = document.getElementById('group-area');
const groupAreaTitle = document.getElementById('group-area-title');
const groupList = document.getElementById('group-list');
const standaloneTitle = document.getElementById('standalone-title');
const topicHitArea = document.getElementById('topic-hit-area');
const topicHitList = document.getElementById('topic-hit-list');
const unassignedArea = document.getElementById('unassigned-area');
const unassignedList = document.getElementById('unassigned-list');

const groupView = document.getElementById('view-group');
const groupBack = document.getElementById('group-back');
const groupTitle = document.getElementById('group-title');
const groupProductsToggle = document.getElementById('group-products-toggle');
const groupProductsLabel = document.getElementById('group-products-label');
const groupProductsList = document.getElementById('group-products-list');
const groupCommonSection = document.getElementById('group-common-section');
const groupCommonNote = document.getElementById('group-common-note');
const groupCommonList = document.getElementById('group-common-list');
const groupExtraSection = document.getElementById('group-extra-section');
const groupExtraList = document.getElementById('group-extra-list');
const groupEmpty = document.getElementById('group-empty');

const guideItemView = document.getElementById('view-guide-item');
const guideItemBack = document.getElementById('guide-item-back');
const guideItemCrumb = document.getElementById('guide-item-crumb');
const guideItemTitle = document.getElementById('guide-item-title');
const guideItemStatus = document.getElementById('guide-item-status');
const guideItemSummary = document.getElementById('guide-item-summary');
const guideItemDetailSection = document.getElementById('guide-item-detail-section');
const guideItemDetail = document.getElementById('guide-item-detail');
const guideItemCheckSection = document.getElementById('guide-item-check-section');
const guideItemCheckList = document.getElementById('guide-item-check-list');
const guideItemScope = document.getElementById('guide-item-scope');
const detailGroupLink = document.getElementById('detail-group-link');

const favTools = document.getElementById('fav-tools');
const favCount = document.getElementById('fav-count');
const favUndo = document.getElementById('fav-undo');
const favUndoText = document.getElementById('fav-undo-text');
const favUndoButton = document.getElementById('fav-undo-button');
const favEmpty = document.getElementById('fav-empty');

const detailView = document.getElementById('view-detail');
const detailBack = document.getElementById('detail-back');
const detailTitle = document.getElementById('detail-title');
const detailFav = document.getElementById('detail-fav');
const detailChecklist = document.getElementById('detail-checklist');
const detailChecklistEmpty = document.getElementById('detail-checklist-empty');
const detailDemoBadge = document.getElementById('detail-demo-badge');
const detailDemoLabel = document.getElementById('detail-demo-label');
const detailDemoText = document.getElementById('detail-demo-text');

const coverageTools = document.getElementById('coverage-tools');
const coverageCount = document.getElementById('coverage-count');
const coverageSearchForm = document.getElementById('coverage-search-form');
const coverageSearchInput = document.getElementById('coverage-search-input');
const coverageSearchClear = document.getElementById('coverage-search-clear');
const coverageList = document.getElementById('coverage-list');
const coverageEmpty = document.getElementById('coverage-empty');

const topicView = document.getElementById('view-topic');
const topicBack = document.getElementById('topic-back');
const topicTitle = document.getElementById('topic-title');
const topicStatus = document.getElementById('topic-status');
const topicLearn = document.getElementById('topic-learn');
const topicLearnStatus = document.getElementById('topic-learn-status');
const topicLearnDetail = document.getElementById('topic-learn-detail');
const topicLearnVisualCard = document.getElementById('topic-learn-visual-card');
const topicLearnVisual = document.getElementById('topic-learn-visual');
const topicMoreToggle = document.getElementById('topic-more-toggle');
const topicMoreLabel = document.getElementById('topic-more-label');
const topicDetailBody = document.getElementById('topic-detail-body');
const topicSummary = document.getElementById('topic-summary');
const topicDetailSection = document.getElementById('topic-detail-section');
const topicDetailText = document.getElementById('topic-detail-text');
const topicCheckSection = document.getElementById('topic-check-section');
const topicCheckList = document.getElementById('topic-check-list');
const detailSaveButton = document.getElementById('detail-save-image');
const detailSaveLabel = document.getElementById('detail-save-label');
const detailSaveHint = document.getElementById('detail-save-hint');
const detailSaveStatus = document.getElementById('detail-save-status');

const STAR_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>';
const CHEVRON_ICON = '<svg class="item__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

/* ===== 항목 렌더링 ===== */
function updateFavoriteButton(button, item) {
  const isFavorite = favorites.has(item.id);
  button.classList.toggle('is-active', isFavorite);
  button.setAttribute('aria-pressed', String(isFavorite));
  button.setAttribute('aria-label', `${item.name} 즐겨찾기 ${isFavorite ? '해제' : '추가'}`);
}

function createItemElement(item) {
  const li = document.createElement('li');
  li.className = 'item';

  const badge = document.createElement('span');
  badge.className = `badge badge--${item.type}`;
  badge.textContent = ITEM_TYPE_LABELS[item.type];

  const nameText = document.createElement('span');
  nameText.className = 'item__name';
  nameText.textContent = item.name;

  const favoriteButton = document.createElement('button');
  favoriteButton.type = 'button';
  favoriteButton.className = 'fav-button';
  favoriteButton.dataset.id = item.id;
  favoriteButton.innerHTML = STAR_ICON;
  updateFavoriteButton(favoriteButton, item);

  // 상품은 행(즐겨찾기 버튼 제외) 전체가 상세 화면 링크
  if (item.type === 'product') {
    li.classList.add('item--link');
    const link = document.createElement('a');
    link.className = 'item__link';
    link.href = `#/product/${encodeURIComponent(item.id)}`;
    link.append(badge, nameText);
    link.insertAdjacentHTML('beforeend', CHEVRON_ICON);
    li.append(link, favoriteButton);
    return li;
  }

  li.append(badge, nameText, favoriteButton);
  return li;
}

function renderItems(listElement, emptyElement, items) {
  listElement.replaceChildren(...items.map(createItemElement));
  emptyElement.hidden = items.length > 0;
}

/* ===== 검색 (메인 통합검색·상품별 안내 공용) =====
 * 부분 일치, 공백 무시, 영문 대소문자 무시, 한글 초성 검색(예: ㅍㅍㅌ → 퍼펙트…) 지원
 */
function normalize(text) {
  return text.toLowerCase().replace(/\s+/g, '');
}

const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function getChoseong(char) {
  const code = char.charCodeAt(0) - 0xAC00;
  if (code < 0 || code > 11171) return null;
  return CHOSEONG[Math.floor(code / 588)];
}

// 검색어의 초성 글자는 해당 초성으로 시작하는 음절과도 일치
function charMatches(nameChar, keywordChar) {
  if (nameChar === keywordChar) return true;
  return CHOSEONG.includes(keywordChar) && getChoseong(nameChar) === keywordChar;
}

function matchesKeyword(name, rawKeyword) {
  const keyword = [...normalize(rawKeyword)];
  if (!keyword.length) return true;
  const target = [...normalize(name)];
  for (let start = 0; start + keyword.length <= target.length; start += 1) {
    if (keyword.every((char, index) => charMatches(target[start + index], char))) return true;
  }
  return false;
}

// 메인 검색의 담보 결과: 한 번 누르면 담보별 상세 화면으로 이동 (즐겨찾기 없음)
function createCoverageResultElement(topic) {
  const li = document.createElement('li');
  li.className = 'item item--link';
  const link = document.createElement('a');
  link.className = 'item__link';
  link.href = `#/topic/${encodeURIComponent(topic.id)}`;
  link.append(createTextElement('span', 'badge badge--coverage', ITEM_TYPE_LABELS.coverage));
  link.append(createTextElement('span', 'item__name', topic.name));
  link.insertAdjacentHTML('beforeend', CHEVRON_ICON);
  li.append(link);
  return li;
}

function renderSearch() {
  const keyword = normalize(searchInput.value);
  searchClear.hidden = searchInput.value === '';

  if (!keyword) {
    searchResults.hidden = true;
    mainMenu.hidden = false;
    homeExtras.hidden = false;
    renderHomeRecent();
    return;
  }

  const matches = sortProducts(allItems.filter((item) => matchesItem(item, searchInput.value)));
  // 담보: 담보명 또는 분류명으로 검색 (담보별 안내 데이터가 있는 개발 미리보기에서만), 상품 결과 아래에 표시
  // 정렬: 담보명이 검색어와 같은 것 → 검색어로 시작하는 것 → 나머지(가나다순)
  const rank = (topic) => (normalize(topic.name) === keyword ? 0 : normalize(topic.name).startsWith(keyword) ? 1 : 2);
  const topicMatches = coverageTopics
    .filter((topic) => matchesKeyword(topic.name, searchInput.value) || matchesKeyword(getCoverageCategoryName(topic), searchInput.value))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ko'));
  searchEmpty.textContent = productsLoadFailed && !topicMatches.length ? LOAD_FAILED_TEXT : '검색 결과가 없습니다';
  renderItems(searchResultList, searchEmpty, matches);
  searchResultList.append(...topicMatches.map(createCoverageResultElement));
  searchEmpty.hidden = matches.length + topicMatches.length > 0;
  searchResults.hidden = false;
  mainMenu.hidden = true;
  homeExtras.hidden = true;
}

/* ===== 메인화면 최근 확인한 상품 (기존 최근 기록 재사용, 최대 3개) ===== */
const HOME_RECENT_LIMIT = 3;

function renderHomeRecent() {
  const recent = getRecentProducts().slice(0, HOME_RECENT_LIMIT);
  homeRecent.hidden = recent.length === 0;
  homeRecentList.replaceChildren(...recent.map((item) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'home-recent__link';
    link.href = `#/product/${encodeURIComponent(item.id)}`;
    const name = document.createElement('span');
    name.className = 'home-recent__name';
    name.textContent = item.name;
    link.append(name);
    link.insertAdjacentHTML('beforeend', CHEVRON_ICON);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'home-recent__remove';
    remove.dataset.id = item.id;
    remove.setAttribute('aria-label', `${item.name} 최근 확인 기록에서 제거`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';

    li.className = 'home-recent__item';
    li.append(link, remove);
    return li;
  }));
}

homeRecentList.addEventListener('click', (event) => {
  const button = event.target.closest('.home-recent__remove');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();

  // 삭제 후 포커스를 이웃 항목으로 옮겨 키보드 사용자가 위치를 잃지 않도록 함
  const items = [...homeRecentList.querySelectorAll('.home-recent__remove')];
  const index = items.indexOf(button);
  removeRecentProduct(button.dataset.id);
  renderHomeRecent();

  const remaining = [...homeRecentList.querySelectorAll('.home-recent__remove')];
  const next = remaining[Math.min(index, remaining.length - 1)];
  if (next) {
    next.focus();
  } else {
    searchInput.focus();
  }
});

searchInput.addEventListener('input', renderSearch);

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  renderSearch();
  searchInput.blur();
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  renderSearch();
  searchInput.focus();
});

/* ===== 즐겨찾기 토글 ===== */
document.addEventListener('click', (event) => {
  const button = event.target.closest('.fav-button');
  if (!button) return;

  const item = allItems.find((entry) => entry.id === button.dataset.id);
  if (!item) return;

  const wasFavorite = favorites.has(item.id);
  if (wasFavorite) {
    favorites.delete(item.id);
  } else {
    favorites.add(item.id);
  }
  saveFavorites();

  const route = getRoute();
  if (route === 'favorites') {
    renderFavoriteList();
    if (wasFavorite) showFavoriteUndo(item);
  } else if (route === 'products' && listItems.contains(button)) {
    // 즐겨찾기 우선 정렬을 즉시 반영하고, 누른 버튼에 포커스 유지
    renderProductList();
    const moved = listItems.querySelector(`.fav-button[data-id="${CSS.escape(item.id)}"]`);
    if (moved) moved.focus();
  } else {
    updateFavoriteButton(button, item);
  }
});

/* ===== 상품별 안내 목록 ===== */
function renderRecentProducts(isSearching) {
  const recent = getRecentProducts();
  recentSection.hidden = isSearching || recent.length === 0;
  recentList.replaceChildren(...recent.map((item) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'recent__link';
    link.href = `#/product/${encodeURIComponent(item.id)}`;
    link.textContent = item.name;
    li.append(link);
    return li;
  }));
}

function renderProductList() {
  if (productGroups) {
    renderGroupedProductList();
    return;
  }
  const all = LIST_VIEWS.products.getItems();
  const keyword = productSearchInput.value;
  const isSearching = normalize(keyword) !== '';
  const items = sortProducts(isSearching ? all.filter((item) => matchesItem(item, keyword)) : all);

  productSearchClear.hidden = keyword === '';
  productCount.textContent = isSearching ? `전체 ${all.length}개 중 ${items.length}개` : `전체 ${all.length}개`;
  productCount.hidden = productsLoadFailed;
  listEmpty.textContent = isSearching ? '검색 결과가 없습니다' : LIST_VIEWS.products.emptyText;
  renderItems(listItems, listEmpty, items);
  renderRecentProducts(isSearching);
}

/* ===== 상품별 안내 그룹 보기 (개발 미리보기 전용) =====
 * 첫 화면: 보험 유형 그룹 → 개별 상품(즐겨찾기 우선) → 상품 미확인 자료
 * 검색: 그룹명 · 개별 상품명 · 설명 주제명
 */
function createGroupRowElement(href, name, meta, badgeText = '그룹') {
  const li = document.createElement('li');
  li.className = 'item item--link';
  const link = document.createElement('a');
  link.className = 'item__link';
  link.href = href;
  const badge = document.createElement('span');
  badge.className = 'badge badge--group';
  badge.textContent = badgeText;
  const nameText = document.createElement('span');
  nameText.className = 'item__name';
  nameText.textContent = name;
  link.append(badge, nameText);
  if (meta) {
    const metaText = document.createElement('span');
    metaText.className = 'item__meta';
    metaText.textContent = meta;
    link.append(metaText);
  }
  link.insertAdjacentHTML('beforeend', CHEVRON_ICON);
  li.append(link);
  return li;
}

function createGroupRow(group) {
  return createGroupRowElement(groupHref(group.id), group.name, `상품 ${group.productIds.length}개`);
}

function createGuideLink(href, name, meta) {
  const link = document.createElement('a');
  link.className = 'topic-link';
  link.href = href;
  const text = document.createElement('span');
  text.className = 'topic-link__name';
  text.textContent = name;
  link.append(text);
  if (meta) {
    const metaText = document.createElement('span');
    metaText.className = 'topic-link__meta';
    metaText.textContent = meta;
    link.append(metaText);
  }
  link.insertAdjacentHTML('beforeend', CHEVRON_ICON);
  const li = document.createElement('li');
  li.append(link);
  return li;
}

// 설명 주제 검색 결과: 주제가 쓰인 위치(그룹 공통·상품별 추가·독립 상품·미확인 자료)마다 1줄
function findTopicHits(keyword) {
  const hits = [];
  productGroups.topics.forEach((topic, topicId) => {
    if (!matchesKeyword(topic.name, keyword)) return;
    productGroups.groups.forEach((group) => {
      const context = getGroupContext(group.id);
      if (context.commonTopicIds.includes(topicId)) {
        hits.push({ href: guideItemHref(group.id, topicId), name: topic.name, meta: `${group.name} 공통` });
      }
      context.extras.filter((extra) => extra.topicIds.includes(topicId)).forEach((extra) => {
        hits.push({ href: guideItemHref(group.id, topicId, extra.key), name: topic.name, meta: `${extra.label} · ${MATCH_TYPE_LABELS[extra.matchType]}` });
      });
    });
    productGroups.productItems
      .filter((entry) => !getGroupOfProduct(entry.productId) && entry.topicIds.includes(topicId))
      .forEach((entry) => {
        hits.push({ href: `#/product/${encodeURIComponent(entry.productId)}`, name: topic.name, meta: `${getProductName(entry.productId)} · ${MATCH_TYPE_LABELS[entry.matchType]}` });
      });
    productGroups.unassignedItems.filter((entry) => entry.topicIds.includes(topicId)).forEach((entry) => {
      hits.push({ href: guideItemHref(UNASSIGNED_GROUP_ID, topicId, `source-${entry.sourceIndex}`), name: topic.name, meta: `${entry.label} · ${MATCH_TYPE_LABELS.UNMATCHED}` });
    });
  });
  return hits;
}

function renderGroupedProductList() {
  const all = LIST_VIEWS.products.getItems();
  const groups = productGroups.groups;
  const standalone = all.filter((item) => !getGroupOfProduct(item.id));
  const keyword = productSearchInput.value;
  const isSearching = normalize(keyword) !== '';
  productSearchClear.hidden = keyword === '';
  productCount.hidden = false;
  groupArea.hidden = false;

  if (!isSearching) {
    productCount.textContent = `그룹 ${groups.length}개 · 개별 상품 ${standalone.length}개 (전체 상품 ${all.length}개)`;
    groupAreaTitle.textContent = '보험 유형별';
    groupAreaTitle.hidden = false;
    groupList.replaceChildren(...groups.map(createGroupRow));
    standaloneTitle.textContent = '개별 상품';
    standaloneTitle.hidden = standalone.length === 0;
    listEmpty.textContent = LIST_VIEWS.products.emptyText;
    renderItems(listItems, listEmpty, sortProducts(standalone));
    topicHitArea.hidden = true;
    unassignedArea.hidden = productGroups.unassignedItems.length === 0;
    unassignedList.replaceChildren(...(unassignedArea.hidden ? [] : [createGroupRowElement(
      groupHref(UNASSIGNED_GROUP_ID),
      '매칭 확인 필요 자료',
      `${productGroups.unassignedItems.length}종`,
      '자료',
    )]));
    renderRecentProducts(false);
    return;
  }

  const groupHits = groups.filter((group) => matchesKeyword(group.name, keyword));
  const productHits = sortProducts(all.filter((item) => matchesItem(item, keyword)));
  const topicHits = findTopicHits(keyword);
  productCount.textContent = `검색 결과: 그룹 ${groupHits.length} · 상품 ${productHits.length} · 설명 항목 ${topicHits.length}`;
  groupAreaTitle.textContent = '보험 유형';
  groupAreaTitle.hidden = groupHits.length === 0;
  groupList.replaceChildren(...groupHits.map(createGroupRow));
  standaloneTitle.textContent = '상품';
  standaloneTitle.hidden = productHits.length === 0;
  // 그룹에 속한 상품은 어느 그룹인지 함께 표시
  renderItems(listItems, listEmpty, productHits);
  listItems.querySelectorAll('.item__link').forEach((link) => {
    const id = decodeURIComponent(link.getAttribute('href').replace('#/product/', ''));
    const group = getGroupOfProduct(id);
    if (!group) return;
    const metaText = document.createElement('span');
    metaText.className = 'item__meta';
    metaText.textContent = group.name;
    link.querySelector('.item__chevron').before(metaText);
  });
  listEmpty.textContent = '검색 결과가 없습니다';
  listEmpty.hidden = groupHits.length + productHits.length + topicHits.length > 0;
  topicHitArea.hidden = topicHits.length === 0;
  topicHitList.replaceChildren(...topicHits.map((hit) => createGuideLink(hit.href, hit.name, hit.meta)));
  unassignedArea.hidden = true;
  renderRecentProducts(true);
}

/* ===== 상품별 안내 그룹 화면 ===== */
const openGroupProductIds = new Set();

function setGroupProductsOpen(groupId, open) {
  groupProductsToggle.setAttribute('aria-expanded', String(open));
  groupProductsList.hidden = !open;
  if (open) openGroupProductIds.add(groupId);
  else openGroupProductIds.delete(groupId);
}

groupProductsToggle.addEventListener('click', () => {
  setGroupProductsOpen(groupView.dataset.groupId, groupProductsToggle.getAttribute('aria-expanded') !== 'true');
});

function renderGroup(context) {
  groupView.dataset.groupId = context.id;
  groupTitle.textContent = context.name;

  // 포함 상품 (기본 접힘, 즐겨찾기 버튼 포함)
  const members = context.productIds.map((id) => allItems.find((item) => item.id === id)).filter(Boolean);
  groupProductsToggle.parentElement.hidden = members.length === 0;
  groupProductsLabel.textContent = `포함 상품 ${members.length}개`;
  groupProductsList.replaceChildren(...members.map(createItemElement));
  setGroupProductsOpen(context.id, openGroupProductIds.has(context.id));

  // 공통 설명 항목 (그룹 자료 기준, 한 번만 표시)
  const common = context.commonTopicIds.map((id) => productGroups.topics.get(id));
  groupCommonSection.hidden = common.length === 0;
  const notApplied = context.productIds.filter((id) => !context.commonAppliesTo.includes(id));
  groupCommonNote.textContent = [
    `참고 자료: ${context.commonSources.map(getSourceLabel).join(', ')}`,
    notApplied.length ? `${notApplied.map(getProductName).join(', ')} 적용 여부 확인 필요` : '',
    '상품별 조건은 다를 수 있음',
  ].filter(Boolean).join(' · ');
  groupCommonList.replaceChildren(...common.map((topic) => createGuideLink(guideItemHref(context.id, topic.id), topic.name)));

  // 상품별(자료별) 추가 확인사항
  groupExtraSection.hidden = context.extras.length === 0;
  groupExtraList.replaceChildren(...context.extras.map((extra) => {
    const block = document.createElement('div');
    block.className = 'group-extra__block';
    const head = document.createElement('p');
    head.className = 'group-extra__head';
    const name = document.createElement('span');
    name.className = 'group-extra__name';
    name.textContent = extra.label;
    const chip = document.createElement('span');
    chip.className = `match-chip match-chip--${extra.matchType.toLowerCase()}`;
    chip.textContent = MATCH_TYPE_LABELS[extra.matchType];
    head.append(name, chip);
    const note = document.createElement('p');
    note.className = 'group-note';
    note.textContent = `참고 자료: ${getSourceLabel(extra.sourceIndex)}`;
    const list = document.createElement('ul');
    list.className = 'topic-list';
    list.append(...extra.topicIds.map((topicId) => createGuideLink(
      guideItemHref(context.id, topicId, extra.key),
      productGroups.topics.get(topicId).name,
    )));
    block.append(head, note, list);
    return block;
  }));
  groupEmpty.hidden = common.length > 0 || context.extras.length > 0;
}

// 설명 항목: 핵심·상세·꼭 확인할 사항을 버튼 없이 바로 표시, 적용 범위로 '같은 조건' 단정 방지
function renderGuideItem({ context, topic, extra }) {
  const backHref = groupHref(context.id);
  guideItemBack.href = backHref;
  guideItemCrumb.href = backHref;
  guideItemCrumb.textContent = context.name;
  guideItemTitle.textContent = topic.name;
  guideItemStatus.textContent = extra && extra.matchType === 'CANDIDATE'
    ? '검증 전 · 고객 설명 사용 금지 · 매칭 확인 필요'
    : '검증 전 · 고객 설명 사용 금지';
  fillExplanation({
    summary: guideItemSummary,
    detailSection: guideItemDetailSection,
    detail: guideItemDetail,
    checkSection: guideItemCheckSection,
    checkList: guideItemCheckList,
  }, topic);

  const lines = [];
  if (!extra) {
    lines.push(`적용 상품: ${context.commonAppliesTo.map(getProductName).join(', ')}`);
    const notApplied = context.productIds.filter((id) => !context.commonAppliesTo.includes(id));
    if (notApplied.length) lines.push(`적용 여부 확인 필요: ${notApplied.map(getProductName).join(', ')} (자료명으로 확인되지 않음)`);
    lines.push(`참고 자료: ${context.commonSources.map(getSourceLabel).join(', ')}`);
    lines.push('같은 그룹이라도 상품별 지급 조건·기간·한도는 다를 수 있음');
  } else {
    lines.push(extra.productId ? `적용 상품: ${extra.label}` : '적용 상품: 상품 목록에서 확인되지 않음');
    lines.push(`매칭 상태: ${MATCH_TYPE_LABELS[extra.matchType]}`);
    lines.push(`참고 자료: ${getSourceLabel(extra.sourceIndex)}`);
  }
  guideItemScope.replaceChildren(...lines.map((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }));
}

[groupBack, guideItemBack].forEach((button) => {
  button.addEventListener('click', (event) => {
    if (hasInAppHistory) {
      event.preventDefault();
      history.back();
    }
  });
});

productSearchInput.addEventListener('input', renderProductList);

productSearchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  renderProductList();
  productSearchInput.blur();
});

productSearchClear.addEventListener('click', () => {
  productSearchInput.value = '';
  renderProductList();
  productSearchInput.focus();
});

/* ===== 즐겨찾기 목록 ===== */
const FAVORITE_UNDO_DURATION = 7000;
let favoriteUndoTarget = null;
let favoriteUndoTimer = null;

function renderFavoriteList() {
  const items = LIST_VIEWS.favorites.getItems();
  favCount.textContent = `즐겨찾기 ${items.length}개`;
  favCount.hidden = items.length === 0;
  renderItems(listItems, listEmpty, items);
  // 상품 목록을 못 불러온 경우 '즐겨찾기 없음'으로 오해하지 않도록 로딩 실패 안내
  listEmpty.textContent = LOAD_FAILED_TEXT;
  listEmpty.hidden = !productsLoadFailed;
  favEmpty.hidden = items.length > 0 || productsLoadFailed;
}

function hideFavoriteUndo() {
  clearTimeout(favoriteUndoTimer);
  favoriteUndoTarget = null;
  favUndo.hidden = true;
  favUndoText.textContent = '';
}

// 해제 직후 잠시 되돌리기 제공 (가장 최근 해제한 1개만)
function showFavoriteUndo(item) {
  clearTimeout(favoriteUndoTimer);
  favoriteUndoTarget = item;
  favUndoText.textContent = `'${item.name}' 즐겨찾기를 해제했습니다.`;
  favUndo.hidden = false;
  favUndoButton.focus();
  favoriteUndoTimer = setTimeout(hideFavoriteUndo, FAVORITE_UNDO_DURATION);
}

favUndoButton.addEventListener('click', () => {
  const item = favoriteUndoTarget;
  if (!item) return;
  favorites.add(item.id);
  saveFavorites();
  hideFavoriteUndo();
  renderFavoriteList();
  const restored = listItems.querySelector(`.fav-button[data-id="${CSS.escape(item.id)}"]`);
  if (restored) restored.focus();
});

/* ===== 화면 전환 (해시 라우팅) ===== */
function getRoute() {
  return location.hash.replace(/^#\/?/, '');
}

function renderList(view) {
  listTitle.textContent = view.title;
  const isProductList = view === LIST_VIEWS.products;
  const isFavoriteList = view === LIST_VIEWS.favorites;
  // 담보별 안내: 개발 미리보기에서 담보별 안내 데이터가 있을 때만 주제 목록, 그 외에는 기존 '준비 중'
  const isCoverageIndex = view === LIST_VIEWS.coverages && SHOW_DRAFT_CONTENT && coverageTopics.length > 0;
  productTools.hidden = !isProductList;
  favTools.hidden = !isFavoriteList;
  coverageTools.hidden = !isCoverageIndex;
  favEmpty.hidden = true;
  // 그룹 보기 영역은 상품별 안내(그룹 정의가 있을 때)에서만 renderGroupedProductList가 표시
  groupArea.hidden = true;
  topicHitArea.hidden = true;
  unassignedArea.hidden = true;
  if (isProductList) {
    renderProductList();
    return;
  }
  if (isFavoriteList) {
    renderFavoriteList();
    return;
  }
  if (isCoverageIndex) {
    listItems.replaceChildren();
    listEmpty.hidden = true;
    renderCoverageIndex();
    return;
  }
  listEmpty.textContent = view.emptyText;
  renderItems(listItems, listEmpty, view.getItems());
}

/* ===== 담보별 안내: 공통 분류별 설명 주제 (상품과 연결하지 않음 · 개발 미리보기 전용) ===== */
function topicHref(topic) {
  return `#/topic/${encodeURIComponent(topic.id)}`;
}

function createTopicLink(topic) {
  const link = document.createElement('a');
  link.className = 'topic-link';
  link.href = topicHref(topic);
  const name = document.createElement('span');
  name.className = 'topic-link__name';
  name.textContent = topic.name;
  link.append(name);
  link.insertAdjacentHTML('beforeend', CHEVRON_ICON);
  return link;
}

function renderCoverageIndex() {
  const topics = coverageTopics;
  const keyword = coverageSearchInput.value;
  const isSearching = normalize(keyword) !== '';
  coverageSearchClear.hidden = keyword === '';

  if (isSearching) {
    const matches = topics
      .filter((topic) => matchesKeyword(topic.name, keyword) || matchesKeyword(getCoverageCategoryName(topic), keyword))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    coverageCount.textContent = `주제 ${topics.length}개 중 ${matches.length}개`;
    coverageList.replaceChildren(...matches.map((topic) => {
      const li = document.createElement('li');
      li.append(createTopicLink(topic));
      return li;
    }));
    coverageEmpty.hidden = matches.length > 0;
    return;
  }

  // 분류별 아코디언: 분류 제목 + 오른쪽 화살표만 표시 (처음엔 모두 펼침 → 담보명 한 번 클릭으로 상세, 접은 상태는 상세에서 돌아와도 유지)
  const categories = coverageCategories
    .map((category) => ({ category, topics: topics.filter((topic) => topic.categoryId === category.id) }))
    .filter((group) => group.topics.length > 0);
  coverageCount.textContent = `분류 ${categories.length}개 · 주제 ${topics.length}개`;
  coverageEmpty.hidden = true;
  coverageList.replaceChildren(...categories.map((group) => createCoverageCategoryElement(group)));
}

// 분류는 기본 펼침 — 사용자가 접은 분류만 기록 (주제 상세에서 돌아와도 유지)
const closedCoverageCategoryIds = new Set();

function createCoverageCategoryElement({ category, topics }) {
  const li = document.createElement('li');
  li.className = 'coverage-category';
  const panelId = `coverage-category-${category.id}`;
  const open = !closedCoverageCategoryIds.has(category.id);

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'coverage-category__head';
  head.setAttribute('aria-expanded', String(open));
  head.setAttribute('aria-controls', panelId);
  const name = document.createElement('span');
  name.className = 'coverage-category__name';
  name.textContent = category.name;
  head.append(name);
  head.insertAdjacentHTML('beforeend', CHEVRON_ICON);

  const list = document.createElement('ul');
  list.className = 'topic-list';
  list.id = panelId;
  list.hidden = !open;
  topics.forEach((topic) => {
    const item = document.createElement('li');
    item.append(createTopicLink(topic));
    list.append(item);
  });

  head.addEventListener('click', () => {
    const next = head.getAttribute('aria-expanded') !== 'true';
    head.setAttribute('aria-expanded', String(next));
    list.hidden = !next;
    if (next) closedCoverageCategoryIds.delete(category.id);
    else closedCoverageCategoryIds.add(category.id);
  });

  li.append(head, list);
  return li;
}

coverageSearchInput.addEventListener('input', renderCoverageIndex);

coverageSearchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  renderCoverageIndex();
  coverageSearchInput.blur();
});

coverageSearchClear.addEventListener('click', () => {
  coverageSearchInput.value = '';
  renderCoverageIndex();
  coverageSearchInput.focus();
});

function getTopic(route) {
  const match = route.match(/^topic\/(.+)$/);
  if (!match || !SHOW_DRAFT_CONTENT) return null;
  const id = decodeURIComponent(match[1]);
  return coverageTopics.find((topic) => topic.id === id) || null;
}

// 주제 상세: 제목 → 핵심 설명 → 상세 설명 → 꼭 확인할 사항 (상품 정보 없음 · 모두 펼친 상태)
// 내용이 있는 영역만 표시하고, 핵심 설명이 없으면 안내 문구 한 줄만 둠 (내용을 만들지 않음)
// 담보별 안내 상세: 담보명 → 핵심 설명 → 추가 설명(펼치기). 문구는 통합 초안의 핵심 설명 ID로만 참조
function renderTopic(topic) {
  topicTitle.textContent = topic.name;
  const explanation = topic.explanationId ? coreExplanations.get(topic.explanationId) : null;
  // 이 담보에만 쓰는 문구(summaryOverride, 데이터상 사용자 검토안): 원래 핵심 설명은 그대로 두고 이 화면에서만 대체.
  // 상단 상태 안내와 약관 검증·회사 승인 상태는 원래 핵심 설명을 따름
  // 연결된 핵심 설명이 없는 주제도 전용 문구가 있으면 표시하고, 상태는 그 문구의 상태 값을 따름
  const override = getTopicSummaryOverride(topic);
  topicStatus.textContent = explanation
    ? `${getExplanationStatusText(explanation)} · 고객 설명 사용 금지`
    : override
      ? `${getExplanationStatusText(override)} · 고객 설명 사용 금지`
      : '검증 전 · 설명 확인 대기 · 고객 설명 사용 금지';
  fillExplanation({
    summary: topicSummary,
    detailSection: topicDetailSection,
    detail: topicDetailText,
    checkSection: topicCheckSection,
    checkList: topicCheckList,
  }, explanation
    ? {
      summary: override ? override.text : explanation.coreExplanation,
      emphasis: override ? override.emphasis : getExplanationEmphasis(explanation.id),
      detail: explanation.extraExplanation,
      checkPoints: topic.checkPoints,
    }
    : override
      ? { summary: override.text, emphasis: override.emphasis, detail: null, checkPoints: topic.checkPoints }
      : topic);
  setTopicMoreOpen(false);
  renderLearningGuide(topic);
}

// 담보 전용 문구: 강조 구절이 문구에 그대로 있을 때만 강조 (없으면 강조 없이 표시하고 검토 목록에 기록)
function getTopicSummaryOverride(topic) {
  const override = topic.summaryOverride;
  if (!override || typeof override.text !== 'string' || !override.text.trim()) return null;
  const emphasis = [];
  (Array.isArray(override.highlightSegments) ? override.highlightSegments : []).forEach((segment) => {
    if (typeof segment === 'string' && segment && override.text.includes(segment)) emphasis.push({ text: segment, tone: 'danger' });
    else highlightReviewList.push(`${topic.id}: 담보 전용 문구와 강조 구절 불일치 "${segment}"`);
  });
  return {
    text: override.text,
    emphasis,
    wordingStatus: override.wordingStatus,
    policyVerification: override.policyVerification,
    companyApproval: override.companyApproval,
  };
}

// 학습 설명: 상세 설명 → 그림(1개, 해당하는 경우). 등록된 주제에만 표시 (하단 공통 안내 문구는 모든 담보 화면에 고정)
// 그림은 주제별 예외(topicOverrides[주제].visual)가 있으면 그 주제에서만 덮어씀
function renderLearningGuide(topic) {
  const baseGuide = learningGuideByTopic.get(topic.id);
  topicLearn.hidden = !baseGuide;
  if (!baseGuide) return;
  const topicOverride = baseGuide.topicOverrides && baseGuide.topicOverrides[topic.id];
  const guide = topicOverride && topicOverride.visual && baseGuide.visual
    ? { ...baseGuide, visual: { ...baseGuide.visual, ...topicOverride.visual } }
    : baseGuide;
  topicLearnStatus.textContent = [
    LEARNING_STATUS_LABELS[guide.reviewStatus] || '학습 설명 검토 전',
    EXPLANATION_STATUS_LABELS.policyVerification[guide.policyVerification] || EXPLANATION_STATUS_FALLBACK.policyVerification,
    EXPLANATION_STATUS_LABELS.companyApproval[guide.companyApproval] || EXPLANATION_STATUS_FALLBACK.companyApproval,
  ].join(' · ');
  topicLearnDetail.replaceChildren(...guide.detail.map((sentence) => createTextElement('p', 'learn-card__text', sentence)));
  const visual = createLearningVisual(guide);
  topicLearnVisual.replaceChildren(...(visual ? [visual] : []));
  topicLearnVisualCard.hidden = !visual;
}

function setTopicMoreOpen(open) {
  topicMoreToggle.setAttribute('aria-expanded', String(open));
  topicDetailBody.hidden = !open;
  topicMoreLabel.textContent = open ? '추가 설명 접기' : '추가 설명 펼치기';
}

topicMoreToggle.addEventListener('click', () => {
  setTopicMoreOpen(topicMoreToggle.getAttribute('aria-expanded') !== 'true');
});

// 담보별 안내·상품별 안내 설명 항목 공용: 핵심 설명 → 상세 설명 → 꼭 확인할 사항
function fillExplanation(elements, topic) {
  const summary = typeof topic.summary === 'string' ? topic.summary.trim() : '';
  const detail = typeof topic.detail === 'string' ? topic.detail.trim() : '';
  const checkPoints = (Array.isArray(topic.checkPoints) ? topic.checkPoints : [])
    .filter((point) => typeof point === 'string' && point.trim());
  // 핵심 설명은 강조 구절만 빨간색 굵게 (텍스트 노드로만 구성, HTML 삽입 없음)
  elements.summary.replaceChildren();
  if (summary) appendEmphasizedText(elements.summary, summary, topic.emphasis);
  else elements.summary.textContent = COVERAGE_PENDING_TEXT;
  elements.summary.classList.toggle('topic-summary--pending', !summary);
  elements.detail.textContent = detail;
  elements.detailSection.hidden = !detail;
  elements.checkList.replaceChildren(...checkPoints.map((point) => {
    const li = document.createElement('li');
    li.textContent = point.trim();
    return li;
  }));
  elements.checkSection.hidden = checkPoints.length === 0;
}

topicBack.addEventListener('click', (event) => {
  if (hasInAppHistory) {
    event.preventDefault();
    history.back();
  }
});

function getDetailProduct(route) {
  const match = route.match(/^product\/(.+)$/);
  if (!match) return null;
  // 통합된 구성 상품의 주소(예: #/product/product-012)는 통합 항목으로 연결
  const id = canonicalProductId(decodeURIComponent(match[1]));
  return allItems.find((item) => item.type === 'product' && item.id === id) || null;
}

function renderDetail(product) {
  detailTitle.textContent = product.name;

  detailFav.dataset.id = product.id;
  updateFavoriteButton(detailFav, product);

  // 운영 승인자료 우선, 없으면 개발 모드에서만 시연용 자료
  // 우선순위: 운영 승인자료 → 시연 체크리스트(기존 데이터 보존) → 15종 자료 설명 주제(검증 전)
  // 서로 섞거나 덮어쓰지 않음
  const approvedItems = getApprovedChecklist(product);
  const demoEntry = approvedItems.length ? null : getDemoChecklistEntry(product);
  const referenceItems = (approvedItems.length || demoEntry) ? [] : getReferenceChecklistItems(product);
  const items = approvedItems.length ? approvedItems : (demoEntry ? demoEntry.items : referenceItems);
  const isDemo = Boolean(demoEntry);
  const isReference = referenceItems.length > 0;

  detailChecklist.replaceChildren(...items.map((entry, index) => createChecklistItemElement(entry, index)));
  detailChecklist.hidden = items.length === 0;
  detailChecklistEmpty.hidden = items.length > 0;
  detailDemoBadge.hidden = !(isDemo || isReference);
  detailDemoLabel.textContent = isReference ? '검증 전' : 'DEMO';
  const hasCandidate = referenceItems.some((entry) => entry.matchType === 'CANDIDATE');
  // 통합 초안 설명: 문구 확인·약관 검증·회사 승인 상태를 각각 표시 (항목별로 다르면 모두 나열)
  const draftStatuses = [...new Set(referenceItems.filter((entry) => entry.explanation)
    .map((entry) => getExplanationStatusText(entry.explanation)))];
  detailDemoText.textContent = draftStatuses.length
    ? `${draftStatuses.join(' / ')}. 고객 설명 사용 금지 · 상품별 약관 확인 필요.`
    : isReference
      ? `자료 검증 전 · 고객 설명 사용 금지. 자료에서 확인된 설명 주제 목록이며, ${REFERENCE_PENDING_TEXT}.${hasCandidate ? ' 자료명과 상품명이 정확히 일치하지 않아 매칭 확인이 필요합니다.' : ''}`
      : '개발용 예시 · 고객 설명 사용 금지. 공식 승인자료가 아니며 실제 내용은 약관 확인이 필요합니다.';

  // 그룹에 속한 상품은 그룹 공통 설명 항목으로 이동하는 링크 (개발 미리보기 전용)
  const group = getGroupOfProduct(product.id);
  detailGroupLink.hidden = !group;
  if (group) {
    detailGroupLink.href = groupHref(group.id);
    detailGroupLink.textContent = `${group.name} 그룹 설명 항목 보기`;
    detailGroupLink.insertAdjacentHTML('beforeend', CHEVRON_ICON);
  }

  currentDetailProduct = product;
  preparedImage = null;
  setSaveStatus('');
  detailSaveLabel.textContent = SAVE_LABEL_DEFAULT;
  // 이미지 저장은 운영 승인자료가 있을 때만 (시연용·검증 전 자료는 저장·공유 제외)
  // 개발 미리보기 시범 상품은 검증 전 핵심 설명도 '학습용 참고자료' 이미지로 저장 가능
  const canSaveDraft = approvedItems.length === 0 && getDraftImageItems(product).length > 0;
  detailSaveButton.disabled = approvedItems.length === 0 && !canSaveDraft;
  detailSaveHint.hidden = approvedItems.length > 0;
  detailSaveHint.textContent = canSaveDraft
    ? '플래너 내부 참고용으로만 저장하세요. 본 자료는 플래너의 업무 참고용으로, 고객에게 제공할 수 없습니다.'
    : isDemo || isReference
      ? '검증 전·시연용 자료는 이미지로 저장하거나 공유할 수 없습니다.'
      : '체크리스트가 등록되면 이미지로 저장할 수 있습니다.';
}

/* ===== 핵심 문구 강조 =====
 * emphasis: [{ text: '강조할 문구', tone: 'danger' | 'accent' }]
 *   - danger: 진한 적색, accent: 오렌지 — 모두 굵게 표시 (색상만으로 구분하지 않음)
 *   - 문구가 본문에 없으면 강조 없이 원문 그대로 표시
 */
const EMPHASIS_TONES = ['danger', 'accent'];

function appendEmphasizedText(element, text, emphasis) {
  const marks = (Array.isArray(emphasis) ? emphasis : [])
    .filter((mark) => mark && mark.text && text.includes(mark.text))
    .map((mark) => ({ ...mark, index: text.indexOf(mark.text) }))
    .sort((a, b) => a.index - b.index);

  let cursor = 0;
  marks.forEach((mark) => {
    if (mark.index < cursor) return;
    if (mark.index > cursor) element.append(text.slice(cursor, mark.index));
    const strong = document.createElement('strong');
    const tone = EMPHASIS_TONES.includes(mark.tone) ? mark.tone : 'accent';
    strong.className = `checklist-emphasis checklist-emphasis--${tone}`;
    strong.textContent = mark.text;
    element.append(strong);
    cursor = mark.index + mark.text.length;
  });
  if (cursor < text.length) element.append(text.slice(cursor));
}

/* ===== 체크리스트 항목 (제목·요약 → '자세히 보기'로 상세·이미지 펼침) ===== */
const ACCORDION_CHEVRON = '<svg class="checklist-item__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

function createChecklistItemElement(entry, index) {
  const li = document.createElement('li');
  li.className = 'checklist-item';

  const title = entry.title || entry.text || '';
  const hasDetail = Boolean(entry.detail) || (Array.isArray(entry.images) && entry.images.length > 0);

  const head = document.createElement(hasDetail ? 'button' : 'div');
  head.className = 'checklist-item__head';
  const number = document.createElement('span');
  number.className = 'checklist-item__num';
  number.textContent = String(index + 1);
  number.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'checklist-item__text';
  const titleEl = document.createElement('span');
  titleEl.className = 'checklist-item__title';
  titleEl.textContent = title;
  text.append(titleEl);
  if (entry.summary) {
    const summary = document.createElement('span');
    summary.className = 'checklist-item__summary';
    appendEmphasizedText(summary, entry.summary, entry.emphasis);
    text.append(summary);
  }
  head.append(number, text);
  li.append(head);
  if (!hasDetail) return li;

  const detailId = `checklist-detail-${index}`;
  head.type = 'button';
  head.setAttribute('aria-expanded', 'false');
  head.setAttribute('aria-controls', detailId);
  const more = document.createElement('span');
  more.className = 'checklist-item__more';
  more.textContent = '자세히 보기';
  text.append(more);
  head.insertAdjacentHTML('beforeend', ACCORDION_CHEVRON);

  const detail = document.createElement('div');
  detail.className = 'checklist-item__detail';
  detail.id = detailId;
  detail.hidden = true;
  if (entry.detail) {
    const p = document.createElement('p');
    p.className = 'checklist-item__detail-text';
    p.textContent = entry.detail;
    detail.append(p);
  }
  (Array.isArray(entry.images) ? entry.images : []).forEach((image) => {
    if (image && image.src) detail.append(createChecklistImageElement(image));
  });
  li.append(detail);

  // 여러 항목을 동시에 펼칠 수 있음 (화면을 다시 그리면 모두 접힌 상태로 초기화)
  head.addEventListener('click', () => {
    const expanded = head.getAttribute('aria-expanded') === 'true';
    head.setAttribute('aria-expanded', String(!expanded));
    detail.hidden = expanded;
    more.textContent = expanded ? '자세히 보기' : '접기';
  });
  return li;
}

// 공식 승인 이미지 (불러오지 못하면 영역째 제거해 깨진 이미지 아이콘을 표시하지 않음)
function createChecklistImageElement(image) {
  const figure = document.createElement('figure');
  figure.className = 'checklist-item__figure';
  const link = document.createElement('a');
  link.href = image.src;
  link.target = '_blank';
  link.rel = 'noopener';
  link.setAttribute('aria-label', `${image.alt || '설명 이미지'} 크게 보기`);
  const img = document.createElement('img');
  img.src = image.src;
  img.alt = image.alt || '';
  img.loading = 'lazy';
  img.addEventListener('error', () => figure.remove());
  link.append(img);
  figure.append(link);
  if (image.source) {
    const caption = document.createElement('figcaption');
    caption.textContent = `출처: ${image.source}`;
    figure.append(caption);
  }
  return figure;
}

/* ===== 체크리스트 이미지 저장 =====
 * 화면 캡처가 아닌 저장 전용 레이아웃을 Canvas에 그려 PNG로 만듭니다.
 * 승인 체크리스트의 상품명·항목·기준일·출처·안내문만 포함합니다. (개인정보 없음)
 */
const SAVE_LABEL_DEFAULT = '이미지로 저장';
const SAVE_LABEL_BUSY = '이미지 만드는 중…';
const SAVE_LABEL_SHARE = '이미지 공유하기';
const IMAGE_NOTICE = '실제 보장내용 및 지급 조건은 해당 상품의 약관과 공식 안내자료를 확인하세요.';
const IMAGE_FONT_FAMILY = 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const IMAGE_MAX_HEIGHT = 16000;

let currentDetailProduct = null;
let preparedImage = null;
let isSavingImage = false;

function setSaveStatus(message, isError = false) {
  detailSaveStatus.textContent = message;
  detailSaveStatus.classList.toggle('is-error', isError);
}

// '저장되었습니다.' 안내를 2초간 표시 (공유 창에서 저장을 마친 경우)
const saveToast = document.getElementById('save-toast');
let saveToastTimer = null;
function showSaveToast() {
  clearTimeout(saveToastTimer);
  saveToast.hidden = false;
  saveToastTimer = setTimeout(() => { saveToast.hidden = true; }, 2000);
}

async function loadImageFonts(sampleText) {
  if (!document.fonts || !document.fonts.load) return;
  try {
    // 실제 사용할 글자를 넘겨 필요한 한글 서브셋만 불러옴
    await Promise.all(['400', '500', '600', '700'].map(
      (weight) => document.fonts.load(`${weight} 32px Pretendard`, sampleText),
    ));
  } catch (error) {
    // 폰트를 불러오지 못하면 시스템 한글 폰트로 대체
  }
}

// 단어 단위로 줄바꿈하고, 한 줄보다 긴 단어는 글자 단위로 나눔
function wrapCanvasText(ctx, text, maxWidth) {
  const lines = [];
  String(text).split('\n').forEach((paragraph) => {
    let line = '';
    paragraph.split(/(\s+)/).forEach((token) => {
      if (!token) return;
      if (ctx.measureText(line + token).width <= maxWidth) {
        line += token;
        return;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = '';
      if (/^\s+$/.test(token)) return;
      for (const char of token) {
        if (line && ctx.measureText(line + char).width > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    });
    lines.push(line.trimEnd());
  });
  return lines;
}

// 둥근 사각형 경로 (roundRect 미지원 브라우저 대비)
function fillRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  ctx.fill();
}

// draw가 false면 높이만 계산하고, true면 같은 좌표로 실제로 그림
function layoutChecklistImage(ctx, data, draw) {
  const width = 1080;
  const pad = 80;
  const contentWidth = width - pad * 2;
  const font = (weight, size) => `${weight} ${size}px ${IMAGE_FONT_FAMILY}`;

  const drawLines = (lines, x, y, lineHeight, style) => {
    if (!draw) return;
    ctx.font = style.font;
    ctx.fillStyle = style.color;
    ctx.textBaseline = 'middle';
    lines.forEach((line, index) => ctx.fillText(line, x, y + lineHeight * index + lineHeight / 2));
  };

  if (draw) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = '#FF851B';
    ctx.fillRect(0, 0, width, 12);
  }

  let y = 12 + 72;

  // 상품명
  ctx.font = font(700, 48);
  const nameLines = wrapCanvasText(ctx, data.productName, contentWidth);
  drawLines(nameLines, pad, y, 66, { font: font(700, 48), color: '#082D65' });
  y += nameLines.length * 66 + 20;

  // 섹션 제목 (앞에 오렌지 포인트)
  if (draw) {
    ctx.fillStyle = '#FF851B';
    fillRoundedRect(ctx, pad, y + 8, 8, 32, 4);
  }
  drawLines(['고객 설명 체크리스트'], pad + 24, y, 48, { font: font(600, 34), color: '#103D80' });
  y += 48 + 32;

  if (draw) {
    ctx.fillStyle = '#E1E8F2';
    ctx.fillRect(pad, y, contentWidth, 2);
  }
  y += 2 + 40;

  // 체크리스트 항목 (번호 원 + 줄바꿈된 본문)
  const itemTextX = pad + 72;
  const itemTextWidth = contentWidth - 72;
  // 항목마다 제목·요약·상세 설명을 모두 포함 (요약만 저장되어 중요한 설명이 빠지지 않도록)
  data.items.forEach((item, index) => {
    const blocks = [
      { text: item.title || item.text, weight: 600, size: 32, lineHeight: 50, color: '#103D80' },
      { text: item.summary, weight: 400, size: 30, lineHeight: 48, color: '#172B4D' },
      { text: item.detail, weight: 400, size: 28, lineHeight: 46, color: '#475569' },
    ].filter((block) => block.text);
    if (draw) {
      ctx.fillStyle = '#FF851B';
      ctx.beginPath();
      ctx.arc(pad + 24, y + 26, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = font(700, 24);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), pad + 24, y + 27);
      ctx.textAlign = 'left';
    }
    let itemY = y;
    blocks.forEach((block, blockIndex) => {
      ctx.font = font(block.weight, block.size);
      const lines = wrapCanvasText(ctx, block.text, itemTextWidth);
      drawLines(lines, itemTextX, itemY, block.lineHeight, { font: font(block.weight, block.size), color: block.color });
      itemY += lines.length * block.lineHeight + (blockIndex < blocks.length - 1 ? 6 : 0);
    });
    y = Math.max(y + 52, itemY) + 32;
  });

  // 필수 유의사항 (승인자료에 있는 경우만)
  const requiredNotices = Array.isArray(data.requiredNotices) ? data.requiredNotices.filter(Boolean) : [];
  if (requiredNotices.length) {
    drawLines(['필수 유의사항'], pad, y, 44, { font: font(600, 30), color: '#103D80' });
    y += 44 + 8;
    requiredNotices.forEach((notice) => {
      ctx.font = font(400, 28);
      const lines = wrapCanvasText(ctx, `· ${notice}`, contentWidth);
      drawLines(lines, pad, y, 44, { font: font(400, 28), color: '#172B4D' });
      y += lines.length * 44 + 6;
    });
    y += 20;
  }

  // 자료 기준일·출처 (있는 경우만)
  const metaTexts = [];
  if (data.baseDate) metaTexts.push(`자료 기준일: ${data.baseDate}`);
  if (data.source) metaTexts.push(`출처: ${data.source}`);
  if (metaTexts.length) {
    ctx.font = font(500, 28);
    const metaLines = metaTexts.flatMap((text) => wrapCanvasText(ctx, text, contentWidth - 64));
    const boxHeight = metaLines.length * 44 + 56;
    if (draw) {
      ctx.fillStyle = '#F5F8FC';
      fillRoundedRect(ctx, pad, y, contentWidth, boxHeight, 20);
    }
    drawLines(metaLines, pad + 32, y + 28, 44, { font: font(500, 28), color: '#475569' });
    y += boxHeight + 16;
  }

  // 하단 안내문
  y += 24;
  if (draw) {
    ctx.fillStyle = '#E1E8F2';
    ctx.fillRect(pad, y, contentWidth, 2);
  }
  y += 2 + 32;
  ctx.font = font(400, 26);
  const noticeLines = wrapCanvasText(ctx, IMAGE_NOTICE, contentWidth);
  drawLines(noticeLines, pad, y, 40, { font: font(400, 26), color: '#475569' });
  y += noticeLines.length * 40 + pad;

  return { width, height: Math.ceil(y) };
}

/* ===== 검증 전 학습용 체크리스트 이미지 (개발 미리보기 전용 · 체크리스트가 있는 모든 상품) =====
 * 2026-10-30 사용자 결정: 검증·승인 전 핵심 설명도 개발 미리보기에서는 '학습용 참고자료'로 이미지 저장 허용.
 * 포함: 브랜드명 · 상품명 · 번호 · 항목 제목 · 핵심 설명(빨간 강조 유지) · 하단 검토 상태·사용 제한 안내
 * 제외: 상세·추가 설명, 담보별 그림, 화면 조작 요소. 운영 환경은 기존대로 승인 자료만 저장
 */
// 2026-10-30 사용자 요청: 시범 상품 제한을 풀고 체크리스트가 있는 모든 상품에서 저장 가능 (개발 미리보기 한정은 유지)
const DRAFT_IMAGE_TAG = '학습용 참고자료 · 고객 전달 금지';
const DRAFT_IMAGE_RESTRICTION = '플래너 내부 학습·업무 참고용 자료입니다. 고객에게 전송하거나 제공하지 마세요.';

function getDraftImageItems(product) {
  if (!SHOW_DRAFT_CONTENT || getApprovedChecklist(product).length) return [];
  return getReferenceChecklistItems(product).filter((item) => item.explanation);
}

// 강조 구절을 표시한 단어 목록: 단어(공백 기준) 안에서 강조/일반 구간(run)으로 나눔 (단어 중간에서 줄바꿈하지 않도록)
function buildRichWords(text, emphasis) {
  const flags = new Array(text.length).fill(false);
  (Array.isArray(emphasis) ? emphasis : []).forEach((mark) => {
    const start = mark && mark.text ? text.indexOf(mark.text) : -1;
    if (start >= 0) for (let i = start; i < start + mark.text.length; i += 1) flags[i] = true;
  });
  const words = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i += 1; continue; }
    let j = i;
    while (j < text.length && !/\s/.test(text[j])) j += 1;
    const runs = [];
    for (let k = i; k < j; k += 1) {
      const last = runs[runs.length - 1];
      if (last && last.em === flags[k]) last.text += text[k];
      else runs.push({ text: text[k], em: flags[k] });
    }
    words.push(runs);
    i = j;
  }
  return words;
}

function measureRuns(ctx, runs, fonts) {
  return runs.reduce((width, run) => {
    ctx.font = run.em ? fonts.em : fonts.base;
    return width + ctx.measureText(run.text).width;
  }, 0);
}

// 단어 단위 줄바꿈 (한 줄보다 긴 단어는 글자 단위로 나눔)
function wrapRichWords(ctx, words, maxWidth, fonts) {
  ctx.font = fonts.base;
  const space = ctx.measureText(' ').width;
  const lines = [];
  let line = [];
  let width = 0;
  words.forEach((runs) => {
    const wordWidth = measureRuns(ctx, runs, fonts);
    if (line.length && width + space + wordWidth > maxWidth) {
      lines.push(line);
      line = [];
      width = 0;
    }
    if (!line.length && wordWidth > maxWidth) {
      let part = [];
      let partWidth = 0;
      runs.forEach((run) => {
        for (const char of run.text) {
          ctx.font = run.em ? fonts.em : fonts.base;
          const charWidth = ctx.measureText(char).width;
          if (part.length && partWidth + charWidth > maxWidth) {
            lines.push([part]);
            part = [];
            partWidth = 0;
          }
          const last = part[part.length - 1];
          if (last && last.em === run.em) last.text += char;
          else part.push({ text: char, em: run.em });
          partWidth += charWidth;
        }
      });
      line = [part];
      width = partWidth;
      return;
    }
    width += (line.length ? space : 0) + wordWidth;
    line.push(runs);
  });
  if (line.length) lines.push(line);
  return lines;
}

function drawRichLine(ctx, line, x, y, fonts, colors) {
  ctx.font = fonts.base;
  const space = ctx.measureText(' ').width;
  let cursor = x;
  line.forEach((runs, index) => {
    if (index) cursor += space;
    runs.forEach((run) => {
      ctx.font = run.em ? fonts.em : fonts.base;
      ctx.fillStyle = run.em ? colors.em : colors.base;
      ctx.fillText(run.text, cursor, y);
      cursor += ctx.measureText(run.text).width;
    });
  });
}

// 휴대폰 화면 비율(19.5:9)에 맞춘 저장 크기. 내용이 길면 글자·간격을 조금씩 줄여 한 화면에 맞춤
const PHONE_IMAGE_WIDTH = 1080;
const PHONE_IMAGE_HEIGHT = 2340;
const PHONE_IMAGE_MIN_SCALE = 0.78;

// 학습용 체크리스트 이미지 레이아웃 (draw가 false면 높이만 계산)
// data.scale: 글자·간격 배율, data.pageHeight: 저장 높이 (내용이 짧으면 하단 안내를 화면 맨 아래에 배치)
function layoutDraftChecklistImage(ctx, data, draw) {
  const s = data.scale || 1;
  const k = (value) => Math.round(value * s);
  const width = PHONE_IMAGE_WIDTH;
  const pad = 72;
  const contentWidth = width - pad * 2;
  const font = (weight, size) => `${weight} ${k(size)}px ${IMAGE_FONT_FAMILY}`;
  const drawLines = (lines, x, y, lineHeight, style) => {
    if (!draw) return;
    ctx.font = style.font;
    ctx.fillStyle = style.color;
    ctx.textBaseline = 'middle';
    lines.forEach((line, index) => ctx.fillText(line, x, y + lineHeight * index + lineHeight / 2));
  };

  if (draw) {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = '#103D80';
    ctx.fillRect(0, 0, width, 12);
    ctx.fillStyle = '#FF851B';
    ctx.fillRect(0, 12, width, 6);
  }
  let y = 18 + k(48);

  // 브랜드명 ('완판' 네이비 + '노트' 오렌지)
  if (draw) {
    ctx.textBaseline = 'middle';
    ctx.font = font(800, 40);
    ctx.fillStyle = '#103D80';
    ctx.fillText('완판', pad, y + k(24));
    const brandWidth = ctx.measureText('완판').width;
    ctx.fillStyle = '#FF851B';
    ctx.fillText('노트', pad + brandWidth, y + k(24));
    const fullWidth = brandWidth + ctx.measureText('노트').width;
    ctx.font = font(600, 22);
    ctx.fillStyle = '#64748B';
    ctx.fillText('WANPAN NOTE', pad + fullWidth + 16, y + k(26));
  }
  y += k(48) + k(22);

  // 사용 제한 표시 (작은 태그) — SHOW_REVIEW_LABELS가 false면 생략
  if (SHOW_REVIEW_LABELS) {
    ctx.font = font(700, 24);
    const tagHeight = k(44);
    const tagWidth = ctx.measureText(DRAFT_IMAGE_TAG).width + 36;
    if (draw) {
      ctx.fillStyle = '#FFF4EA';
      fillRoundedRect(ctx, pad, y, tagWidth, tagHeight, tagHeight / 2);
      ctx.fillStyle = '#9A3412';
      ctx.textBaseline = 'middle';
      ctx.fillText(DRAFT_IMAGE_TAG, pad + 18, y + tagHeight / 2 + 1);
    }
    y += tagHeight + k(26);
  }

  // 상품명
  ctx.font = font(800, 46);
  const nameLines = wrapCanvasText(ctx, data.productName, contentWidth);
  drawLines(nameLines, pad, y, k(62), { font: font(800, 46), color: '#082D65' });
  y += nameLines.length * k(62) + k(6);
  drawLines(['고객 설명 체크리스트 · 핵심 설명'], pad, y, k(40), { font: font(600, 26), color: '#475569' });
  y += k(40) + k(22);
  if (draw) {
    ctx.fillStyle = '#103D80';
    ctx.fillRect(pad, y, contentWidth, 3);
  }
  y += 3 + k(30);

  // 항목: 번호 원 · 제목 · 핵심 설명(강조 구절은 빨간 굵은 글씨)
  const radius = k(22);
  const textX = pad + radius * 2 + 24;
  const textWidth = width - pad - textX;
  const titleLineHeight = k(48);
  const summaryLineHeight = k(47);
  const summaryFonts = { base: font(400, 30), em: font(700, 30) };
  data.items.forEach((item, index) => {
    if (draw) {
      ctx.fillStyle = '#FF851B';
      ctx.beginPath();
      ctx.arc(pad + radius, y + titleLineHeight / 2, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = font(700, 22);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), pad + radius, y + titleLineHeight / 2 + 1);
      ctx.textAlign = 'left';
    }
    ctx.font = font(700, 32);
    const titleLines = wrapCanvasText(ctx, item.title, textWidth);
    drawLines(titleLines, textX, y, titleLineHeight, { font: font(700, 32), color: '#103D80' });
    let itemY = y + titleLines.length * titleLineHeight + k(4);
    const richLines = wrapRichWords(ctx, buildRichWords(item.summary, item.emphasis), textWidth, summaryFonts);
    if (draw) {
      ctx.textBaseline = 'middle';
      richLines.forEach((line, lineIndex) => drawRichLine(ctx, line, textX, itemY + summaryLineHeight * lineIndex + summaryLineHeight / 2, summaryFonts, { base: '#172B4D', em: '#B42318' }));
    }
    itemY += richLines.length * summaryLineHeight;
    y = Math.max(y + titleLineHeight, itemY) + k(22);
    if (index < data.items.length - 1) {
      if (draw) {
        ctx.fillStyle = '#E1E8F2';
        ctx.fillRect(textX, y, textWidth, 2);
      }
      y += 2 + k(22);
    }
  });

  // 하단: 사용 제한 · 검토 상태 · 약관 확인 안내 (한 번만 표시)
  // 고객 제공 금지 문구: 작지만 읽기 쉬운 굵은 글씨, 길면 자동 줄바꿈
  // SHOW_REVIEW_LABELS가 false면 사용 제한·검토 상태 줄은 생략하고 약관 확인 안내만 표시
  ctx.font = font(700, 24);
  const restrictionLines = SHOW_REVIEW_LABELS ? wrapCanvasText(ctx, DRAFT_IMAGE_RESTRICTION, contentWidth - 56) : [];
  ctx.font = font(500, 24);
  const statusLines = SHOW_REVIEW_LABELS ? wrapCanvasText(ctx, data.statusText, contentWidth - 56) : [];
  const noticeLines = wrapCanvasText(ctx, IMAGE_NOTICE, contentWidth - 56);
  const boxHeight = k(26) + (restrictionLines.length ? restrictionLines.length * k(38) + k(4) : 0)
    + (statusLines.length ? statusLines.length * k(36) + k(8) : 0) + noticeLines.length * k(36) + k(26);
  const footerHeight = boxHeight + k(20) + k(34);
  const bottomMargin = k(44);
  // 내용이 화면보다 짧으면 하단 안내를 화면 맨 아래에 붙임
  y = Math.max(y + k(24), (data.pageHeight || 0) - bottomMargin - footerHeight);
  if (draw) {
    ctx.fillStyle = '#F5F8FC';
    fillRoundedRect(ctx, pad, y, contentWidth, boxHeight, 18);
    ctx.fillStyle = '#FF851B';
    fillRoundedRect(ctx, pad, y, 8, boxHeight, 4);
  }
  let boxY = y + k(26);
  if (restrictionLines.length) {
    drawLines(restrictionLines, pad + 32, boxY, k(38), { font: font(700, 24), color: '#9A3412' });
    boxY += restrictionLines.length * k(38) + k(4);
  }
  if (statusLines.length) {
    drawLines(statusLines, pad + 32, boxY, k(36), { font: font(500, 24), color: '#172B4D' });
    boxY += statusLines.length * k(36) + k(8);
  }
  drawLines(noticeLines, pad + 32, boxY, k(36), { font: font(400, 24), color: '#475569' });
  y += boxHeight + k(20);
  drawLines([`저장일 ${data.dateText} · © 2026 WANPAN NOTE`], pad, y, k(34), { font: font(400, 20), color: '#94A3B8' });
  y += k(34) + bottomMargin;

  return { width, height: Math.ceil(y) };
}

// 휴대폰 화면 크기(1080×2340)에 맞춰 배율을 정함: 길면 줄이고(최소 0.78), 짧으면 글자를 키워(최대 1.5) 화면을 채움
// 2026-10-30 사용자 요청: 하단 빈 공간 없이 저장 → 저장 높이는 내용 높이 그대로 (하단 안내를 내용 바로 아래에 배치)
const PHONE_IMAGE_MAX_SCALE = 1.5;

function fitDraftImageToPhone(ctx, data) {
  const heightAt = (scale) => layoutDraftChecklistImage(ctx, { ...data, scale }, false).height;
  let scale = 1;
  let natural = heightAt(scale);
  while (natural > PHONE_IMAGE_HEIGHT && scale > PHONE_IMAGE_MIN_SCALE) {
    scale = Math.max(PHONE_IMAGE_MIN_SCALE, Math.round((scale - 0.02) * 100) / 100);
    natural = heightAt(scale);
  }
  while (natural <= PHONE_IMAGE_HEIGHT && scale < PHONE_IMAGE_MAX_SCALE) {
    const next = Math.min(PHONE_IMAGE_MAX_SCALE, Math.round((scale + 0.02) * 100) / 100);
    const nextHeight = heightAt(next);
    if (nextHeight > PHONE_IMAGE_HEIGHT) break;
    scale = next;
    natural = nextHeight;
  }
  return { scale, pageHeight: 0 };
}

function layoutPhoneDraftChecklistImage(ctx, data, draw) {
  const fit = fitDraftImageToPhone(ctx, data);
  const result = layoutDraftChecklistImage(ctx, { ...data, ...fit }, draw);
  return { width: result.width, height: Math.max(fit.pageHeight, result.height) };
}

async function createChecklistImageBlob(data, layout = layoutChecklistImage) {
  const sampleText = [data.productName, '고객 설명 체크리스트 핵심 설명', IMAGE_NOTICE, data.baseDate, data.source,
    data.statusText, DRAFT_IMAGE_TAG, DRAFT_IMAGE_RESTRICTION, '완판노트 WANPAN NOTE 저장일 ©',
    ...data.items.flatMap((item) => [item.title, item.text, item.summary, item.detail]),
    ...(data.requiredNotices || []), '필수 유의사항 · 0123456789: 자료 기준일 출처'].filter(Boolean).join(' ');
  await loadImageFonts(sampleText);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas를 사용할 수 없습니다.');

  const { width, height } = layout(ctx, data, false);
  if (height > IMAGE_MAX_HEIGHT) throw new Error('체크리스트가 너무 길어 이미지를 만들 수 없습니다.');

  canvas.width = width;
  canvas.height = height;
  layout(ctx, data, true);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 변환에 실패했습니다.');
  return blob;
}

function isIOSDevice() {
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function downloadOrOpenImage(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  if ('download' in link) {
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setSaveStatus('이미지 다운로드를 요청했습니다. 브라우저의 다운로드 목록에서 파일을 확인해 주세요.');
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }
  const opened = window.open(url, '_blank');
  if (!opened) {
    URL.revokeObjectURL(url);
    throw new Error('새 창을 열 수 없습니다.');
  }
  setSaveStatus('새 창에서 이미지를 열었습니다. 이미지를 길게 눌러 저장할 수 있습니다.');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function shareImage(file, product) {
  setSaveStatus('공유 화면에서 원하는 저장 방법을 선택해 주세요.');
  try {
    await navigator.share({ files: [file], title: `${product.name} 고객 설명 체크리스트` });
    // 공유 창에서 동작을 마친 경우(취소는 AbortError로 아래에서 처리)
    setSaveStatus('');
    showSaveToast();
    preparedImage = null;
    detailSaveLabel.textContent = SAVE_LABEL_DEFAULT;
  } catch (error) {
    if (error.name === 'AbortError') {
      setSaveStatus('공유를 취소했습니다.');
    } else if (error.name === 'NotAllowedError') {
      // 이미지 생성 시간이 길어 브라우저가 공유를 막은 경우: 준비된 이미지로 다시 시도
      preparedImage = { productId: product.id, file };
      detailSaveLabel.textContent = SAVE_LABEL_SHARE;
      setSaveStatus('이미지가 준비되었습니다. 버튼을 한 번 더 누르면 공유 화면이 열립니다.');
    } else {
      downloadOrOpenImage(file);
    }
  }
}

// 파일명: 완판노트_상품명.png (파일 이름에 쓸 수 없는 문자는 제거)
function getImageFileName(product) {
  const safeName = product.name.replace(/[\\/:*?"<>|]/g, '').trim() || product.id;
  return `완판노트_${safeName}.png`;
}

function isMobileDevice() {
  return isIOSDevice() || /Android|Mobi/i.test(navigator.userAgent);
}

async function saveChecklistImage() {
  const product = currentDetailProduct;
  if (!product || isSavingImage) return;
  const entry = getApprovedChecklistEntry(product);
  const items = getApprovedChecklist(product);
  const draftItems = items.length ? [] : getDraftImageItems(product);
  if (!items.length && !draftItems.length) return;

  isSavingImage = true;
  detailSaveButton.disabled = true;
  detailSaveButton.setAttribute('aria-busy', 'true');

  try {
    let file = preparedImage && preparedImage.productId === product.id ? preparedImage.file : null;
    if (!file) {
      detailSaveLabel.textContent = SAVE_LABEL_BUSY;
      setSaveStatus('');
      // 매번 현재 화면의 데이터로 새로 생성 (같은 상품을 다시 저장하면 최신 내용 반영)
      const today = new Date();
      const blob = items.length
        ? await createChecklistImageBlob({
          productName: product.name,
          items,
          baseDate: entry.baseDate,
          source: entry.source,
          requiredNotices: entry.requiredNotices,
        })
        : await createChecklistImageBlob({
          productName: product.name,
          items: draftItems.map((item) => ({ title: item.title, summary: item.summary, emphasis: item.emphasis })),
          statusText: [...new Set(draftItems.map((item) => getExplanationStatusText(item.explanation)))].join(' / '),
          dateText: `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`,
        }, layoutPhoneDraftChecklistImage);
      file = new File([blob], getImageFileName(product), { type: 'image/png' });
    }
    detailSaveLabel.textContent = SAVE_LABEL_DEFAULT;

    // 휴대폰: 공유 메뉴를 쓸 수 있으면 공유, 아니면 다운로드 / PC: 다운로드
    const canShareFile = navigator.canShare && navigator.canShare({ files: [file] });
    if (isMobileDevice() && canShareFile) {
      await shareImage(file, product);
    } else {
      preparedImage = null;
      downloadOrOpenImage(file);
    }
  } catch (error) {
    console.warn('체크리스트 이미지 저장 실패', error);
    preparedImage = null;
    detailSaveLabel.textContent = SAVE_LABEL_DEFAULT;
    setSaveStatus('이미지를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.', true);
  } finally {
    isSavingImage = false;
    detailSaveButton.disabled = false;
    detailSaveButton.removeAttribute('aria-busy');
  }
}

detailSaveButton.addEventListener('click', saveChecklistImage);

/* ===== 메인화면 활용 TIP =====
 * 메인화면에 들어올 때마다 1개를 무작위로 표시합니다. (머무는 동안에는 바뀌지 않음)
 * 실제로 사용할 수 있는 기능의 TIP만 노출하도록 isAvailable로 조건을 지정합니다.
 */
// 이미지 저장을 실제로 쓸 수 있을 때: 승인 체크리스트가 있거나, 개발 미리보기에서 저장 가능한 상품이 있을 때
function isImageSaveAvailable() {
  return approvedChecklists.some(isChecklistActive)
    || (SHOW_DRAFT_CONTENT && allItems.some((item) => getDraftImageItems(item).length > 0));
}

// 핵심 설명·담보별 안내가 보이는 환경(현재 개발 미리보기)에서만 의미 있는 TIP
const hasLearningContent = () => SHOW_DRAFT_CONTENT;

const HOME_TIPS = [
  // 앱 활용 방법 (검색·즐겨찾기·최근 확인은 기존 문구 유지)
  { text: '자주 확인하는 상품은 별표를 눌러 즐겨찾기에 등록해 보세요.' },
  { text: '상품명의 일부만 입력해도 빠르게 검색할 수 있어요.' },
  { text: '최근 확인한 상품을 누르면 바로 다시 확인할 수 있어요.' },
  { text: '최근 확인 목록에서 필요 없는 상품은 X 버튼으로 정리할 수 있어요.' },
  { text: "담보명이 궁금하다면 '담보별 안내'에서 바로 찾아보세요.", isAvailable: hasLearningContent },
  { text: '상품별 안내에서 고객 설명 시 확인해야 할 핵심 항목을 살펴보세요.', isAvailable: hasLearningContent },
  { text: '담보별 안내에서 보장 원리와 상세 설명을 확인해 보세요.', isAvailable: hasLearningContent },
  { text: '빨간색 강조 부분은 핵심 설명에서 특히 중요한 내용이에요.', isAvailable: hasLearningContent },
  { text: '핵심 설명만으로 이해하기 어렵다면 추가 설명을 펼쳐보세요.', isAvailable: hasLearningContent },
  // 이미지 저장 기능 (기존 '체크리스트 이미지 저장' TIP은 아래 첫 문구로 통합)
  { text: "상품별 핵심 설명은 '이미지로 저장' 버튼을 눌러 한 장의 이미지로 보관할 수 있어요.", isAvailable: isImageSaveAvailable },
  { text: '저장한 이미지는 플래너 본인의 학습과 업무 참고용으로만 활용해 주세요.', isAvailable: isImageSaveAvailable },
  { text: '저장 이미지는 고객에게 전송하거나 제공하지 마세요.', isAvailable: isImageSaveAvailable },
  { text: '이미지 저장 시 상품별 핵심 설명과 주요 강조 문구를 한눈에 확인할 수 있어요.', isAvailable: isImageSaveAvailable },
  // 보험 실무 참고
  { text: '비슷한 담보라도 상품마다 지급조건이 다를 수 있어요.' },
  { text: '면책기간과 감액기간은 서로 다른 개념이에요.' },
  { text: '비례보상과 정액보상의 차이를 구분해 보세요.' },
  { text: '갱신형 담보는 갱신 시 보험료가 변동될 수 있어요.' },
  { text: '실제 보장금액과 지급조건은 가입한 담보의 약관을 기준으로 확인하세요.' },
  { text: '상담이나 계약 점검 전에 해당 상품의 핵심 설명을 다시 확인해 보세요.', isAvailable: hasLearningContent },
];

const homeTipText = document.getElementById('home-tip-text');
let currentHomeTip = null;

function pickHomeTip() {
  const available = HOME_TIPS.filter((tip) => !tip.isAvailable || tip.isAvailable());
  if (!available.length) return;
  // 가능하면 직전 TIP과 다른 문구 선택
  const candidates = available.length > 1 ? available.filter((tip) => tip !== currentHomeTip) : available;
  currentHomeTip = candidates[Math.floor(Math.random() * candidates.length)];
  homeTipText.textContent = currentHomeTip.text;
}

let previousRoute = '';
let wasHomeView = false;

const notFoundView = document.getElementById('view-notfound');
const notFoundTitle = document.getElementById('notfound-title');
const notFoundDesc = document.getElementById('notfound-desc');

// 화면별 스크롤 위치 (상세 화면에서 돌아올 때 이전 위치로 복원)
const scrollPositions = {};

function renderNotFound() {
  if (productsLoadFailed) {
    notFoundTitle.textContent = '상품 정보를 불러오지 못했습니다.';
    notFoundDesc.textContent = '인터넷 연결을 확인한 뒤 새로고침해 주세요.';
  } else {
    notFoundTitle.textContent = '요청한 상품을 찾을 수 없습니다.';
    notFoundDesc.textContent = '주소가 올바르지 않거나 더 이상 제공되지 않는 상품입니다. 상품별 안내에서 다시 찾아 주세요.';
  }
}

function render() {
  const route = getRoute();
  scrollPositions[previousRoute] = window.scrollY;

  const topic = getTopic(route);
  const groupRoute = parseGroupRoute(route);
  const groupPage = groupRoute && !groupRoute.topic ? groupRoute.context : null;
  const guideItem = groupRoute && groupRoute.topic ? groupRoute : null;
  // 주제 주소인데 주제를 쓸 수 없으면(운영 환경·없는 주제) 담보별 안내 화면으로, 그룹 주소도 같은 방식으로 상품별 안내로
  const view = LIST_VIEWS[route]
    || (route.startsWith('topic/') && !topic ? LIST_VIEWS.coverages : null)
    || (route.startsWith('group/') && !groupRoute ? LIST_VIEWS.products : null);
  const product = view || topic || groupRoute ? null : getDetailProduct(route);
  const isMissingProduct = !view && !product && !topic && !groupRoute && route.startsWith('product/');
  const isHomeView = !view && !product && !topic && !groupRoute && !isMissingProduct;

  // 다른 화면에서 메인으로 들어올 때(첫 진입 포함)만 새 TIP 선택
  if (isHomeView && !wasHomeView) pickHomeTip();
  wasHomeView = isHomeView;

  homeView.hidden = !isHomeView;
  listView.hidden = !view;
  detailView.hidden = !product;
  topicView.hidden = !topic;
  groupView.hidden = !groupPage;
  guideItemView.hidden = !guideItem;
  notFoundView.hidden = !isMissingProduct;
  hideFavoriteUndo();

  // 상세·그룹 화면에서 돌아온 경우가 아니면 상품 목록 검색어 초기화
  if (route === 'products' && !previousRoute.startsWith('product/') && !previousRoute.startsWith('group/')) {
    productSearchInput.value = '';
  }
  // 주제 상세에서 돌아온 경우가 아니면 담보별 안내 검색어·펼친 분류 초기화
  if (route === 'coverages' && !previousRoute.startsWith('topic/')) {
    coverageSearchInput.value = '';
    closedCoverageCategoryIds.clear();
  }

  if (view) {
    renderList(view);
    listTitle.focus();
  } else if (topic) {
    renderTopic(topic);
    topicTitle.focus();
  } else if (groupPage) {
    renderGroup(groupPage);
    groupTitle.focus();
  } else if (guideItem) {
    renderGuideItem(guideItem);
    guideItemTitle.focus();
  } else if (product) {
    recordRecentProduct(product.id);
    renderDetail(product);
    detailTitle.focus();
  } else if (isMissingProduct) {
    renderNotFound();
    notFoundTitle.focus();
  } else {
    renderSearch();
  }

  // 더 깊은 화면(상세·주제·그룹·설명 항목)에서 돌아온 경우 이전 스크롤 위치 복원
  const isDeeperRoute = (path) => /^(product|topic|group)\//.test(path);
  const isBackFromDetail = isDeeperRoute(previousRoute) && !product && !topic && !guideItem
    && (!groupPage || previousRoute.startsWith(`${route}/`) || previousRoute.startsWith('product/'));
  previousRoute = route;
  window.scrollTo(0, isBackFromDetail ? scrollPositions[route] || 0 : 0);
}

// 상세 화면의 뒤로가기: 앱 안에서 이동해 왔다면 이전 화면(검색 결과·목록 등)으로 복귀
let hasInAppHistory = false;

detailBack.addEventListener('click', (event) => {
  if (hasInAppHistory) {
    event.preventDefault();
    history.back();
  }
});

/* ===== 초기화 ===== */
async function loadProducts() {
  try {
    // 브라우저 캐시의 이전 상품 데이터를 쓰지 않도록 매번 서버에 확인
    const response = await fetch(PRODUCTS_URL, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    products = Array.isArray(data) ? data : [];
  } catch (error) {
    productsLoadFailed = true;
    products = [];
    console.warn('상품 목록을 불러오지 못했습니다.', error);
  }
}

/* ===== 데이터·화면 코드 변경 반영 =====
 * 데이터와 화면 코드는 화면을 처음 열 때 한 번 불러오므로, 열어 둔 화면(휴대폰 포함)은 이후 수정이 반영되지 않습니다.
 * 화면을 다시 볼 때(탭 전환·앱 복귀) 데이터와 화면 코드(index.html·app.js·style.css)를 확인해
 * 바뀌었으면 현재 주소 그대로 새로고침합니다.
 */
const APP_CODE_URLS = ['index.html', 'js/app.js', 'css/style.css'];
const DATA_WATCH_URLS = [
  ...(SHOW_DRAFT_CONTENT
    ? [PRODUCTS_URL, INTEGRATED_DRAFT_URL, COVERAGE_GUIDES_URL, CORE_HIGHLIGHTS_URL, COMMON_CHECKLISTS_URL, PRODUCT_MERGES_URL, LEARNING_GUIDES_URL]
    : [PRODUCTS_URL, PRODUCT_MERGES_URL]),
  ...APP_CODE_URLS,
];
let loadedDataSignature = null;
let isCheckingData = false;

async function fetchDataSignature() {
  const texts = await Promise.all(DATA_WATCH_URLS.map(async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }));
  return texts.join('\n');
}

async function reloadIfDataChanged() {
  if (isCheckingData || loadedDataSignature === null) return;
  isCheckingData = true;
  try {
    if (await fetchDataSignature() !== loadedDataSignature) location.reload();
  } catch (error) {
    // 연결이 끊긴 경우 등은 현재 화면 유지
  } finally {
    isCheckingData = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reloadIfDataChanged();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) reloadIfDataChanged();
});

async function init() {
  // 스크롤 위치는 앱에서 직접 관리 (브라우저 자동 복원과 겹쳐 화면이 튀지 않도록)
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  // 상세 화면 등으로 바로 들어온 경우, 데이터 로딩 중 메인화면이 잠깐 보이지 않도록 함
  if (getRoute() !== '') homeView.hidden = true;

  document.getElementById('dev-banner').hidden = !DEV_MODE || !SHOW_REVIEW_LABELS;
  document.documentElement.classList.toggle('hide-review-labels', !SHOW_REVIEW_LABELS);
  await Promise.all([loadProducts(), loadDemoChecklists(), loadReferenceTopics(), loadCoverageGuides(), loadProductGroups(), loadIntegratedDraft(), loadCoreHighlights(), loadCommonChecklists(), loadProductMerges(), loadLearningGuides()]);
  // 같은 id의 상품이 중복 등록되어 있으면 첫 항목만 사용 (원본 데이터는 변경하지 않음)
  // 삭제 처리된 상품(isDeleted: true)과 잠시 제외한 상품(isHidden: true)은 목록·검색·상세·그룹에서 제외
  // (id는 데이터에 남겨 재사용 방지 · isHidden은 표시만 되돌리면 다시 사용)
  const seenIds = new Set();
  allItems = products
    .filter((item) => item && typeof item.id === 'string' && !seenIds.has(item.id) && seenIds.add(item.id))
    .filter((item) => item.isDeleted !== true && item.isHidden !== true)
    .map((item) => ({ ...item, type: 'product' }));
  allItems = applyProductMerges(allItems);
  // 저장된 구성 상품 ID는 통합 항목 ID로 읽음 (같은 통합 항목은 하나로)
  favorites = new Set([...loadFavorites()].map(canonicalProductId));
  recentProductIds = [...new Set(loadRecentProducts().map(canonicalProductId))];
  buildProductGroups();
  buildIntegratedDraft();
  buildCoreHighlights();
  fetchDataSignature().then((signature) => { loadedDataSignature = signature; }).catch(() => {});

  window.addEventListener('hashchange', () => {
    hasInAppHistory = true;
    render();
  });
  render();
}

init();
