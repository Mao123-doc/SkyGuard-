/**
 * Structured Knowledge Base — field-level indexing for scenic spots.
 * Parses the competition dataset (22 spots × 10 fields) into searchable records.
 * Each record is a self-contained, complete field value with full context.
 */
import fs from 'fs';
import path from 'path';

// ============================================================
// Types
// ============================================================

export interface SpotRecord {
  id: string;          // LS-001
  name: string;        // 南侧安全出口
  area: string;        // 东侧疏散通道
  fields: {
    location: string;
    params: string;
    coreFunction: string;
    culture: string;
    description: string;
    highlights: string;
    openingInfo: string;
    notes: string;
  };
}

export interface FieldDoc {
  id: string;          // LS-011_params
  spotId: string;
  spotName: string;
  area: string;
  fieldName: string;
  fieldLabel: string;  // 中文标签如"建筑/景观参数"
  text: string;
  keywords: string[];
}

// ============================================================
// Spot names for keyword extraction
// ============================================================

const SPOT_NAMES = [
  'A区看台', '中央广场', 'B区看台', '西侧看台', '北侧通道',
  '南侧安全出口', '中央步道', '亲子集结点', '高区塔楼', '东侧休息区',
  '入口广场', '主入口', '中轴浮雕墙', '中轴立柱', '应急物资仓库',
  '东区集结点', '室外疏散区', '商业通道', '中心湖区', '应急指挥中心',
  '东侧连廊', '东区', '中心水域', '中央楼梯', '山谷通道', '活动大厅',
];

const FIELD_LABELS: Record<string, string> = {
  location: '具体位置',
  params: '物理参数',
  coreFunction: '应急功能',
  culture: '承载与通行',
  description: '详细介绍',
  highlights: '疏散要点',
  openingInfo: '通行与响应规则',
  notes: '备注',
};

// ============================================================
// Parser
// ============================================================

function parseDataset(text: string): SpotRecord[] {
  const spots: SpotRecord[] = [];
  const lines = text.split('\n');

  let i = 0;

  // Skip header lines until we hit actual data (first "东侧疏散通道" or "东区")
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '主馆' || line === '东区') {
      break;
    }
    i++;
  }

  while (i < lines.length) {
    // Read area name
    let area = lines[i]?.trim() || '';
    i++;

    // Skip blank lines
    while (i < lines.length && !lines[i]?.trim()) i++;

    // Read spot code (LS-XXX or NH-XXX)
    const code = lines[i]?.trim() || '';
    if (!/^(LS|NH)-\d+$/.test(code)) {
      // Might be next area header, skip
      if (code === '主馆' || code === '东区') {
        continue;
      }
      i++;
      continue;
    }
    i++;

    // Skip blank lines
    while (i < lines.length && !lines[i]?.trim()) i++;

    // Read spot name
    const name = lines[i]?.trim() || '';
    i++;

    // Skip blank lines
    while (i < lines.length && !lines[i]?.trim()) i++;

    // Read 8 field values (each followed by blank lines)
    const fieldValues: string[] = [];
    for (let f = 0; f < 8 && i < lines.length; f++) {
      let fieldText = '';
      // Read until blank line or next spot starts
      while (i < lines.length) {
        const fl = (lines[i] || '').trim();
        // Stop at blank line
        if (!fl) { i++; break; }
        // Stop if we hit the next spot (area name + code pattern)
        if ((fl === '主馆' || fl === '东区') && fieldText) break;
        if (/^(LS|NH)-\d+$/.test(fl) && fieldText) break;
        // Stop if string gets too long (safety valve)
        if (fieldText.length > 5000) { i++; break; }
        // Append to field
        fieldText = fieldText ? fieldText + '\n' + fl : fl;
        i++;
      }
      if (fieldText) fieldValues.push(fieldText);
    }

    // Ensure we have at least 8 fields
    while (fieldValues.length < 8) fieldValues.push('');

    spots.push({
      id: code,
      name,
      area,
      fields: {
        location: fieldValues[0] || '',
        params: fieldValues[1] || '',
        coreFunction: fieldValues[2] || '',
        culture: fieldValues[3] || '',
        description: fieldValues[4] || '',
        highlights: fieldValues[5] || '',
        openingInfo: fieldValues[6] || '',
        notes: fieldValues[7] || '',
      },
    });

    // Skip any remaining blank lines
    while (i < lines.length && !lines[i]?.trim()) i++;
  }

  return spots;
}

// ============================================================
// Index Builder
// ============================================================

function extractKeywords(text: string): string[] {
  return SPOT_NAMES.filter(n => text.includes(n));
}

export function buildFieldIndex(spots: SpotRecord[]): FieldDoc[] {
  const docs: FieldDoc[] = [];

  for (const spot of spots) {
    const fieldEntries: Array<[string, string, string]> = [
      ['location', '具体位置', spot.fields.location],
      ['params', '物理参数', spot.fields.params],
      ['coreFunction', '应急功能', spot.fields.coreFunction],
      ['culture', '承载与通行', spot.fields.culture],
      ['description', '详细介绍', spot.fields.description],
      ['highlights', '疏散要点', spot.fields.highlights],
      ['openingInfo', '通行与响应规则', spot.fields.openingInfo],
      ['notes', '备注', spot.fields.notes],
    ];

    for (const [key, label, value] of fieldEntries) {
      if (!value || value.length < 5) continue;
      docs.push({
        id: `${spot.id}_${key}`,
        spotId: spot.id,
        spotName: spot.name,
        area: spot.area,
        fieldName: key,
        fieldLabel: label,
        text: value,
        keywords: extractKeywords(value),
      });
    }
  }

  return docs;
}

