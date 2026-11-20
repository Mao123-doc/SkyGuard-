import './TimeSegmentSwitch.css';

export type TimeSegment = 'entry' | 'active' | 'exit';

const segments: Array<{ id: TimeSegment; label: string; time: string }> = [
  { id: 'entry', label: '进场管控', time: '18:30–19:00' },
  { id: 'active', label: '活动进行', time: '19:00–21:30' },
  { id: 'exit', label: '散场疏散', time: '21:30–22:00' },
];

export default function TimeSegmentSwitch({ value, onChange }: { value: TimeSegment; onChange: (value: TimeSegment) => void }) {
  return (
    <div className="segment-switch" role="group" aria-label="活动时段">
      {segments.map(segment => (
        <button key={segment.id} type="button" data-active={value === segment.id} onClick={() => onChange(segment.id)}>
          <span>{segment.label}</span><small>{segment.time}</small>
        </button>
      ))}
    </div>
  );
}
