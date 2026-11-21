import './TimeSegmentSwitch.css';

export type TimeSegment = 'entry' | 'active' | 'exit';

const segments: Array<{ id: TimeSegment; label: string }> = [
  { id: 'entry', label: '进场管控' },
  { id: 'active', label: '活动进行' },
  { id: 'exit', label: '散场疏散' },
];

export default function TimeSegmentSwitch({ value, onChange }: { value: TimeSegment; onChange: (value: TimeSegment) => void }) {
  return (
    <div className="segment-switch" role="group" aria-label="活动时段">
      {segments.map(segment => (
        <button key={segment.id} type="button" data-active={value === segment.id} onClick={() => onChange(segment.id)}>
          <span>{segment.label}</span>
        </button>
      ))}
    </div>
  );
}