// ============================================================
// Two-Level Search
// ============================================================

/**
 * Match query against spot names. Returns scored spot matches.
 */
function matchSpots(query: string): Array<{ spotName: string; score: number }> {
  const results: Array<{ spotName: string; score: number }> = [];

  for (const name of SPOT_NAMES) {
    let score = 0;
    // Exact match
    if (query.includes(name)) score += 100;
    // Partial: longest common substring
    let maxSub = 0;
    for (let i = 0; i < name.length; i++) {
      for (let j = i + 2; j <= name.length; j++) {
        if (query.includes(name.slice(i, j))) {
          maxSub = Math.max(maxSub, j - i);
        }
      }
    }
    score += maxSub * 10;
    if (score > 0) results.push({ spotName: name, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Match query against field labels. Returns scored field matches.
 */
function matchFields(query: string): Array<{ fieldName: string; fieldLabel: string; score: number }> {
  const fieldHints: Record<string, string[]> = {
    params: ['高', '宽', '米', '面积', '平方米', '容量', '人数', '座位', '参数', '尺寸', '长', '结构', '材料'],
    location: ['在哪', '位置', '哪里', '怎么走', '位于'],
    culture: ['承载', '容量', '通行', '规则', '分流', '限流', '人数'],
    description: ['介绍', '描述', '什么', '是什么', '详细'],
    highlights: ['疏散', '出口', '通道', '路线', '要点', '注意'],
    openingInfo: ['响应', '话术', '报警', '规则', '开放', '时间', '应急'],
    coreFunction: ['功能', '作用', '用途'],
    notes: ['注意', '备注', '提示', '禁止', '严禁'],
  };

  const results: Array<{ fieldName: string; fieldLabel: string; score: number }> = [
    { fieldName: 'description', fieldLabel: '详细介绍', score: 1 }, // default fallback
  ];

  for (const [fieldName, keywords] of Object.entries(fieldHints)) {
    let score = 0;
    for (const kw of keywords) {
      if (query.includes(kw)) score += 5;
    }
    if (score > 0 || fieldName === 'description') {
      results.push({
        fieldName,
        fieldLabel: FIELD_LABELS[fieldName] || fieldName,
        score: fieldName === 'description' ? Math.max(score, 1) : score,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

export interface SearchResult {
  spotName: string;
  spotId: string;
  area: string;
  fieldLabel: string;
  fieldName: string;
  text: string;
  score: number;
}

/**
 * Two-level search: spot → field.
 */
export function searchStructured(query: string, topK: number = 5): SearchResult[] {
  const spotMatches = matchSpots(query);
  const fieldMatches = matchFields(query);

  if (spotMatches.length === 0) return [];

  const results: SearchResult[] = [];

  // Take top 3 spot matches, combine with top 3 field matches
  const topSpots = spotMatches.slice(0, 3);
  const topFields = fieldMatches.filter(f => f.score > 0).slice(0, 4);

  // Try to get the actual index
  const index = getFieldIndex();

  for (const spotMatch of topSpots) {
    for (const fieldMatch of topFields) {
      // Look up the actual field document
      const doc = index.find(
        d => d.spotName === spotMatch.spotName && d.fieldName === fieldMatch.fieldName
      );
      if (doc) {
        results.push({
          spotName: doc.spotName,
          spotId: doc.spotId,
          area: doc.area,
          fieldLabel: doc.fieldLabel,
          fieldName: doc.fieldName,
          text: doc.text,
          score: spotMatch.score + fieldMatch.score,
        });
      }
    }
  }

  // Deduplicate by spot+field
  const seen = new Set<string>();
  const unique = results.filter(r => {
    const key = `${r.spotId}_${r.fieldName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => b.score - a.score);
  return unique.slice(0, topK);
}

// ============================================================
// Singleton Index
// ============================================================

let _index: FieldDoc[] | null = null;
let _spots: SpotRecord[] | null = null;

export function getFieldIndex(): FieldDoc[] {
  if (_index) return _index;
  try {
    const dataDir = path.resolve(__dirname, '../../../data/raw');
    let text = '';
    const datasetPath = path.join(dataDir, 'knowledge_dataset.txt');
    if (fs.existsSync(datasetPath)) {
      text = fs.readFileSync(datasetPath, 'utf-8');
    }
    if (text) {
      _spots = parseDataset(text);
      _index = buildFieldIndex(_spots);
      console.log(`[Structured] Built field index: ${_spots.length} spots, ${_index.length} field docs`);
    } else {
      _index = [];
      _spots = [];
    }
  } catch (e: any) {
    console.error('[Structured] Failed to build index:', e.message);
    _index = [];
    _spots = [];
  }
  return _index;
}

export function getSpots(): SpotRecord[] {
  if (!_spots) getFieldIndex();
  return _spots || [];
}

export function getIndexStats() {
  const index = getFieldIndex();
  return {
    spotCount: getSpots().length,
    fieldDocCount: index.length,
  };
}
