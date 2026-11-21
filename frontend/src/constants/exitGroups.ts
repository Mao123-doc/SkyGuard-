export interface ExitGroup {
  id: string;
  name: string;
  exitIds: string[];
}

// TODO: 等后端 exit_groups 字段；当前分组依据既有场景出口顺序提供 UI 快捷选择。
export const exitGroups: ExitGroup[] = [
  { id: 'north', name: '北段', exitIds: ['GATE_01_G01', 'GATE_02_G02', 'GATE_03_G03'] },
  { id: 'middle', name: '中段', exitIds: ['GATE_04_G04', 'GATE_05_G05', 'GATE_06_G06'] },
  { id: 'south', name: '南段', exitIds: ['GATE_07_G07', 'GATE_08_G08', 'GATE_09_G09'] },
  { id: 'ends', name: '两端', exitIds: ['GATE_10_G10', 'GATE_11_G11'] },
];

export function exitsForGroup(groupId: string, availableExitIds: string[]): string[] {
  const group = exitGroups.find(item => item.id === groupId);
  if (!group) return [];
  const explicitMatches = group.exitIds.filter(id => availableExitIds.includes(id));
  if (explicitMatches.length) return explicitMatches;
  const indexes = groupId === 'north' ? [0, 1, 2] : groupId === 'middle' ? [3, 4, 5] : groupId === 'south' ? [6, 7, 8] : [9, 10];
  return indexes.map(index => availableExitIds[index]).filter((id): id is string => Boolean(id));
}
